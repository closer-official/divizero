import { useState, useEffect } from 'react'
import type { AppData, Prompts, Target, Screening } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS1, parseOS1Instagram, parseOS1Threads } from '../../utils/parser'
import { addToExcluded, moveToTrash, normalizeHandle, buildProfileUrl, trackBadgeClass, uid, todayStr, buildInitialInboundTouch } from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'
import { buildSpecRefreshBatchPrompt, getLatestSpecMissingLabels, isLatestSpecRefreshTarget, parseSpecRefreshBatchOutput, type SpecRefreshBatchItem, type SpecRefreshBatchResult, type SpecRefreshParsed } from '../../utils/os1RefreshBatchPrompt'
import {
  getOpportunityFitLabel,
  getOpportunityStatusLabel,
  getPrioritySegmentLabel,
  formatOpportunityFacts,
  isUTAGEPriority,
  OPPORTUNITY_FACT_ITEMS,
} from '../../utils/opportunityUtils'

type Mode = 'twitter' | 'instagram' | 'threads'
type ParseSummary = {
  total: number
  success: number
  failed: number
  errors: string[]
}

function buildParseSummary(total: number, success: number, errors: string[]): ParseSummary {
  return { total, success, failed: Math.max(0, total - success), errors }
}

function ParseSummaryBox({ summary }: { summary: ParseSummary | null }) {
  if (!summary) return null
  const isSuccess = summary.failed === 0
  const shownErrors = summary.errors.slice(0, 3)
  const extraErrors = Math.max(0, summary.errors.length - shownErrors.length)
  return (
    <div className={`rounded-xl border px-3 py-2 text-[11px] ${isSuccess ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
      <p className="font-bold">
        {isSuccess
          ? `取り込み結果：${summary.total}件中${summary.success}件を取り込みました`
          : summary.success > 0
            ? `取り込み結果：${summary.total}件中${summary.success}件成功 / ${summary.failed}件失敗`
            : '取り込みに失敗しました。フォーマットを確認してください。'}
      </p>
      {!isSuccess && shownErrors.length > 0 && (
        <div className="mt-1 space-y-0.5">
          <p className="font-semibold">失敗理由：</p>
          <ul className="space-y-0.5">
            {shownErrors.map((err, idx) => (
              <li key={`${idx}-${err}`}>- {err}</li>
            ))}
            {extraErrors > 0 && <li>- 他{extraErrors}件のエラー</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

interface Props {
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
  onGoToTab2: () => void
}

const TRACK_TIPS: Record<string, string> = {
  FT: 'ファストトラック：課題シグナルあり→DM直行',
  NT: '通常トラック：リプ交流を経てDMへ',
  SKIP: '接触対象外（除外フィルター該当）'
}

type Prefill = { displayName: string; handle: string; channel: string; is_inbound?: boolean; inbound_actions?: string[]; signal_type?: string; signal_date?: string; signal_memo?: string }

function buildInboundContext(item: { is_inbound?: boolean; inbound_actions?: string[]; signal_type?: string; signal_date?: string; signal_memo?: string }): string {
  const actionsList = item.inbound_actions?.length
    ? item.inbound_actions
    : item.signal_type ? [item.signal_type] : []
  const actionsStr = actionsList.join('、')
  if (!actionsStr || (!item.is_inbound && !actionsList.length)) return ''
  const dateStr = item.signal_date ? `（検知日：${item.signal_date}）` : ''
  const isDm = actionsStr.includes('突然DM') || actionsStr.includes('DM')
  let ctx = `\n\n【インバウンド情報（重要）】\nこの相手からは既にアクション（${actionsStr}）が来ています${dateStr}。接触ハードルが低いため、これを加味して仮説構築および初回アプローチ案を生成してください。`
  if (item.signal_memo?.trim()) {
    ctx += `\n\n▼ ${isDm ? '相手から届いたDM本文' : 'メモ・追記'}：\n${item.signal_memo.trim()}`
  }
  if (isDm) {
    ctx += `\n\n※注意：相手から既にDMが届いているため、初手のアプローチは「公開リプ」ではなく「DMへの返信」になります。${item.signal_memo?.trim() ? '上記DM本文を踏まえたうえで、' : ''}初回リプ案A・Bの出力枠を利用して、相手のDMに対する自然な返信案（1対1の親しみやすいトーン）を生成してください。`
  }
  return ctx
}

function getOS1ParseErrors(parsed: Omit<Target, 'id' | 'createdAt'>, mode: Mode): string[] {
  const errors: string[] = []
  if (!parsed.accountName) errors.push('必須項目「アカウント名」が見つかりません')
  if (!parsed.url) {
    errors.push(mode === 'instagram' || mode === 'threads'
      ? '必須項目「ユーザーネーム（@〜）」が見つかりません'
      : '必須項目「ユーザーネーム（@〜）」が見つかりません')
  }
  return errors
}

export default function Tab1({ data, saveData, prompts, role, toast, confirm, onGoToTab2 }: Props) {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('os_screening_mode') as Mode) || 'twitter')
  const [resultText, setResultText] = useState('')
  const [parseSummary, setParseSummary] = useState<ParseSummary | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [batchResult, setBatchResult] = useState('')
  const [batchParseSummary, setBatchParseSummary] = useState<ParseSummary | null>(null)
  const [prefill, setPrefill] = useState<Prefill | null>(() => {
    try {
      const s = localStorage.getItem('os1_prefill')
      return s ? JSON.parse(s) : null
    } catch { return null }
  })
  const [continuousMode, setContinuousMode] = useState(false)
  const [batchRefreshOpen, setBatchRefreshOpen] = useState(false)
  const [batchRefreshLimit, setBatchRefreshLimit] = useState<5 | 10>(5)
  const [batchRefreshOutput, setBatchRefreshOutput] = useState('')
  const [batchRefreshCopyState, setBatchRefreshCopyState] = useState<'idle' | 'copied'>('idle')
  const [batchRefreshError, setBatchRefreshError] = useState<string | null>(null)
  const [batchRefreshPreviewResults, setBatchRefreshPreviewResults] = useState<SpecRefreshBatchResult[]>([])
  const [batchRefreshPreviewIndex, setBatchRefreshPreviewIndex] = useState(0)
  const [batchRefreshApprovedMap, setBatchRefreshApprovedMap] = useState<Record<string, boolean>>({})
  const [batchRefreshManualEdits, setBatchRefreshManualEdits] = useState<Record<string, Partial<SpecRefreshParsed>>>({})
  const [batchRefreshManualFacts, setBatchRefreshManualFacts] = useState<Record<string, Partial<NonNullable<Target['opportunityFacts']>>>>({})

  useEffect(() => {
    setSelectedId(null)
  }, [page])

  function setModeAndSave(m: Mode) {
    setMode(m)
    localStorage.setItem('os_screening_mode', m)
  }

  function handleCopyPrompt() {
    let prompt: string | undefined
    if (mode === 'instagram') prompt = prompts.OS1_IG
    else if (mode === 'threads') prompt = prompts.OS1_TH
    else prompt = prompts.OS1_X
    if (!prompt) { toast.show('プロンプトを読み込み中です'); return }
    const inboundCtx = prefill ? buildInboundContext(prefill) : ''
    copyText(prompt + inboundCtx, () => toast.show('分析プロンプトをコピーしました。AIにスクショと一緒に貼り付けてください'))
  }

  function handleSubmit() {
    const text = resultText.trim()
    if (!text) { toast.show('AIの出力を貼り付けてください', 2000); return }
    let parsed: Omit<Target, 'id' | 'createdAt'>
    if (mode === 'instagram') parsed = parseOS1Instagram(text) as unknown as Omit<Target, 'id' | 'createdAt'>
    else if (mode === 'threads') parsed = parseOS1Threads(text) as unknown as Omit<Target, 'id' | 'createdAt'>
    else parsed = parseOS1(text) as unknown as Omit<Target, 'id' | 'createdAt'>
    const errors = getOS1ParseErrors(parsed, mode)
    if (errors.length > 0 && !parsed.accountName && !parsed.url) {
      setParseSummary(buildParseSummary(1, 0, errors))
      toast.show('アカウント情報が見つかりませんでした。AIの出力形式を確認してください', 3000)
      return
    }
    const targetId = uid()
    const pid = parsed.track !== 'SKIP' ? uid() : null
    const newTarget: Target = {
      ...parsed,
      id: targetId,
      createdAt: new Date().toISOString(),
      aiOutput: text,
      pipelineId: pid,
    } as Target
    saveData(prev => {
      const d = { ...prev, targets: [...prev.targets, newTarget] }
      if (pid) {
        d.pipeline = [...prev.pipeline, {
          id: pid,
          targetId,
          caseId: newTarget.caseId || null,
          os1Output: newTarget.aiOutput || null,
          accountName: newTarget.accountName,
          url: newTarget.url || prefill?.handle || '',
          channel: newTarget.channel,
          track: newTarget.track as 'FT' | 'NT' | 'UT' | 'SKIP',
          hypothesis: newTarget.hypothesis,
          startDate: newTarget.startDate || todayStr(),
          currentStep: 'S1',
          stepHistory: [{ step: 'S1', date: todayStr() }],
          repCount: 0,
          dmCount: 0,
          lastContactDate: todayStr(),
          analyses: [],
          history: [],
          sentMessages: [],
          replies: [],
          isOpen: true,
          salesExpectation: newTarget.salesExpectation,
          salesExpectationReason: newTarget.salesExpectationReason,
          salesExpectationBreakdown: newTarget.salesExpectationBreakdown,
          salesExpectationFacts: newTarget.salesExpectationFacts,
          opportunityStatus: newTarget.opportunityStatus,
          opportunityStatusReason: newTarget.opportunityStatusReason,
          prioritySegment: newTarget.prioritySegment,
          prioritySegmentReason: newTarget.prioritySegmentReason,
          opportunityFacts: newTarget.opportunityFacts,
          opportunityFit: newTarget.opportunityFit,
          opportunityFitReason: newTarget.opportunityFitReason,
          opportunityBreakdown: newTarget.opportunityBreakdown,
          partnerFlag: newTarget.partnerFlag,
          trackReason: newTarget.trackReason,
          estimatedProduct: newTarget.estimatedProduct,
          estimatedPrice: newTarget.estimatedPrice,
          primaryHypothesisPattern: newTarget.primaryHypothesisPattern,
          naturalQuestion: newTarget.naturalQuestion,
          forbiddenAngles: newTarget.forbiddenAngles,
          observations: newTarget.observations,
          isInbound: prefill?.is_inbound || false,
          inboundActions: prefill?.inbound_actions?.length ? prefill.inbound_actions : (prefill?.signal_type ? [prefill.signal_type] : []),
          inbound_signal: prefill?.is_inbound && prefill?.signal_type ? {
            type: prefill.signal_type,
            date: prefill.signal_date || todayStr(),
            memo: prefill.signal_memo,
          } : undefined,
          touches: prefill?.is_inbound ? [buildInitialInboundTouch(prefill, todayStr())] : [],
        }]
      }
      return d
    })
    setResultText('')
    localStorage.removeItem('os1_prefill')
    setPrefill(null)
    setParseSummary(buildParseSummary(1, 1, errors))
    if (pid) {
      toast.show(`「${newTarget.accountName}」をOS②に追加しました`, 2000)
      setTimeout(() => onGoToTab2(), 1000)
    } else {
      toast.show(`「${newTarget.accountName}」をOS①リストに追加しました（SKIP）`)
      setSelectedId(newTarget.id)
      setPage(0)
    }
  }

  function handleBulkToPipeline() {
    const eligible = data.targets.filter(t => t.track !== 'SKIP' && !t.pipelineId)
    if (eligible.length === 0) return
    saveData(prev => {
      const d = { ...prev, targets: [...prev.targets], pipeline: [...prev.pipeline] }
      eligible.forEach(tgt => {
        const pid = uid()
        d.targets = d.targets.map(t => t.id === tgt.id ? { ...t, pipelineId: pid } : t)
        d.pipeline.push({
          id: pid, targetId: tgt.id,
          caseId: tgt.caseId || null, os1Output: tgt.aiOutput || null,
          accountName: tgt.accountName, url: tgt.url, channel: tgt.channel,
          track: tgt.track as 'FT' | 'NT' | 'UT' | 'SKIP', hypothesis: tgt.hypothesis,
          startDate: tgt.startDate || todayStr(),
          currentStep: 'S1', stepHistory: [{ step: 'S1', date: todayStr() }],
          repCount: 0, dmCount: 0, lastContactDate: todayStr(),
          analyses: [], history: [], sentMessages: [], replies: [], isOpen: true,
          salesExpectation: tgt.salesExpectation,
          salesExpectationReason: tgt.salesExpectationReason,
          salesExpectationBreakdown: tgt.salesExpectationBreakdown,
          salesExpectationFacts: tgt.salesExpectationFacts,
          opportunityStatus: tgt.opportunityStatus,
          opportunityStatusReason: tgt.opportunityStatusReason,
          prioritySegment: tgt.prioritySegment,
          prioritySegmentReason: tgt.prioritySegmentReason,
          opportunityFacts: tgt.opportunityFacts,
          opportunityFit: tgt.opportunityFit,
          opportunityFitReason: tgt.opportunityFitReason,
          opportunityBreakdown: tgt.opportunityBreakdown,
          partnerFlag: tgt.partnerFlag,
          trackReason: tgt.trackReason,
          estimatedProduct: tgt.estimatedProduct,
          estimatedPrice: tgt.estimatedPrice,
          primaryHypothesisPattern: tgt.primaryHypothesisPattern,
          naturalQuestion: tgt.naturalQuestion,
          forbiddenAngles: tgt.forbiddenAngles,
          observations: tgt.observations,
        })
      })
      return d
    })
    toast.show(`${eligible.length}件をOS②パイプラインに一括移行します…`, 2500)
    setTimeout(() => onGoToTab2(), 2000)
  }

  function getMergedSpecRefreshTarget(
    target: Target,
    parsed: SpecRefreshParsed,
  ): Target {
    const keepText = (next?: string, current?: string) => next && next.trim() ? next : (current || '')
    return {
      ...target,
      caseId: parsed.caseId || target.caseId,
      accountName: parsed.accountName || target.accountName,
      url: parsed.url || target.url,
      channel: (parsed.channel || target.channel) as Target['channel'],
      track: (parsed.track || target.track) as Target['track'],
      hypothesis: parsed.hypothesis || target.hypothesis,
      startDate: parsed.startDate || target.startDate,
      trackReason: keepText(parsed.trackReason, target.trackReason),
      partnerFlag: keepText(parsed.partnerFlag, target.partnerFlag),
      nextAction: keepText(parsed.nextAction, target.nextAction),
      dmRoute: keepText(parsed.dmRoute, target.dmRoute),
      estimatedProduct: keepText(parsed.estimatedProduct, target.estimatedProduct),
      estimatedPrice: keepText(parsed.estimatedPrice, target.estimatedPrice),
      contactA: keepText(parsed.contactA, target.contactA),
      contactB: keepText(parsed.contactB, target.contactB),
      storyA: keepText(parsed.storyA, target.storyA),
      storyB: keepText(parsed.storyB, target.storyB),
      storyNote: keepText(parsed.storyNote, target.storyNote),
      dmA: keepText(parsed.dmA, target.dmA),
      dmB: keepText(parsed.dmB, target.dmB),
      dmNote: keepText(parsed.dmNote, target.dmNote),
      salesExpectation: target.salesExpectation,
      salesExpectationReason: target.salesExpectationReason,
      salesExpectationBreakdown: target.salesExpectationBreakdown,
      salesExpectationFacts: target.salesExpectationFacts,
      opportunityStatus: parsed.opportunityStatus || target.opportunityStatus,
      opportunityStatusReason: keepText(parsed.opportunityStatusReason, target.opportunityStatusReason),
      prioritySegment: parsed.prioritySegment || target.prioritySegment,
      prioritySegmentReason: keepText(parsed.prioritySegmentReason, target.prioritySegmentReason),
      opportunityFacts: parsed.opportunityFacts || target.opportunityFacts,
      opportunityFit: parsed.opportunityFit || target.opportunityFit,
      opportunityFitReason: keepText(parsed.opportunityFitReason, target.opportunityFitReason),
      opportunityBreakdown: keepText(parsed.opportunityBreakdown, target.opportunityBreakdown),
      primaryHypothesisPattern: parsed.primaryHypothesisPattern || target.primaryHypothesisPattern,
      naturalQuestion: keepText(parsed.naturalQuestion, target.naturalQuestion),
      forbiddenAngles: parsed.forbiddenAngles?.length ? parsed.forbiddenAngles : target.forbiddenAngles,
      observations: parsed.observations?.length ? parsed.observations : target.observations,
      // aiOutput omitted — keep Firestore document size under 1 MB
    }
  }

  function handleCopyLatestSpecRefreshPrompt() {
    setBatchRefreshError(null)
    if (latestSpecRefreshItems.length === 0) {
      toast.show('最新仕様へ更新する対象がありません', 2000)
      return
    }
    if (!prompts.OS1_REFRESH_BATCH) {
      toast.show('一括更新プロンプトを読み込み中です', 2000)
      return
    }
    const prompt = buildSpecRefreshBatchPrompt(latestSpecRefreshItems, prompts.OS1_REFRESH_BATCH)
    copyText(prompt).then(() => {
      setBatchRefreshCopyState('copied')
      setBatchRefreshPreviewResults([])
      setBatchRefreshPreviewIndex(0)
      setBatchRefreshApprovedMap({})
      setBatchRefreshManualEdits({})
      setBatchRefreshManualFacts({})
      setBatchRefreshOpen(true)
      setTimeout(() => setBatchRefreshCopyState('idle'), 2500)
    }).catch(() => {
      setBatchRefreshError('プロンプトのコピーに失敗しました')
    })
  }

  function handleParseLatestSpecRefresh() {
    setBatchRefreshError(null)
    if (!batchRefreshOutput.trim()) {
      setBatchRefreshError('AI出力を貼り付けてください')
      return
    }
    const results = parseSpecRefreshBatchOutput(batchRefreshOutput, latestSpecRefreshItems)
    if (results.length === 0) {
      setBatchRefreshError('AI出力の形式が認識できませんでした。===SPEC_REFRESH_RESULT_START=== を含めて貼り付けてください。')
      return
    }
    const missingCount = Math.max(0, latestSpecRefreshItems.length - results.length)
    setBatchRefreshPreviewResults(results)
    setBatchRefreshPreviewIndex(0)
    setBatchRefreshApprovedMap({})
    setBatchRefreshError(missingCount > 0
      ? `AI出力の一部が見つかりませんでした。${missingCount}件は未解析のままです。まず各件を確認してください。`
      : null)
  }

  function handleSetLatestSpecEdit(targetId: string, patch: Partial<SpecRefreshParsed>) {
    setBatchRefreshManualEdits(prev => ({
      ...prev,
      [targetId]: {
        ...(prev[targetId] || {}),
        ...patch,
      },
    }))
  }

  function handleSetLatestSpecFacts(targetId: string, patch: Partial<NonNullable<Target['opportunityFacts']>>) {
    setBatchRefreshManualFacts(prev => ({
      ...prev,
      [targetId]: {
        ...(prev[targetId] || {}),
        ...patch,
      },
    }))
  }

  function handleToggleLatestSpecApproval(targetId: string, approved?: boolean) {
    setBatchRefreshApprovedMap(prev => ({
      ...prev,
      [targetId]: approved ?? !prev[targetId],
    }))
  }

  function handleApplyLatestSpecRefresh() {
    setBatchRefreshError(null)
    if (batchRefreshPreviewResults.length === 0) {
      setBatchRefreshError('先にAI出力を解析してください')
      return
    }
    const approvedResults = batchRefreshPreviewResults.filter(r => batchRefreshApprovedMap[r.targetId])
    if (approvedResults.length === 0) {
      setBatchRefreshError('承認した案件がありません。1件以上承認してください')
      return
    }

    const total = batchRefreshPreviewResults.length
    const approvedCount = approvedResults.length
    const byTargetId = new Map(approvedResults.map(r => [r.targetId, r]))

    saveData(prev => {
      const nextTargets = prev.targets.map(target => {
        const result = byTargetId.get(target.id)
        if (!result) return target
        const targetFacts = { ...(result.parsed.opportunityFacts || {}), ...(batchRefreshManualFacts[target.id] || {}) }
        const edited = {
          ...result.parsed,
          ...(batchRefreshManualEdits[target.id] || {}),
          opportunityFacts: Object.values(targetFacts).some(v => v !== undefined) ? targetFacts : undefined,
        } as SpecRefreshParsed
        return getMergedSpecRefreshTarget(target, edited)
      })
      const nextPipeline = prev.pipeline.map(item => {
        const targetId = item.targetId
        if (!targetId) return item
        const result = byTargetId.get(targetId)
        if (!result) return item
        const itemFacts = { ...(result.parsed.opportunityFacts || {}), ...(batchRefreshManualFacts[targetId] || {}) }
        const edited = {
          ...result.parsed,
          ...(batchRefreshManualEdits[targetId] || {}),
          opportunityFacts: Object.values(itemFacts).some(v => v !== undefined) ? itemFacts : undefined,
        } as SpecRefreshParsed
        const merged = getMergedSpecRefreshTarget(item as unknown as Target, edited)
        const { aiOutput: _aiOutput, rawInput: _rawInput, ...pipelineFields } = merged
        return {
          ...item,
          ...pipelineFields,
          os1Output: null, // omitted — keep Firestore document size under 1 MB
          targetId: item.targetId,
          currentStep: item.currentStep,
          stepHistory: item.stepHistory,
          repCount: item.repCount,
          dmCount: item.dmCount,
          analyses: item.analyses,
          history: item.history,
          sentMessages: item.sentMessages,
          replies: item.replies,
          isOpen: item.isOpen,
          closedAt: item.closedAt,
          closedCaseId: item.closedCaseId,
          touches: item.touches,
          lastContactDate: item.lastContactDate,
          temperature: item.temperature,
          last_reaction: item.last_reaction,
          last_reaction_at: item.last_reaction_at,
          todayTask: item.todayTask,
        } as typeof item
      })
      return { ...prev, targets: nextTargets, pipeline: nextPipeline }
    })

    setBatchRefreshOutput('')
    setBatchRefreshPreviewResults([])
    setBatchRefreshPreviewIndex(0)
    setBatchRefreshApprovedMap({})
    setBatchRefreshManualEdits({})
    setBatchRefreshManualFacts({})
    const skipped = Math.max(0, total - approvedCount)
    const summaryMsg = `一括更新完了：${approvedCount}件承認 / ${skipped}件見送り`
    toast.show(summaryMsg, 2500)
    setTimeout(() => setBatchRefreshOpen(false), 1200)
  }

  function buildBatchPrompt(items: Screening[], ch: Mode): string {
    const prompt = ch === 'instagram' ? prompts.OS1_IG : ch === 'threads' ? prompts.OS1_TH : prompts.OS1_X
    if (!prompt) return ''
    const profilesText = items.map((s, i) => {
      const inboundCtx = buildInboundContext(s)
      return `=== 対象${i + 1}：${s.displayName}（${s.handle}）===\n${s.rawProfileText || ''}${inboundCtx}`
    }).join('\n\n')
    return prompt
      + `\n\n---\n■ バッチ処理 ${items.length}件：上記フォーマットで各アカウントを順番に出力してください。アカウントとアカウントの間は「【アカウント情報】」から始まる次の出力で区切られます。\n\n`
      + profilesText
  }

  function handleBatchSubmit(queued: Screening[]) {
    const text = batchResult.trim()
    if (!text) { toast.show('AIの出力を貼り付けてください', 2000); return }
    if (queued.length === 0) { toast.show('待機中のアカウントがありません', 2000); return }

    const segments = text.split(/(?=【アカウント情報】)/).filter(s => s.includes('【アカウント情報】'))
    if (segments.length === 0) {
      toast.show('AIの出力に【アカウント情報】が見つかりません。形式を確認してください', 3000)
      setBatchParseSummary(buildParseSummary(queued.length, 0, ['AI出力に【アカウント情報】が見つかりません']))
      return
    }

    let addedCount = 0
    let pipelineCount = 0
    const errors: string[] = []
    const processedIds = new Set<string>()

    saveData(prev => {
      const d = { ...prev, targets: [...prev.targets], pipeline: [...prev.pipeline], screenings: [...prev.screenings] }
      segments.forEach((seg, i) => {
        const screening = queued[i]
        if (!screening) {
          errors.push(`ITEM ${i + 1}：対象案件が見つかりません`)
          return
        }
        const ch = screening.channel as Mode
        const parsed = ch === 'instagram' ? parseOS1Instagram(seg) : ch === 'threads' ? parseOS1Threads(seg) : parseOS1(seg)
        const parseErrors = getOS1ParseErrors(parsed as Omit<Target, 'id' | 'createdAt'>, ch)
        if (parseErrors.length > 0 && !parsed.accountName && !parsed.url) {
          errors.push(`ITEM ${i + 1}（${screening.displayName || screening.handle || '不明'}）：${parseErrors.join(' / ')}`)
          return
        }

        const targetId = uid()
        const pid = parsed.track !== 'SKIP' ? uid() : null
        const urlFallback = parsed.url || screening.handle || ''
        const newTarget: Target = {
          ...parsed,
          id: targetId,
          createdAt: new Date().toISOString(),
          aiOutput: seg,
          rawInput: screening.rawProfileText,
          pipelineId: pid,
          channel: ch,
          url: urlFallback,
        } as Target
        d.targets.push(newTarget)

        if (pid) {
          d.pipeline.push({
            id: pid, targetId,
            caseId: newTarget.caseId || null,
            os1Output: seg,
            accountName: newTarget.accountName,
            url: urlFallback,
            channel: ch,
            track: newTarget.track as 'FT' | 'NT' | 'UT' | 'SKIP',
            hypothesis: newTarget.hypothesis,
            startDate: newTarget.startDate || todayStr(),
            currentStep: 'S1',
            stepHistory: [{ step: 'S1', date: todayStr() }],
            repCount: 0, dmCount: 0,
            lastContactDate: todayStr(),
            analyses: [], history: [], sentMessages: [], replies: [],
            isOpen: true,
            salesExpectation: newTarget.salesExpectation,
            salesExpectationReason: newTarget.salesExpectationReason,
            salesExpectationBreakdown: newTarget.salesExpectationBreakdown,
            salesExpectationFacts: newTarget.salesExpectationFacts,
            opportunityStatus: newTarget.opportunityStatus,
            opportunityStatusReason: newTarget.opportunityStatusReason,
            prioritySegment: newTarget.prioritySegment,
            prioritySegmentReason: newTarget.prioritySegmentReason,
            opportunityFacts: newTarget.opportunityFacts,
            opportunityFit: newTarget.opportunityFit,
            opportunityFitReason: newTarget.opportunityFitReason,
            opportunityBreakdown: newTarget.opportunityBreakdown,
            partnerFlag: newTarget.partnerFlag,
            trackReason: newTarget.trackReason,
            estimatedProduct: newTarget.estimatedProduct,
            estimatedPrice: newTarget.estimatedPrice,
            primaryHypothesisPattern: newTarget.primaryHypothesisPattern,
            naturalQuestion: newTarget.naturalQuestion,
            forbiddenAngles: newTarget.forbiddenAngles,
            observations: newTarget.observations,
            isInbound: screening.is_inbound || false,
            inboundActions: screening.inbound_actions?.length ? screening.inbound_actions : (screening.signal_type ? [screening.signal_type] : []),
            inbound_signal: screening.is_inbound && screening.signal_type ? {
              type: screening.signal_type,
              date: screening.signal_date || todayStr(),
              memo: screening.signal_memo,
            } : undefined,
            touches: screening.is_inbound ? [buildInitialInboundTouch(screening, todayStr())] : [],
          })
          pipelineCount++
        }
        processedIds.add(screening.id)
        addedCount++
      })
      if (queued.length > segments.length) {
        for (let i = segments.length; i < queued.length; i++) {
          const screening = queued[i]
          errors.push(`ITEM ${i + 1}（${screening?.displayName || screening?.handle || '不明'}）：AI出力が不足しています`)
        }
      }
      d.screenings = d.screenings.filter(s => !processedIds.has(s.id))
      return d
    })

    setBatchResult('')
    setBatchParseSummary(buildParseSummary(queued.length, addedCount, errors))
    setTimeout(() => {
      const summaryMsg = `一括処理完了：${queued.length}件中${addedCount}件成功 / ${queued.length - addedCount}件失敗`
      toast.show(pipelineCount > 0 ? `${summaryMsg}（OS②に${pipelineCount}件追加）` : summaryMsg, 3000)
      if (pipelineCount > 0) setTimeout(() => onGoToTab2(), 1200)
    }, 0)
  }

  function handleForceToOS2(targetId: string) {
    const tgt = data.targets.find(x => x.id === targetId)
    if (!tgt || tgt.pipelineId) return
    const pid = uid()
    saveData(prev => {
      const d = {
        ...prev,
        targets: prev.targets.map(t => t.id === targetId ? { ...t, track: 'NT' as const, pipelineId: pid } : t),
        pipeline: [...prev.pipeline],
      }
      d.pipeline.push({
        id: pid, targetId,
        caseId: tgt.caseId || null, os1Output: tgt.aiOutput || null,
        accountName: tgt.accountName, url: tgt.url, channel: tgt.channel,
        track: 'NT' as const,
        hypothesis: tgt.hypothesis,
        startDate: tgt.startDate || todayStr(),
        currentStep: 'S1', stepHistory: [{ step: 'S1' as const, date: todayStr() }],
        repCount: 0, dmCount: 0, lastContactDate: todayStr(),
        analyses: [], history: [], sentMessages: [], replies: [],
        isOpen: true,
        salesExpectation: tgt.salesExpectation,
        salesExpectationReason: tgt.salesExpectationReason,
        salesExpectationBreakdown: tgt.salesExpectationBreakdown,
        salesExpectationFacts: tgt.salesExpectationFacts,
        opportunityStatus: tgt.opportunityStatus,
        opportunityStatusReason: tgt.opportunityStatusReason,
        prioritySegment: tgt.prioritySegment,
        prioritySegmentReason: tgt.prioritySegmentReason,
        opportunityFacts: tgt.opportunityFacts,
        opportunityFit: tgt.opportunityFit,
        opportunityFitReason: tgt.opportunityFitReason,
        opportunityBreakdown: tgt.opportunityBreakdown,
        partnerFlag: tgt.partnerFlag,
        trackReason: tgt.trackReason,
        estimatedProduct: tgt.estimatedProduct,
        estimatedPrice: tgt.estimatedPrice,
        primaryHypothesisPattern: tgt.primaryHypothesisPattern,
        naturalQuestion: tgt.naturalQuestion,
        forbiddenAngles: tgt.forbiddenAngles,
        observations: tgt.observations,
      })
      return d
    })
    if (continuousMode) {
      toast.show(`「${tgt.accountName}」のSKIPを解除してOS②へ移行しました`, 1500)
      setTimeout(() => advanceContinuous(targetId), 1600)
    } else {
      toast.show(`「${tgt.accountName}」のSKIPを解除してOS②へ移行しました`, 2000)
      setTimeout(() => onGoToTab2(), 1500)
    }
  }

  function handleBackToOS0(targetId: string) {
    const tgt = data.targets.find(x => x.id === targetId)
    if (!tgt) return
    const screening: Screening = {
      id: uid(),
      createdAt: new Date().toISOString(),
      channel: tgt.channel,
      displayName: tgt.accountName,
      handle: tgt.url || tgt.accountName,
      verdict: 'OS①差し戻し',
      reason: 'OS①から差し戻し',
    }
    saveData(prev => {
      const d = {
        ...prev,
        targets: prev.targets.filter(x => x.id !== targetId),
        screenings: [...(prev.screenings || []), screening],
        pipeline: tgt.pipelineId
          ? (prev.pipeline || []).filter(p => p.id !== tgt.pipelineId)
          : prev.pipeline,
      }
      return d
    })
    toast.show(`「${tgt.accountName}」をOS⓪に戻しました`)
    if (continuousMode) {
      advanceContinuous(targetId)
    } else {
      setSelectedId(null)
    }
  }

  function handleDelete(id: string) {
    const tgt = data.targets.find(x => x.id === id)
    if (!tgt) return
    saveData(prev => {
      const d = { ...prev, targets: prev.targets.filter(x => x.id !== id), excluded: [...(prev.excluded || [])], trash: [...(prev.trash || [])] }
      addToExcluded(d, tgt.url || tgt.accountName, tgt.accountName, tgt.channel, tgt.track === 'SKIP' ? 'SKIP' : '手動削除')
      const tid = moveToTrash(d, tgt as unknown as Record<string, unknown>, 'OS①')
      setTimeout(() => {
        toast.showUndo(`「${tgt.accountName}」を削除`, () => {
          saveData(prev2 => {
            const d2 = { ...prev2, trash: [...(prev2.trash || [])], targets: [...prev2.targets], excluded: [...(prev2.excluded || [])] }
            const tidx = d2.trash.findIndex(x => x._trashId === tid)
            if (tidx === -1) return d2
            const restored = { ...d2.trash[tidx] } as Record<string, unknown>
            d2.trash.splice(tidx, 1)
            delete restored._trashSource; delete restored._trashedAt; delete restored._trashId
            d2.excluded = d2.excluded.filter(e => normalizeHandle(e.handle) !== normalizeHandle(tgt.url || tgt.accountName))
            d2.targets = [...d2.targets, restored as unknown as Target]
            return d2
          })
        })
      }, 0)
      return d
    })
    if (selectedId === id) setSelectedId(null)
  }

  function handleToPipeline(targetId: string) {
    const tgt = data.targets.find(x => x.id === targetId)
    if (!tgt || tgt.pipelineId) return
    const pid = uid()
    saveData(prev => {
      const d = { ...prev, targets: prev.targets.map(t => t.id === targetId ? { ...t, pipelineId: pid } : t), pipeline: [...prev.pipeline] }
      d.pipeline.push({
        id: pid,
        targetId,
        caseId: tgt.caseId || null,
        os1Output: tgt.aiOutput || null,
        accountName: tgt.accountName,
        url: tgt.url,
        channel: tgt.channel,
        track: tgt.track as 'FT' | 'NT' | 'UT' | 'SKIP',
        hypothesis: tgt.hypothesis,
        startDate: tgt.startDate || todayStr(),
        currentStep: 'S1',
        stepHistory: [{ step: 'S1', date: todayStr() }],
        repCount: 0,
        dmCount: 0,
        lastContactDate: todayStr(),
        analyses: [],
        history: [],
        sentMessages: [],
        replies: [],
        isOpen: true,
        salesExpectation: tgt.salesExpectation,
        salesExpectationReason: tgt.salesExpectationReason,
        salesExpectationBreakdown: tgt.salesExpectationBreakdown,
        salesExpectationFacts: tgt.salesExpectationFacts,
        opportunityStatus: tgt.opportunityStatus,
        opportunityStatusReason: tgt.opportunityStatusReason,
        prioritySegment: tgt.prioritySegment,
        prioritySegmentReason: tgt.prioritySegmentReason,
        opportunityFacts: tgt.opportunityFacts,
        opportunityFit: tgt.opportunityFit,
        opportunityFitReason: tgt.opportunityFitReason,
        opportunityBreakdown: tgt.opportunityBreakdown,
        partnerFlag: tgt.partnerFlag,
        trackReason: tgt.trackReason,
        estimatedProduct: tgt.estimatedProduct,
        estimatedPrice: tgt.estimatedPrice,
        primaryHypothesisPattern: tgt.primaryHypothesisPattern,
        naturalQuestion: tgt.naturalQuestion,
        forbiddenAngles: tgt.forbiddenAngles,
        observations: tgt.observations,
      })
      return d
    })
    if (continuousMode) {
      toast.show(`「${tgt.accountName}」をOS②に移行しました`, 1500)
      setTimeout(() => advanceContinuous(targetId), 1700)
    } else {
      toast.show(`「${tgt.accountName}」をOS②パイプラインに移行します…`, 2000)
      setTimeout(() => onGoToTab2(), 1500)
    }
  }

  function advanceContinuous(fromId?: string) {
    const list = [...data.targets].reverse()
    const fromTarget = fromId ?? selectedId
    const idx = list.findIndex(t => t.id === fromTarget)
    const next = list[idx + 1]
    if (next) {
      setSelectedId(next.id)
    } else {
      setContinuousMode(false)
      setSelectedId(null)
      toast.show('すべて処理完了しました')
    }
  }

  const allTargets = [...data.targets].reverse()
  const total = allTargets.length
  const totalPages = Math.ceil(total / 10)
  const safePage = Math.min(page, Math.max(0, totalPages - 1))
  const pageTargets = allTargets.slice(safePage * 10, safePage * 10 + 10)
  const selectedTarget = selectedId ? data.targets.find(x => x.id === selectedId) : null
  const latestSpecRefreshCandidates = [...data.targets]
    .filter(isLatestSpecRefreshTarget)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const latestSpecRefreshItems: SpecRefreshBatchItem[] = latestSpecRefreshCandidates.slice(0, batchRefreshLimit).map((target, index) => ({
    index: index + 1,
    target,
  }))
  const currentRefreshPreview = batchRefreshPreviewResults[batchRefreshPreviewIndex] || null
  const currentRefreshTarget = currentRefreshPreview
    ? data.targets.find(t => t.id === currentRefreshPreview.targetId) || null
    : null
  const currentRefreshParsed = currentRefreshPreview?.parsed || null
  const currentRefreshManualEdit = currentRefreshPreview ? (batchRefreshManualEdits[currentRefreshPreview.targetId] || {}) : {}
  const currentRefreshManualFacts = currentRefreshPreview ? (batchRefreshManualFacts[currentRefreshPreview.targetId] || {}) : {}
  const currentRefreshMerged = currentRefreshPreview && currentRefreshTarget
    ? {
        ...currentRefreshParsed,
        ...currentRefreshManualEdit,
        opportunityFacts: {
          ...(currentRefreshParsed?.opportunityFacts || {}),
          ...currentRefreshManualFacts,
        },
      }
    : null
  const currentRefreshApproved = currentRefreshPreview ? !!batchRefreshApprovedMap[currentRefreshPreview.targetId] : false
  const approvedRefreshCount = batchRefreshPreviewResults.filter(r => batchRefreshApprovedMap[r.targetId]).length
  const refreshHasPreview = batchRefreshPreviewResults.length > 0

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const syncBodyScroll = () => {
      document.body.style.overflow = selectedId && media.matches ? 'hidden' : ''
    }
    syncBodyScroll()
    media.addEventListener('change', syncBodyScroll)
    return () => {
      media.removeEventListener('change', syncBodyScroll)
      document.body.style.overflow = ''
    }
  }, [selectedId])

  const chBadge = (ch: string) => {
    if (ch === 'instagram') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-pink-100 text-pink-600"><i className="fa-brands fa-instagram mr-0.5" />IG</span>
    if (ch === 'threads') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700"><i className="fa-brands fa-threads mr-0.5" />TH</span>
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"><i className="fa-brands fa-x-twitter mr-0.5" />X</span>
  }

  const modeInfo = () => {
    if (mode === 'instagram') return {
      bg: 'bg-pink-50 border-pink-200 text-pink-900',
      btnBg: 'background:#fff0f6;border-color:#f9a8d4;color:#be185d',
      text: <><p className="font-bold mb-1"><i className="fa-brands fa-instagram mr-1" />プロンプトをコピーして、スクショと一緒にAI（Gemini等）に貼り付けてください</p><p className="text-pink-700">①スクショ読み取り＋スクリーニングを一発で実行します。</p></>
    }
    if (mode === 'threads') return {
      bg: 'bg-slate-50 border-slate-200 text-slate-700',
      btnBg: 'background:#f8fafc;border-color:#cbd5e1;color:#334155',
      text: <><p className="font-bold mb-1"><i className="fa-brands fa-threads mr-1" />プロンプトをコピーして、スクショと一緒にAI（Gemini等）に貼り付けてください</p><p className="text-slate-500">スクショからプロフィール・投稿・bio情報を読み取り、一発で出力されます。</p></>
    }
    return {
      bg: 'bg-violet-50 border-violet-200 text-violet-900',
      btnBg: 'background:#f5f3ff;border-color:#c4b5fd;color:#6d28d9',
      text: <><p className="font-bold mb-1"><i className="fa-brands fa-x-twitter mr-1" />プロンプトをコピーして、スクショと一緒にAI（Gemini等）に貼り付けてください</p><p className="text-violet-700">①プロフィール画面と②接触対象の投稿画面のスクショを添付するだけで出力されます。</p></>
    }
  }

  const info = modeInfo()

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'fadeIn .2s ease-out' }}>
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-xs text-violet-900">
        <span className="font-bold"><i className="fa-solid fa-stopwatch mr-1" />OS① 設計原則：</span>
        除外5条件に当たらない限り原則すべて接触。1案件60秒以内でスクリーニング完了。複雑な事前採点は廃止。
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: input panel */}
        <section className="lg:col-span-5 flex flex-col gap-3">
          <div className="card p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="font-bold text-sm text-slate-800">プロンプトをコピーしてスクショと一緒にAIへ</span>
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                {(['twitter', 'instagram', 'threads'] as Mode[]).map(m => {
                  const icons = { twitter: 'fa-brands fa-x-twitter', instagram: 'fa-brands fa-instagram', threads: 'fa-brands fa-threads' }
                  const labels = { twitter: 'Twitter', instagram: 'Instagram', threads: 'Threads' }
                  const activeColors = { twitter: 'text-violet-700', instagram: 'text-pink-600', threads: 'text-slate-800' }
                  return (
                    <button
                      key={m}
                      className={`text-xs font-bold px-2.5 py-1 rounded-md transition ${mode === m ? `bg-white ${activeColors[m]} shadow-sm` : 'text-slate-400'}`}
                      onClick={() => setModeAndSave(m)}
                    >
                      <i className={`${icons[m]} mr-1`} />{labels[m]}
                    </button>
                  )
                })}
              </div>
            </div>

            {prefill && (
              <div className="flex items-start gap-2 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 text-xs">
                <i className="fa-solid fa-arrow-right-to-bracket text-violet-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-violet-800">OS⓪から引き継ぎ：</span>
                  <span className="text-violet-700">{prefill.displayName || prefill.handle}</span>
                  {prefill.displayName && prefill.handle && (
                    <span className="text-violet-400 ml-1">@{prefill.handle}</span>
                  )}
                  <p className="text-violet-500 mt-1">
                    <i className="fa-solid fa-circle-info mr-1" />
                    OS⓪バッチ経由の場合はプロフィールテキストが含まれているので<span className="font-bold">スクショ不要</span>。AIにプロンプトのみ貼り付けてください。
                  </p>
                </div>
                <button
                  className="shrink-0 text-violet-300 hover:text-violet-500 p-1"
                  onClick={() => { localStorage.removeItem('os1_prefill'); setPrefill(null) }}
                  title="クリア"
                ><i className="fa-solid fa-xmark" /></button>
              </div>
            )}
            {!prefill && (
              <div className="text-[11px] text-slate-400 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                <i className="fa-solid fa-lightbulb mr-1 text-amber-400" />
                <span className="font-semibold">効率化TIP：</span>OS⓪の「OS①待機へ」でプロフィールを貼り付けると、スクショなしでバッチ処理できます。
              </div>
            )}

            <div className={`rounded-xl p-3 text-xs border ${info.bg}`}>{info.text}</div>

            <button
              className="w-full flex items-center justify-center gap-2 font-bold text-sm py-3 rounded-xl border transition cursor-pointer"
              style={{ ...(Object.fromEntries(info.btnBg.split(';').filter(Boolean).map(s => s.split(':').map(x => x.trim()) as [string, string]).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]))) }}
              onClick={handleCopyPrompt}
            >
              <i className="fa-solid fa-copy" />分析プロンプトをコピー（外部AIにスクショと一緒に貼り付け）
            </button>

            <div className="flex items-center gap-2 pb-2 border-b border-slate-100 mt-1">
              <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
              <span className="font-bold text-sm text-slate-800">AIの出力を貼り付けて記録</span>
            </div>
            <textarea
              className="input-base h-32 cs"
              placeholder="AIが出力した【アカウント情報】〜【初回接触案】のテキストをそのまま貼り付け"
              value={resultText}
              onChange={e => { setResultText(e.target.value); setParseSummary(null) }}
            />
            <button className="btn-primary w-full justify-center text-sm" onClick={handleSubmit}>
              <i className="fa-solid fa-circle-plus" />スクリーニング結果を記録
            </button>
            <ParseSummaryBox summary={parseSummary} />
          </div>
        </section>

        {/* Right: list */}
        <section className="lg:col-span-7 flex flex-col gap-3">
          <div className="card flex flex-col" style={{ minHeight: 520 }}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-filter text-violet-500" />スクリーニング済みリスト
                <span className="badge bg-violet-100 text-violet-700">{data.targets.length}</span>
              </h3>
              <div className="flex items-center gap-1.5 shrink-0">
                {data.targets.length > 0 && (
                  <button
                    className={`text-xs py-1.5 px-2.5 rounded-lg border font-bold transition ${continuousMode ? 'bg-violet-600 text-white border-violet-600' : 'btn-sec text-violet-600 border-violet-300'}`}
                    onClick={() => {
                      if (continuousMode) {
                        setContinuousMode(false)
                        setSelectedId(null)
                      } else {
                        const list = [...data.targets].reverse()
                        setContinuousMode(true)
                        setSelectedId(list[0]?.id ?? null)
                      }
                    }}
                    title="連続処理モード：1件ずつ順番に処理"
                  >
                    <i className="fa-solid fa-forward-step mr-1" />{continuousMode ? '連続処理中' : '連続処理'}
                  </button>
                )}
                {(() => {
                  const eligible = data.targets.filter(t => t.track !== 'SKIP' && !t.pipelineId)
                  if (eligible.length === 0) return null
                  return (
                    <button
                      className="btn-primary text-xs py-1.5 px-3"
                      onClick={handleBulkToPipeline}
                      title={`SKIP以外の未移行${eligible.length}件をまとめてOS②へ`}
                    >
                      <i className="fa-solid fa-arrow-right mr-1" />全員OS②へ（{eligible.length}件）
                    </button>
                  )
                })()}
                {latestSpecRefreshCandidates.length > 0 && (
                  <button
                    className="btn-sec text-xs py-1.5 px-3 border-violet-300 text-violet-700"
                    onClick={() => setBatchRefreshOpen(true)}
                    title={`未設定が残る案件を最新仕様へまとめて更新（${latestSpecRefreshCandidates.length}件候補）`}
                  >
                    <i className="fa-solid fa-arrows-rotate mr-1" />最新仕様へ更新（{latestSpecRefreshCandidates.length}件）
                  </button>
                )}
              </div>
            </div>
            {continuousMode && (() => {
              const idx = allTargets.findIndex(t => t.id === selectedId)
              const pos = idx >= 0 ? idx + 1 : 0
              return (
                <div className="px-4 py-2 bg-violet-50 border-b border-violet-100 flex items-center gap-2 text-xs">
                  <i className="fa-solid fa-forward-step text-violet-500 shrink-0" />
                  <span className="font-bold text-violet-700 flex-1">{pos} / {allTargets.length}件</span>
                  <button
                    className="btn-sec text-xs py-1 px-2.5 shrink-0"
                    disabled={idx <= 0}
                    onClick={() => { if (idx > 0) setSelectedId(allTargets[idx - 1].id) }}
                  >
                    <i className="fa-solid fa-chevron-left" /> 前へ
                  </button>
                  <button
                    className="btn-sec text-xs py-1 px-2.5 shrink-0"
                    disabled={idx >= allTargets.length - 1}
                    onClick={() => advanceContinuous()}
                  >
                    次へ <i className="fa-solid fa-chevron-right" />
                  </button>
                  <button
                    className="text-xs text-slate-400 hover:text-rose-500 px-1.5 transition"
                    onClick={() => { setContinuousMode(false); setSelectedId(null) }}
                  >
                    終了
                  </button>
                </div>
              )
            })()}
            <div className="flex-1 overflow-y-auto cs" id="t1-list">
              {total === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-300 gap-2">
                  <i className="fa-solid fa-filter text-4xl" />
                  <p className="text-sm font-medium">記録がありません</p>
                </div>
              ) : (
                pageTargets.map(t => (
                  <div
                    key={t.id}
                    className={`border-b border-slate-100 py-3 pl-3 pr-1 hover:bg-slate-50 cursor-pointer transition flex items-center gap-2 ${selectedId === t.id ? 'bg-violet-50 border-l-2 border-l-violet-500' : ''}`}
                    onClick={() => setSelectedId(selectedId === t.id ? null : t.id)}
                  >
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${trackBadgeClass(t.track)} tip`}
                      data-tip={TRACK_TIPS[t.track] || t.track}
                    >{t.track}</span>
                    {chBadge(t.channel)}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-800 truncate">{t.accountName || '(名前なし)'}</p>
                      <p className="text-[11px] text-slate-400 truncate">{t.hypothesis || ''}</p>
                    </div>
                    {t.pipelineId && <span className="text-[10px] text-indigo-500 font-semibold"><i className="fa-solid fa-arrow-right mr-0.5" />パイプライン済</span>}
                    <span className="text-[10px] text-slate-300 shrink-0">{new Date(t.createdAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</span>
                    <button
                      className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 active:bg-rose-100 transition"
                      onClick={e => { e.stopPropagation(); handleDelete(t.id) }}
                      aria-label="削除"
                    >
                      <i className="fa-solid fa-trash text-xs" />
                    </button>
                  </div>
                ))
              )}
            </div>
            {totalPages > 1 && (
              <div className="p-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  className="btn-sec text-xs py-1.5 px-3"
                  disabled={safePage === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                ><i className="fa-solid fa-chevron-left" /></button>
                <span className="text-xs text-slate-500">{safePage * 10 + 1}〜{Math.min(safePage * 10 + 10, total)}人目 / 全{total}人</span>
                <button
                  className="btn-sec text-xs py-1.5 px-3"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                ><i className="fa-solid fa-chevron-right" /></button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── 最新仕様へ一括更新モーダル ───────────────────────── */}
      {batchRefreshOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 flex items-center gap-2 bg-violet-50 border-b border-violet-100">
              <i className="fa-solid fa-arrows-rotate text-violet-600" />
              <p className="font-bold text-sm text-violet-800 flex-1">最新仕様へ一括更新（{latestSpecRefreshItems.length}件 / 候補{latestSpecRefreshCandidates.length}件）</p>
              <button
                className="text-slate-400 hover:text-slate-700 p-1"
                onClick={() => {
                  if (approvedRefreshCount > 0) {
                    handleApplyLatestSpecRefresh()
                  } else {
                    setBatchRefreshOpen(false)
                    setBatchRefreshOutput('')
                    setBatchRefreshError(null)
                    setBatchRefreshPreviewResults([])
                    setBatchRefreshPreviewIndex(0)
                    setBatchRefreshApprovedMap({})
                  }
                }}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 flex flex-col gap-0">
              <div className="px-4 pt-4 pb-3 flex flex-col gap-3">
                <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                  旧OS1出力をまとめて最新仕様へ寄せるための再判定です。まずプロンプトをコピーしてAIへ貼り付け、返ってきた結果をそのまま下に貼ってください。
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500">件数</span>
                  {[5, 10].map(n => (
                    <button
                      key={n}
                      className={`px-3 py-1.5 rounded-full border text-xs font-bold transition ${
                        batchRefreshLimit === n
                          ? 'bg-violet-600 border-violet-600 text-white'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300'
                      }`}
                      onClick={() => setBatchRefreshLimit(n as 5 | 10)}
                    >
                      {n}件
                    </button>
                  ))}
                  <span className="text-[11px] text-slate-400 ml-auto">未設定の多い順に先頭から処理</span>
                </div>
                <button
                  className={`w-full py-2.5 text-sm font-bold rounded-xl border transition flex items-center justify-center gap-2 ${
                    batchRefreshCopyState === 'copied'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-violet-600 border-violet-600 text-white hover:bg-violet-700'
                  }`}
                  onClick={handleCopyLatestSpecRefreshPrompt}
                >
                  <i className={`fa-solid ${batchRefreshCopyState === 'copied' ? 'fa-check' : 'fa-copy'}`} />
                  {batchRefreshCopyState === 'copied'
                    ? `✓ ${latestSpecRefreshItems.length}件分の更新プロンプトをコピーしました`
                    : `最新仕様へ更新するプロンプトをコピー（${latestSpecRefreshItems.length}件）`
                  }
                </button>
              </div>

              <div className="border-t border-slate-100 px-4 py-3">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">AIの出力を貼り付けて取り込む</p>
                <textarea
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 bg-slate-50"
                  rows={8}
                  placeholder={"===SPEC_REFRESH_RESULT_START=== 1 ===\n【アカウント情報】...\n===SPEC_REFRESH_RESULT_END=== 1 ===\n\n===SPEC_REFRESH_RESULT_START=== 2 ===\n..."}
                  value={batchRefreshOutput}
                  onChange={e => {
                    setBatchRefreshOutput(e.target.value)
                    setBatchRefreshError(null)
                    setBatchRefreshPreviewResults([])
                    setBatchRefreshPreviewIndex(0)
                    setBatchRefreshApprovedMap({})
                  }}
                />
                {batchRefreshError && (
                  <p className="text-[11px] text-rose-600 mt-1.5 bg-rose-50 rounded-lg px-3 py-2">{batchRefreshError}</p>
                )}
                <button
                  className={`mt-2 w-full py-2.5 text-sm font-bold rounded-xl border transition flex items-center justify-center gap-2 ${
                    refreshHasPreview
                      ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                  onClick={refreshHasPreview ? handleApplyLatestSpecRefresh : handleParseLatestSpecRefresh}
                >
                  <i className={`fa-solid ${refreshHasPreview ? 'fa-floppy-disk' : 'fa-magnifying-glass'}`} />
                  {refreshHasPreview
                    ? `承認済みを保存（${approvedRefreshCount}件）`
                    : '解析して確認へ'
                  }
                </button>
                {refreshHasPreview && (
                  <p className="text-[11px] text-slate-500 mt-2">
                    承認済み {approvedRefreshCount}件 / 全{batchRefreshPreviewResults.length}件。1件ずつ確認してから保存できます。
                  </p>
                )}
              </div>

              {refreshHasPreview && currentRefreshPreview && currentRefreshTarget && (() => {
                const parsed = currentRefreshParsed || currentRefreshPreview.parsed
                const current = currentRefreshTarget
                const merged = currentRefreshMerged || parsed
                const formatFacts = (facts?: typeof current.opportunityFacts) => facts ? formatOpportunityFacts(facts) : '（未設定）'
                const normalize = (v?: string | null) => v && String(v).trim() ? String(v).trim() : '未設定'
                const compareRows = [
                  { label: '営業対象判定', oldValue: getOpportunityStatusLabel(current.opportunityStatus), newValue: getOpportunityStatusLabel(merged.opportunityStatus), highlighted: current.opportunityStatus !== merged.opportunityStatus },
                  { label: '優先セグメント', oldValue: getPrioritySegmentLabel(current.prioritySegment), newValue: getPrioritySegmentLabel(merged.prioritySegment), highlighted: current.prioritySegment !== merged.prioritySegment },
                  { label: '案件適合度', oldValue: getOpportunityFitLabel(current.opportunityFit), newValue: getOpportunityFitLabel(merged.opportunityFit), highlighted: current.opportunityFit !== merged.opportunityFit },
                  { label: '判定メモ', oldValue: normalize(current.opportunityFitReason), newValue: normalize(merged.opportunityFitReason), highlighted: normalize(current.opportunityFitReason) !== normalize(merged.opportunityFitReason) },
                  { label: '観測事実', oldValue: formatFacts(current.opportunityFacts), newValue: formatFacts(merged.opportunityFacts), highlighted: formatFacts(current.opportunityFacts) !== formatFacts(merged.opportunityFacts) },
                  { label: '事前仮説', oldValue: normalize(current.hypothesis), newValue: normalize(merged.hypothesis), highlighted: normalize(current.hypothesis) !== normalize(merged.hypothesis) },
                ]
                const changedCount = compareRows.filter(row => row.highlighted).length
                const unresolvedMissing = [
                  !merged.opportunityStatus ? '営業対象判定' : '',
                  !merged.prioritySegment ? '優先セグメント' : '',
                  !merged.opportunityFit ? '案件適合度' : '',
                  !merged.opportunityFacts || !Object.values(merged.opportunityFacts).some(v => v !== undefined) ? '観測事実' : '',
                ].filter(Boolean) as string[]
                return (
                  <div className="border-t border-slate-100 px-4 py-3 flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">1件ずつ確認</p>
                      <span className="badge bg-violet-100 text-violet-700">{batchRefreshPreviewIndex + 1} / {batchRefreshPreviewResults.length}</span>
                      <span className="badge bg-amber-100 text-amber-700">{changedCount}項目変更</span>
                      <span className={`badge ${currentRefreshApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {currentRefreshApproved ? '承認済み' : '未承認'}
                      </span>
                      {unresolvedMissing.length > 0 && (
                        <span className="badge bg-amber-100 text-amber-700">不足 {unresolvedMissing.length}件</span>
                      )}
                    </div>

                    {unresolvedMissing.length > 0 && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        <p className="font-bold mb-1">この件は未設定が残っています。</p>
                        <p className="mb-2">保存する前に必要な情報を入力してください。</p>
                        <p className="font-semibold mb-1">不足項目: {unresolvedMissing.join(' / ')}</p>
                        <div className="text-[11px] text-amber-800">※ ここを埋めない限り、この件は承認できません。</div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[11px] font-bold text-slate-500 mb-2">旧</p>
                        <div className="space-y-2">
                          <div>
                            <p className="text-[10px] text-slate-400">アカウント</p>
                            <p className="text-sm font-semibold text-slate-800">{current.accountName}</p>
                          </div>
                          {compareRows.map(row => (
                            <div key={`old-${row.label}`}>
                              <p className="text-[10px] text-slate-400">{row.label}</p>
                              <p className={`text-xs whitespace-pre-wrap ${row.highlighted ? 'text-slate-800' : 'text-slate-600'}`}>{row.oldValue}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3">
                        <p className="text-[11px] font-bold text-violet-700 mb-2">新</p>
                        <div className="space-y-2">
                          <div>
                            <p className="text-[10px] text-violet-400">アカウント</p>
                            <p className="text-sm font-semibold text-violet-900">{parsed.accountName || current.accountName}</p>
                          </div>
                          {compareRows.map(row => (
                            <div key={`new-${row.label}`}>
                              <p className="text-[10px] text-violet-400">{row.label}</p>
                              <p className={`text-xs whitespace-pre-wrap ${row.highlighted ? 'text-violet-900 font-medium' : 'text-violet-700'}`}>{row.newValue}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 flex flex-col gap-3">
                      <div>
                        <p className="text-[11px] font-bold text-emerald-700 mb-1">不足情報を入力</p>
                        <p className="text-[11px] text-emerald-700">必要な情報を埋めると、未設定のまま残さずに保存できます。</p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold text-slate-500">営業対象判定</span>
                          <select
                            className="input-base text-sm bg-white"
                            value={merged.opportunityStatus || ''}
                            onChange={e => handleSetLatestSpecEdit(currentRefreshPreview.targetId, { opportunityStatus: (e.target.value || undefined) as SpecRefreshParsed['opportunityStatus'] })}
                          >
                            <option value="">未設定</option>
                            <option value="target">対象</option>
                            <option value="hold">保留</option>
                            <option value="out">対象外</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold text-slate-500">優先セグメント</span>
                          <select
                            className="input-base text-sm bg-white"
                            value={merged.prioritySegment || ''}
                            onChange={e => handleSetLatestSpecEdit(currentRefreshPreview.targetId, { prioritySegment: (e.target.value || undefined) as SpecRefreshParsed['prioritySegment'] })}
                          >
                            <option value="">未設定</option>
                            <option value="utage">UTAGE優先</option>
                            <option value="normal">通常</option>
                            <option value="partner">提携候補</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold text-slate-500">案件適合度</span>
                          <select
                            className="input-base text-sm bg-white"
                            value={merged.opportunityFit || ''}
                            onChange={e => handleSetLatestSpecEdit(currentRefreshPreview.targetId, { opportunityFit: (e.target.value || undefined) as SpecRefreshParsed['opportunityFit'] })}
                          >
                            <option value="">未設定</option>
                            <option value="high">高</option>
                            <option value="medium">中</option>
                            <option value="low">低</option>
                          </select>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {OPPORTUNITY_FACT_ITEMS.map(entry => (
                          <label key={entry.key} className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              className="accent-emerald-600"
                              checked={!!(merged.opportunityFacts?.[entry.key])}
                              onChange={e => handleSetLatestSpecFacts(currentRefreshPreview.targetId, {
                                [entry.key]: e.target.checked ? true : undefined,
                              } as Partial<NonNullable<Target['opportunityFacts']>>)}
                            />
                            <span className="text-slate-700">{entry.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn-sec text-xs py-2 px-3"
                        onClick={() => setBatchRefreshPreviewIndex(i => Math.max(0, i - 1))}
                        disabled={batchRefreshPreviewIndex === 0}
                      >
                        <i className="fa-solid fa-chevron-left mr-1" />前へ
                      </button>
                      <button
                        className="btn-sec text-xs py-2 px-3"
                        onClick={() => setBatchRefreshPreviewIndex(i => Math.min(batchRefreshPreviewResults.length - 1, i + 1))}
                        disabled={batchRefreshPreviewIndex >= batchRefreshPreviewResults.length - 1}
                      >
                        次へ<i className="fa-solid fa-chevron-right ml-1" />
                      </button>
                      <button
                        className={`text-xs font-bold py-2 px-3 rounded-xl border transition ${currentRefreshApproved ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`}
                        disabled={unresolvedMissing.length > 0}
                        onClick={() => handleToggleLatestSpecApproval(currentRefreshPreview.targetId)}
                      >
                        <i className={`fa-solid ${currentRefreshApproved ? 'fa-check' : 'fa-circle-check'} mr-1`} />
                        {currentRefreshApproved ? '承認済み' : 'この件を承認'}
                      </button>
                      <button
                        className="btn-sec text-xs py-2 px-3"
                        onClick={() => {
                          handleToggleLatestSpecApproval(currentRefreshPreview.targetId, false)
                          setBatchRefreshPreviewIndex(i => Math.min(batchRefreshPreviewResults.length - 1, i + 1))
                        }}
                      >
                        <i className="fa-solid fa-forward mr-1" />見送り
                      </button>
                      <button
                        className="btn-sec text-xs py-2 px-3"
                        onClick={() => {
                          const nextMap: Record<string, boolean> = {}
                          batchRefreshPreviewResults.forEach(r => { nextMap[r.targetId] = true })
                          setBatchRefreshApprovedMap(nextMap)
                        }}
                      >
                        <i className="fa-solid fa-list-check mr-1" />全件承認
                      </button>
                    </div>

                    <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                      この件の変更点：
                      {compareRows.filter(row => row.highlighted).length > 0
                        ? <span className="ml-1">{compareRows.filter(row => row.highlighted).map(row => row.label).join(' / ')}</span>
                        : <span className="ml-1">見た目上の差分はありません</span>
                      }
                    </div>
                  </div>
                )
              })()}

              <div className="border-t border-slate-100">
                <p className="text-[11px] text-slate-400 px-4 py-2 font-medium">対象案件</p>
                <div className="divide-y divide-slate-50">
                  {latestSpecRefreshItems.map(item => {
                    const target = item.target
                    const missing = getLatestSpecMissingLabels(target)
                    const isApproved = !!batchRefreshApprovedMap[target.id]
                    return (
                      <div
                        key={target.id}
                        className={`flex items-center gap-3 px-4 py-2.5 ${refreshHasPreview && currentRefreshPreview?.targetId === target.id ? 'bg-violet-50' : ''}`}
                        onClick={() => {
                          const idx = batchRefreshPreviewResults.findIndex(r => r.targetId === target.id)
                          if (idx >= 0) setBatchRefreshPreviewIndex(idx)
                        }}
                      >
                        <span className="text-[11px] font-bold text-slate-400 w-5 shrink-0">{item.index}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs text-slate-800 truncate">{target.accountName}</p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {target.channel.toUpperCase()} / {target.track}
                            {target.pipelineId && <span className="ml-1 text-indigo-500">・OS②連携済</span>}
                            {missing.length > 0 && <span className="ml-1 text-violet-500">・未設定: {missing.join(' / ')}</span>}
                          </p>
                        </div>
                        {refreshHasPreview && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {isApproved ? '承認' : '未承認'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="p-3 border-t border-slate-100 bg-slate-50 text-right">
              <button
                className="btn-sec text-xs py-2 px-4"
                onClick={() => {
                  setBatchRefreshOpen(false)
                  setBatchRefreshOutput('')
                  setBatchRefreshError(null)
                  setBatchRefreshPreviewResults([])
                  setBatchRefreshPreviewIndex(0)
                  setBatchRefreshApprovedMap({})
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedTarget && (
        <div className="max-sm:fixed max-sm:inset-0 max-sm:z-50">
          <button
            type="button"
            aria-label="詳細を閉じる"
            className="sm:hidden absolute inset-0 w-full bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setSelectedId(null)}
          />
          <div className="max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:bg-white max-sm:rounded-t-2xl max-sm:max-h-[85vh] max-sm:overflow-y-auto max-sm:cs">
            <div className="sm:hidden w-10 h-1 bg-slate-200 rounded mx-auto mt-3 mb-1" />
            <TargetDetail
              target={selectedTarget}
              role={role}
              toast={toast}
              confirm={confirm}
              onUpdateFacts={facts => saveData(prev => ({
                ...prev,
                targets: prev.targets.map(target => target.id === selectedTarget.id
                  ? { ...target, opportunityFacts: facts }
                  : target),
                pipeline: prev.pipeline.map(item => item.targetId === selectedTarget.id
                  ? { ...item, opportunityFacts: facts }
                  : item),
              }))}
              onToPipeline={() => handleToPipeline(selectedTarget.id)}
              onBackToOS0={() => handleBackToOS0(selectedTarget.id)}
              onForceToOS2={() => handleForceToOS2(selectedTarget.id)}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      )}

      {/* OS①バッチ処理セクション */}
      {(() => {
        const allQueued = (data.screenings || []).filter(s => s.rawProfileText)
        if (allQueued.length === 0) return null
        const channels: Mode[] = ['twitter', 'instagram', 'threads']
        const chLabel: Record<Mode, string> = { twitter: 'X', instagram: 'Instagram', threads: 'Threads' }
        const chIcon: Record<Mode, string> = { twitter: 'fa-brands fa-x-twitter', instagram: 'fa-brands fa-instagram', threads: 'fa-brands fa-threads' }
        const groups = channels.map(ch => ({ ch, items: allQueued.filter(s => s.channel === ch) })).filter(g => g.items.length > 0)

        return (
          <section className="flex flex-col gap-3">
            <div className="card p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <span className="font-bold text-sm text-slate-800 flex items-center gap-2">
                  <i className="fa-solid fa-layer-group text-violet-500" />OS①バッチ処理
                </span>
                <span className="badge bg-violet-100 text-violet-700">{allQueued.length}件待機中</span>
                {allQueued.length >= 5 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    <i className="fa-solid fa-bolt mr-0.5" />バッチ推奨
                  </span>
                )}
              </div>

              {groups.map(({ ch, items }) => (
                <div key={ch} className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <i className={`${chIcon[ch]} text-slate-500 text-sm`} />
                    <span className="font-bold text-sm text-slate-700">{chLabel[ch]}</span>
                    <span className="badge bg-violet-100 text-violet-700">{items.length}件</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((s, i) => (
                      <span key={s.id} className="flex items-center gap-1 bg-violet-50 border border-violet-200 rounded-lg px-2 py-0.5 text-xs">
                        <span className="text-violet-400 font-mono">#{i + 1}</span>
                        <span className="font-semibold text-violet-800">{s.displayName || s.handle}</span>
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-slate-500"><span className="font-bold text-slate-700">ステップ1：</span>バッチプロンプトをコピー</p>
                      <button
                        className="btn-sec w-full justify-center font-bold"
                        onClick={() => {
                          const full = buildBatchPrompt(items, ch)
                          if (!full) { toast.show('プロンプトを読み込み中です', 2000); return }
                          copyText(full, () => toast.show(`${chLabel[ch]} ${items.length}人分のOS①プロンプトをコピーしました`, 3000))
                        }}
                      >
                        <i className="fa-solid fa-copy text-violet-500" />{items.length}人分コピー（{chLabel[ch]}）
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-slate-500"><span className="font-bold text-slate-700">ステップ2：</span>AI出力を貼り付けて登録</p>
                      <textarea
                        className="input-base h-20 cs text-xs"
                        placeholder={`${items.length}人分の【アカウント情報】〜を貼り付け`}
                        value={batchResult}
                        onChange={e => { setBatchResult(e.target.value); setBatchParseSummary(null) }}
                      />
                      <button
                        className="btn-primary w-full justify-center text-sm"
                        onClick={() => handleBatchSubmit(items)}
                      >
                        <i className="fa-solid fa-circle-check" />{items.length}件を登録してOS②へ
                      </button>
                      <ParseSummaryBox summary={batchParseSummary} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })()}
    </div>
  )
}

function TargetDetail({ target: t, role, toast, confirm, onUpdateFacts, onToPipeline, onBackToOS0, onForceToOS2, onClose }: {
  target: Target
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
  onUpdateFacts: (facts: NonNullable<Target['opportunityFacts']>) => void
  onToPipeline: () => void
  onBackToOS0: () => void
  onForceToOS2: () => void
  onClose: () => void
}) {
  const profileUrl = buildProfileUrl(t.url, t.channel)

  const chIcon = t.channel === 'instagram' ? 'fa-brands fa-instagram text-pink-500'
    : t.channel === 'threads' ? 'fa-brands fa-threads' : 'fa-brands fa-x-twitter'

  function copy(text: string, label: string) {
    copyText(text, () => toast.show(`${label} をコピーしました`), { openGemini: false })
  }

  const msgBtn = (text: string, label: string) => text ? (
    <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap relative">
      {text}
      <div className="flex gap-1 mt-2">
        <button className="btn-sec text-xs py-1 px-2" onClick={() => copy(text, label)}>
          <i className="fa-regular fa-copy" /> コピー
        </button>
      </div>
    </div>
  ) : null

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${trackBadgeClass(t.track)} shrink-0`}>{t.track}</span>
          <i className={chIcon} />
          <h3 className="font-bold text-slate-900 text-base truncate">{t.accountName || '(名前なし)'}</h3>
          {t.caseId && <span className="text-[10px] text-slate-400 shrink-0">案件ID: {t.caseId}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {profileUrl && (
            <a href={profileUrl} target="_blank" rel="noreferrer" className="btn-sec text-xs py-1.5 px-2.5">
              <i className="fa-solid fa-arrow-up-right-from-square text-xs" />プロフィール
            </a>
          )}
          <button
            className="btn-sec text-xs py-1.5 px-2.5 text-slate-500"
            onClick={onBackToOS0}
            title="OS⓪リストに戻す"
          >
            <i className="fa-solid fa-arrow-left text-slate-400 mr-0.5" />OS⓪に戻す
          </button>
          {t.track !== 'SKIP' && (
            t.pipelineId
              ? <span className="text-[11px] text-indigo-500 font-semibold px-2"><i className="fa-solid fa-check mr-1" />OS②済</span>
              : <button className="btn-primary text-xs py-1.5 px-3" onClick={onToPipeline}>
                  <i className="fa-solid fa-arrow-right" />OS②へ移行
                </button>
          )}
          <button className="text-slate-400 hover:text-slate-600 p-1 ml-1" onClick={onClose}>
            <i className="fa-solid fa-xmark text-lg" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {[
          ['フォロワー', t.followers],
          ['業種', t.industry],
          ['推定商品', t.estimatedProduct],
          ['推定単価', t.estimatedPrice],
        ].map(([label, val]) => (
          <div key={label} className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-slate-400 text-[10px]">{label}</p>
            <p className="font-semibold text-slate-700 mt-0.5">{val || '-'}</p>
          </div>
        ))}
      </div>

      {(t.startDate || t.dmRoute || t.partnerFlag || t.nextAction) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {t.startDate && <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-slate-400 text-[10px]">接触開始日</p><p className="font-semibold text-slate-700 mt-0.5">{t.startDate}</p></div>}
          {t.dmRoute && <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-slate-400 text-[10px]">{t.channel === 'twitter' ? 'DM開放' : 'DM導線'}</p><p className="font-semibold text-slate-700 mt-0.5">{t.dmRoute}</p></div>}
          {t.partnerFlag && <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-slate-400 text-[10px]">提携候補</p><p className={`font-semibold mt-0.5 ${t.partnerFlag === '有' ? 'text-rose-600' : 'text-slate-700'}`}>{t.partnerFlag}</p></div>}
        </div>
      )}

      <div className="bg-slate-50 rounded-lg p-3 text-xs">
        <p className="text-slate-400 text-[10px] mb-1">事前仮説</p>
        <p className="text-slate-700">{t.hypothesis || '-'}</p>
      </div>

      <div className="flex flex-col gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
          <div className="bg-white/70 rounded-lg p-2">
            <p className="text-slate-400 text-[10px]">営業対象判定</p>
            <p className="font-bold text-slate-800">{getOpportunityStatusLabel(t.opportunityStatus)}</p>
          </div>
          <div className="bg-white/70 rounded-lg p-2">
            <p className="text-slate-400 text-[10px]">優先セグメント</p>
            <p className={`font-bold ${isUTAGEPriority(t) ? 'text-violet-700' : 'text-slate-800'}`}>{getPrioritySegmentLabel(t.prioritySegment)}</p>
          </div>
          <div className="bg-white/70 rounded-lg p-2">
            <p className="text-slate-400 text-[10px]">案件適合度</p>
            <p className={`font-bold ${t.opportunityFit === 'high' ? 'text-emerald-700' : t.opportunityFit === 'medium' ? 'text-amber-700' : 'text-slate-800'}`}>{getOpportunityFitLabel(t.opportunityFit)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-amber-700">観測事実</p>
          {t.opportunityBreakdown && <span className="text-[10px] text-slate-500">AIの観測候補あり</span>}
        </div>
        {OPPORTUNITY_FACT_ITEMS.map(entry => (
          <label key={entry.key} className={`flex items-center gap-2 ${role === 'admin' ? 'cursor-pointer' : ''}`}>
            <input
              type="checkbox"
              disabled={role !== 'admin'}
              checked={!!t.opportunityFacts?.[entry.key]}
              onChange={event => onUpdateFacts({
                ...(t.opportunityFacts || {}),
                [entry.key]: event.target.checked,
              })}
            />
            <span className="text-[11px] text-slate-700">{entry.label}</span>
          </label>
        ))}
        {t.opportunityStatusReason && (
          <p className="text-[10px] text-slate-600">対象判定理由: {t.opportunityStatusReason}</p>
        )}
        {t.prioritySegmentReason && (
          <p className="text-[10px] text-slate-600">セグメント理由: {t.prioritySegmentReason}</p>
        )}
        {t.opportunityFitReason && (
          <p className="text-[10px] text-slate-600">判定メモ: {t.opportunityFitReason}</p>
        )}
        {t.opportunityBreakdown && (
          <details className="mt-1">
            <summary className="text-[10px] text-slate-500 cursor-pointer">AIの観測候補を見る</summary>
            <pre className="mt-1 text-[10px] text-slate-600 whitespace-pre-wrap">{t.opportunityBreakdown}</pre>
          </details>
        )}
        {!t.opportunityFacts && t.salesExpectation !== undefined && (
          <p className="text-[10px] text-slate-500">観測スコア：{t.salesExpectation}点（参考）— 観測事実をチェックすると新方式へ移行します。</p>
        )}
      </div>

      {t.track === 'SKIP' ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs flex flex-col gap-2">
          <p className="text-amber-700 font-semibold"><i className="fa-solid fa-ban mr-1" />SKIP理由</p>
          <p className="text-amber-800">{t.skipReason || '（理由なし）'}</p>
          {t.pipelineId ? (
            <span className="text-[11px] text-indigo-500 font-semibold self-start"><i className="fa-solid fa-check mr-1" />OS②移行済み（SKIP解除済）</span>
          ) : (
            <div className="flex items-start gap-2 pt-1 border-t border-amber-200">
              <p className="text-[11px] text-slate-500 flex-1">SKIP理由が「該当なし」など誤判定の場合、強制的にOS②へ移行できます（NTトラックで登録）。</p>
              <button
                className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
                onClick={onForceToOS2}
              >
                <i className="fa-solid fa-arrow-right mr-1" />SKIPを解除してOS②へ
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-bold text-sm text-slate-700">▼リプ案（S1用）</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {t.contactA && (
              <div>
                <p className="text-[10px] text-violet-600 font-bold mb-1">案A（実行案）</p>
                {msgBtn(t.contactA, '案A')}
              </div>
            )}
            {t.contactB && (
              <div>
                <p className="text-[10px] text-indigo-500 font-bold mb-1">案B（予備案）</p>
                {msgBtn(t.contactB, '案B')}
              </div>
            )}
          </div>

          {(t.storyA || t.storyB || t.storyNote) && (
            <>
              <p className="font-bold text-sm text-slate-700">▼ストーリー返信案</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {t.storyA && <div><p className="text-[10px] text-pink-600 font-bold mb-1">案A</p>{msgBtn(t.storyA, 'ストーリーA')}</div>}
                {t.storyB && <div><p className="text-[10px] text-pink-400 font-bold mb-1">案B</p>{msgBtn(t.storyB, 'ストーリーB')}</div>}
                {t.storyNote && !t.storyA && <p className="text-xs text-slate-600">{t.storyNote}</p>}
              </div>
            </>
          )}

          {(t.dmA || t.dmB || t.dmNote) && (
            <>
              <p className="font-bold text-sm text-slate-700">▼初回DM案</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {t.dmA && <div><p className="text-[10px] text-violet-600 font-bold mb-1">案A</p>{msgBtn(t.dmA, 'DM案A')}</div>}
                {t.dmB && <div><p className="text-[10px] text-indigo-500 font-bold mb-1">案B</p>{msgBtn(t.dmB, 'DM案B')}</div>}
                {t.dmNote && !t.dmA && <p className="text-xs text-slate-600">{t.dmNote}</p>}
              </div>
            </>
          )}
        </div>
      )}

    </div>
  )
}
