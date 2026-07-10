import type { Role } from '../hooks/useAuth'
import type {
  AppData,
  Channel,
  PipelineItem,
  Prompts,
  Screening,
  ScreeningSourceContext,
  Target,
  Touch,
} from '../types'
import { addToExcluded, normalizeHandle, todayStr, uid } from '../utils/helpers'
import { parseOS0, parseOS0NG, parseOS1, parseOS1Instagram, parseOS1Threads } from '../utils/parser'
import { buildTouchPromptFromTemplate, parseTouchOutput } from '../utils/touchPrompt'
import type { TargetPostInfo } from '../utils/touchPrompt'
import { runAi } from './aiRun'

interface BridgeEnvelope<T = unknown> {
  source: 'salesos-ext' | 'salesos-app'
  type: string
  requestId: string
  payload: T
}

type BridgeChannel = Exclude<Channel, 'dm'>
type PromptKey = 'OS0_X' | 'OS0_IG' | 'OS0_TH' | 'OS1_X' | 'OS1_IG' | 'OS1_TH'
type SaveData = (updater: (prev: AppData) => AppData) => void

interface BridgeDependencies {
  getData: () => AppData
  saveData: SaveData
  prompts: Prompts
  role: Role
  buildLabel: string
}

interface ImportPayload {
  aiOutput: string
  channel: BridgeChannel
  rawInput?: string
  sourceContext: ScreeningSourceContext
}

interface OS1ImportPayload extends ImportPayload {
  screeningId?: string
}

const CHANNELS = new Set<BridgeChannel>(['twitter', 'instagram', 'threads'])
const PROMPT_KEYS = new Set<PromptKey>(['OS0_X', 'OS0_IG', 'OS0_TH', 'OS1_X', 'OS1_IG', 'OS1_TH'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isChannel(value: unknown): value is BridgeChannel {
  return typeof value === 'string' && CHANNELS.has(value as BridgeChannel)
}

function normalizeAtHandle(handle: string): string {
  const normalized = normalizeHandle(handle)
  return normalized ? `@${normalized}` : ''
}

// URL（https://x.com/xxx）またはハンドル（@xxx / xxx）からハンドル部分だけ抽出
function extractHandleOnly(urlOrHandle: string): string {
  return urlOrHandle
    .replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//, '')
    .replace(/^@/, '')
    .split('/')[0]
    .toLowerCase()
    .trim()
}

function isSourceContext(value: unknown): value is ScreeningSourceContext {
  if (!isRecord(value)) return false
  return (
    isChannel(value.platform) &&
    typeof value.pageType === 'string' &&
    typeof value.url === 'string' &&
    (value.collectedBy === 'chrome-extension' || value.collectedBy === 'manual') &&
    typeof value.collectedAt === 'string'
  )
}

function readonlyResult() {
  return { ok: false, code: 'READONLY' }
}

export function registerExtensionBridge({
  getData,
  saveData,
  prompts,
  role,
  buildLabel,
}: BridgeDependencies): () => void {
  let observedData = getData()
  let latestData = observedData
  let processing = Promise.resolve()

  const readData = (): AppData => {
    const current = getData()
    if (current !== observedData) {
      observedData = current
      latestData = current
    }
    return latestData
  }

  const commit = <T>(build: (prev: AppData) => { next: AppData; result: T }): Promise<T> =>
    new Promise(resolve => {
      saveData(prev => {
        const { next, result } = build(prev)
        observedData = prev
        latestData = next
        resolve(result)
        return next
      })
    })

  const respond = (requestId: string, type: string, payload: unknown) => {
    const envelope: BridgeEnvelope = {
      source: 'salesos-app',
      type,
      requestId,
      payload,
    }
    window.postMessage(envelope, location.origin)
  }

  const dispatch = async (message: BridgeEnvelope) => {
    const payload = isRecord(message.payload) ? message.payload : {}

    switch (message.type) {
      case 'APP_PING':
        respond(message.requestId, 'APP_PONG', { version: buildLabel, role })
        return

      case 'GET_PROMPT': {
        const key = payload.key
        if (typeof key !== 'string' || !PROMPT_KEYS.has(key as PromptKey)) {
          respond(message.requestId, 'ERROR', { code: 'INVALID_PAYLOAD' })
          return
        }
        const text = prompts[key as PromptKey] || ''
        respond(message.requestId, 'PROMPT', { key, text, ready: text.length > 0 })
        return
      }

      case 'GET_EXCLUDED': {
        if (!isChannel(payload.channel)) {
          respond(message.requestId, 'ERROR', { code: 'INVALID_PAYLOAD' })
          return
        }
        const handles = [
          ...new Set(
            (readData().excluded || [])
              .filter(item => item.channel === payload.channel)
              .map(item => normalizeAtHandle(item.handle))
              .filter(Boolean),
          ),
        ]
        respond(message.requestId, 'EXCLUDED', { handles })
        return
      }

      case 'GET_OS0_QUEUE': {
        if (!isChannel(payload.channel)) {
          respond(message.requestId, 'ERROR', { code: 'INVALID_PAYLOAD' })
          return
        }
        const items = (readData().screenings || [])
          .filter(item => item.channel === payload.channel)
          .map(({ id, handle, displayName, verdict }) => ({ id, handle, displayName, verdict }))
        respond(message.requestId, 'OS0_QUEUE', { items })
        return
      }

      case 'OS0_IMPORT': {
        if (role !== 'admin') {
          respond(message.requestId, 'OS0_IMPORT_RESULT', readonlyResult())
          return
        }
        if (
          typeof payload.aiOutput !== 'string' ||
          !isChannel(payload.channel) ||
          !isSourceContext(payload.sourceContext) ||
          (payload.rawInput !== undefined && typeof payload.rawInput !== 'string')
        ) {
          respond(message.requestId, 'OS0_IMPORT_RESULT', {
            ok: false,
            passed: [],
            ngCount: 0,
            skippedDuplicates: 0,
            missing: ['invalid_payload'],
          })
          return
        }

        const importPayload = payload as unknown as ImportPayload
        const parsedPassing = parseOS0(importPayload.aiOutput, importPayload.channel) as Screening[]
        const parsedNg = parseOS0NG(importPayload.aiOutput, importPayload.channel)

        if (parsedPassing.length === 0 && parsedNg.length === 0) {
          respond(message.requestId, 'OS0_IMPORT_RESULT', {
            ok: false,
            passed: [],
            ngCount: 0,
            skippedDuplicates: 0,
            missing: ['no_accounts_parsed'],
          })
          return
        }

        const result = await commit(prev => {
          const next: AppData = {
            ...prev,
            screenings: [...(prev.screenings || [])],
            excluded: [...(prev.excluded || [])],
          }
          const knownHandles = new Set([
            ...next.screenings.map(item => normalizeHandle(item.handle)),
            ...next.excluded.map(item => normalizeHandle(item.handle)),
          ])
          let skippedDuplicates = 0
          let ngCount = 0

          for (const ng of parsedNg) {
            const handle = normalizeHandle(ng.handle)
            if (!handle || knownHandles.has(handle)) {
              skippedDuplicates++
              continue
            }
            addToExcluded(next, ng.handle, ng.displayName, ng.channel, 'OS⓪NG', ng.skipCode)
            knownHandles.add(handle)
            ngCount++
          }

          const passed: Screening[] = []
          for (const item of parsedPassing) {
            const handle = normalizeHandle(item.handle)
            if (!handle || knownHandles.has(handle)) {
              skippedDuplicates++
              continue
            }
            const screening: Screening = {
              ...item,
              channel: importPayload.channel,
              rawProfileText: importPayload.rawInput,
              sourceContext: importPayload.sourceContext,
            }
            next.screenings.push(screening)
            passed.push(screening)
            knownHandles.add(handle)
          }

          return {
            next,
            result: {
              ok: true,
              passed: passed.map(({ id, handle, displayName, verdict }) => ({
                id,
                handle,
                displayName,
                verdict,
              })),
              ngCount,
              skippedDuplicates,
              missing: [] as string[],
            },
          }
        })
        respond(message.requestId, 'OS0_IMPORT_RESULT', result)
        return
      }

      case 'OS1_IMPORT': {
        if (role !== 'admin') {
          respond(message.requestId, 'OS1_IMPORT_RESULT', readonlyResult())
          return
        }
        if (
          typeof payload.aiOutput !== 'string' ||
          !isChannel(payload.channel) ||
          !isSourceContext(payload.sourceContext) ||
          (payload.screeningId !== undefined && typeof payload.screeningId !== 'string') ||
          (payload.rawInput !== undefined && typeof payload.rawInput !== 'string')
        ) {
          respond(message.requestId, 'OS1_IMPORT_RESULT', {
            ok: false,
            missing: ['invalid_payload'],
          })
          return
        }

        const importPayload = payload as unknown as OS1ImportPayload
        const parsed = (
          importPayload.channel === 'instagram'
            ? parseOS1Instagram(importPayload.aiOutput)
            : importPayload.channel === 'threads'
              ? parseOS1Threads(importPayload.aiOutput)
              : parseOS1(importPayload.aiOutput)
        ) as Omit<Target, 'id' | 'createdAt'>

        const missing: string[] = []
        if (!parsed.accountName?.trim()) missing.push('accountName')
        if (!parsed.track) missing.push('track')
        if (parsed.track !== 'SKIP' && !parsed.contactA?.trim()) missing.push('contactA')
        if (missing.length > 0) {
          respond(message.requestId, 'OS1_IMPORT_RESULT', { ok: false, missing })
          return
        }

        const targetId = uid()
        const createdAt = new Date().toISOString()
        const today = todayStr()
        const result = await commit(prev => {
          const screening = importPayload.screeningId
            ? (prev.screenings || []).find(item => item.id === importPayload.screeningId)
            : undefined
          const shouldAddToPipeline = parsed.track !== 'SKIP'
          const pipelineId = shouldAddToPipeline ? uid() : null
          const target: Target = {
            ...parsed,
            id: targetId,
            createdAt,
            channel: importPayload.channel,
            url: parsed.url || screening?.handle || '',
            // rawInput / aiOutput omitted — keep Firestore document size under 1 MB
            pipelineId,
          } as Target
          const pipelineItem: PipelineItem | null = shouldAddToPipeline && pipelineId
            ? {
                id: pipelineId,
                targetId,
                caseId: target.caseId || null,
                os1Output: null, // omitted — keep Firestore document size under 1 MB
                accountName: target.accountName,
                url: target.url,
                channel: target.channel,
                track: target.track,
                hypothesis: target.hypothesis,
                startDate: target.startDate || today,
                currentStep: 'S1',
                stepHistory: [{ step: 'S1', date: today }],
                repCount: 0,
                dmCount: 0,
                lastContactDate: today,
                analyses: [],
                history: [],
                sentMessages: [],
                replies: [],
                isOpen: true,
                salesExpectation: target.salesExpectation,
                salesExpectationReason: target.salesExpectationReason,
                salesExpectationBreakdown: target.salesExpectationBreakdown,
                salesExpectationFacts: target.salesExpectationFacts,
                opportunityStatus: target.opportunityStatus,
                opportunityStatusReason: target.opportunityStatusReason,
                prioritySegment: target.prioritySegment,
                prioritySegmentReason: target.prioritySegmentReason,
                opportunityFacts: target.opportunityFacts,
                opportunityFit: target.opportunityFit,
                opportunityFitReason: target.opportunityFitReason,
                opportunityBreakdown: target.opportunityBreakdown,
                partnerFlag: target.partnerFlag,
                trackReason: target.trackReason,
                estimatedProduct: target.estimatedProduct,
                estimatedPrice: target.estimatedPrice,
                primaryHypothesisPattern: target.primaryHypothesisPattern,
                naturalQuestion: target.naturalQuestion,
                forbiddenAngles: target.forbiddenAngles,
                observations: target.observations,
              }
            : null
          const next: AppData = {
            ...prev,
            targets: [...(prev.targets || []), target],
            screenings: importPayload.screeningId
              ? (prev.screenings || []).filter(item => item.id !== importPayload.screeningId)
              : [...(prev.screenings || [])],
            pipeline: pipelineItem
              ? [...(prev.pipeline || []), pipelineItem]
              : (prev.pipeline || []),
          }
          return {
            next,
            result: {
              ok: true,
              targetId,
              pipelineId,
              track: target.track,
              skipJudge: target.skipJudge,
              missing: [] as string[],
            },
          }
        })
        respond(message.requestId, 'OS1_IMPORT_RESULT', result)
        return
      }

      case 'GET_TOUCH_PROMPT': {
        const handle = typeof payload.handle === 'string' ? payload.handle : ''
        if (!handle) {
          respond(message.requestId, 'ERROR', { code: 'INVALID_PAYLOAD' })
          return
        }
        const data = readData()
        const normalizedHandle = extractHandleOnly(handle)
        const item = data.pipeline.find(
          p => p.isOpen !== false && extractHandleOnly(p.url) === normalizedHandle,
        )
        if (!item) {
          respond(message.requestId, 'TOUCH_PROMPT', { found: false })
          return
        }
        const tweetText = typeof payload.tweetText === 'string' ? payload.tweetText : ''
        const tweetUrl = typeof payload.tweetUrl === 'string' ? payload.tweetUrl : ''
        const targetPost: TargetPostInfo | undefined = (tweetText || tweetUrl)
          ? { url: tweetUrl, text: tweetText }
          : undefined
        try {
          const template = await fetch('/prompts/OS_継続接触_タッチ生成_latest.md').then(r => r.text())
          const promptText = buildTouchPromptFromTemplate(item, item.touches || [], template, targetPost)
          respond(message.requestId, 'TOUCH_PROMPT', {
            found: true,
            promptText,
            pipelineItemId: item.id,
            accountName: item.accountName,
          })
        } catch (_) {
          respond(message.requestId, 'ERROR', { code: 'PROMPT_BUILD_FAILED' })
        }
        return
      }

      case 'PARSE_TOUCH_OUTPUT': {
        const raw = typeof payload.raw === 'string' ? payload.raw : ''
        if (!raw) {
          respond(message.requestId, 'ERROR', { code: 'INVALID_PAYLOAD' })
          return
        }
        const parsed = parseTouchOutput(raw)
        if (!parsed) {
          respond(message.requestId, 'TOUCH_OUTPUT_PARSED', { ok: false })
          return
        }
        respond(message.requestId, 'TOUCH_OUTPUT_PARSED', {
          ok: true,
          optionA: { text: parsed.suggestedTextA ?? '', judge: parsed.provisionalJudgmentA ?? '' },
          optionB: { text: parsed.suggestedTextB ?? '', judge: parsed.provisionalJudgmentB ?? '' },
        })
        return
      }

      case 'RECORD_TOUCH': {
        if (role !== 'admin') {
          respond(message.requestId, 'RECORD_TOUCH_RESULT', { ok: false, code: 'READONLY' })
          return
        }
        const pipelineItemId = typeof payload.pipelineItemId === 'string' ? payload.pipelineItemId : ''
        const postUrl = typeof payload.postUrl === 'string' ? payload.postUrl : ''
        const postText = typeof payload.postText === 'string' ? payload.postText : ''
        const sentText = typeof payload.sentText === 'string' ? payload.sentText : ''
        const aiSuggestedText = typeof payload.aiSuggestedText === 'string' ? payload.aiSuggestedText : ''
        if (!pipelineItemId || !sentText) {
          respond(message.requestId, 'RECORD_TOUCH_RESULT', { ok: false, code: 'INVALID_PAYLOAD' })
          return
        }
        const today = todayStr()
        const newTouch = {
          id: uid(),
          date: today,
          postUrl,
          targetPostText: postText.slice(0, 100),
          targetPostType: '通常投稿',
          targetValidity: '未評価',
          aiSuggestedText,
          actualSentText: sentText,
          editReason: '（拡張機能から送信）',
          messageValidity: '未評価',
          status: 'awaiting_reaction',
          reactionType: '未記録',
          reactionNote: '',
        } as Touch
        const result = await commit(prev => {
          if (!prev.pipeline.some(p => p.id === pipelineItemId)) {
            return { next: prev, result: { ok: false, code: 'NOT_FOUND', touchId: '' } }
          }
          const pipeline = prev.pipeline.map(p =>
            p.id === pipelineItemId
              ? {
                  ...p,
                  touches: [...(p.touches || []), newTouch],
                  lastContactDate: today,
                  repCount: (p.repCount || 0) + 1,
                }
              : p,
          )
          return { next: { ...prev, pipeline }, result: { ok: true, code: '', touchId: newTouch.id } }
        })
        respond(message.requestId, 'RECORD_TOUCH_RESULT', result)
        return
      }

      case 'RUN_AI': {
        if (role !== 'admin') {
          respond(message.requestId, 'RUN_AI_RESULT', { ok: false, code: 'READONLY' })
          return
        }
        const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
        if (!prompt) {
          respond(message.requestId, 'RUN_AI_RESULT', { ok: false, code: 'INVALID_PAYLOAD' })
          return
        }
        const aiResult = await runAi(prompt)
        respond(message.requestId, 'RUN_AI_RESULT', aiResult)
        return
      }

      default:
        respond(message.requestId, 'ERROR', { code: 'UNKNOWN_TYPE' })
    }
  }

  const handler = (event: MessageEvent) => {
    if (event.source !== window) return
    if (!isRecord(event.data) || event.data.source !== 'salesos-ext') return

    const message = event.data as unknown as BridgeEnvelope
    if (typeof message.type !== 'string' || typeof message.requestId !== 'string') return

    processing = processing
      .then(() => dispatch(message))
      .catch(error => {
        console.error('Extension bridge error', error)
        respond(message.requestId, 'ERROR', { code: 'INTERNAL_ERROR' })
      })
  }

  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
