import {
  DEFAULT_CONNECTION_STATE,
  DEFAULT_RUN_STATE,
  type BridgeRelay,
  type ConnectionState,
  type DivizeroPingReport,
  type GeminiAborted,
  type GeminiCaptured,
  type GeminiImportResult,
  type GeminiPrepare,
  type PopupCommand,
  type PopupResponse,
  type QueueItem,
  type RunError,
  type RunState,
  type XAccount,
  type XCommand,
  type XListResult,
  type XProfile,
  type XProfileResult,
} from './shared/protocol'
import {
  loadConnectionState,
  loadRunState,
  saveConnectionState,
  saveRunState,
} from './shared/storage'

const DIVIZERO_ORIGINS = ['https://divizero.vercel.app/', 'http://localhost:5173/']
const GEMINI_ORIGIN = 'https://gemini.google.com/'
const THROTTLE_MIN_MS = 3_000
const THROTTLE_MAX_MS = 8_000
const POST_COUNT = 5

let pumpInFlight = false

function makeRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function clampLimitN(value: number): number {
  return Math.max(1, Math.min(30, Number.isFinite(value) ? Math.floor(value) : 10))
}

function nowIso(): string {
  return new Date().toISOString()
}

function randomThrottle(): number {
  return Math.floor(Math.random() * (THROTTLE_MAX_MS - THROTTLE_MIN_MS + 1)) + THROTTLE_MIN_MS
}

function handleError(state: RunState, message: string): RunState {
  const error: RunError = { at: nowIso(), phase: state.phase, message }
  return {
    ...state,
    phase: 'ERROR',
    endedAt: nowIso(),
    message,
    errors: [...state.errors, error],
  }
}

async function updateRunState(mutator: (state: RunState) => RunState): Promise<RunState> {
  const current = await loadRunState()
  const next = mutator(current)
  await saveRunState(next)
  return next
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

function isXUrl(url: string | undefined): boolean {
  return Boolean(url && /^https:\/\/(x|twitter)\.com\//.test(url))
}

async function findTabByPrefix(prefixes: string[]): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({})
  return tabs.find(tab => tab.url && prefixes.some(prefix => tab.url!.startsWith(prefix)))
}

async function waitForTabComplete(tabId: number): Promise<void> {
  const existing = await chrome.tabs.get(tabId)
  if (existing.status === 'complete') return

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('タブの読み込みが完了しませんでした'))
    }, 15_000)

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }

    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function ensureTab(
  prefixes: string[],
  createUrl: string,
  key: 'divizeroTabId' | 'geminiTabId',
  options: { refreshOnReuse?: boolean } = {},
): Promise<number> {
  const state = await loadRunState()
  const candidateId = state[key]

  if (candidateId) {
    try {
      const tab = await chrome.tabs.get(candidateId)
      if (tab.url && prefixes.some(prefix => tab.url.startsWith(prefix))) {
        await chrome.tabs.update(candidateId, { active: true })
        if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true })
        if (options.refreshOnReuse) {
          await chrome.tabs.reload(candidateId)
        }
        await waitForTabComplete(candidateId)
        return candidateId
      }
    } catch {
      // fall through
    }
  }

  const existing = await findTabByPrefix(prefixes)
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true })
    if (options.refreshOnReuse) {
      await chrome.tabs.reload(existing.id)
    }
    await waitForTabComplete(existing.id)
    await updateRunState(current => ({ ...current, [key]: existing.id }))
    return existing.id
  }

  const created = await chrome.tabs.create({ url: createUrl, active: true })
  if (!created.id) throw new Error('タブを作成できませんでした')
  await waitForTabComplete(created.id)
  await updateRunState(current => ({ ...current, [key]: created.id }))
  return created.id
}

async function sendTabMessage<TMessage, TResponse>(tabId: number, message: TMessage): Promise<TResponse> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<TResponse>
}

async function injectContentScript(tabId: number, file: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
  })
}

async function bridgeCall(type: string, payload: unknown): Promise<unknown> {
  const tabId = await ensureTab(DIVIZERO_ORIGINS, DIVIZERO_ORIGINS[0], 'divizeroTabId')
  const relay: BridgeRelay = { cmd: 'BRIDGE', type, payload }
  try {
    return await sendTabMessage<BridgeRelay, unknown>(tabId, relay)
  } catch (error) {
    await injectContentScript(tabId, 'content/divizero.js')
    return sendTabMessage<BridgeRelay, unknown>(tabId, relay)
  }
}

function formatOs0Prompt(promptText: string, accounts: XAccount[]): string {
  const accountLines = accounts.map(a => `${a.displayName}｜${a.handle}｜${a.bio}`)
  const dataBlock = [
    '※拡張機能による自動抽出データ（UIノイズ除去済み）。形式：表示名｜@ハンドル｜bio、1行1アカウント：',
    '',
    ...accountLines,
  ].join('\n')
  const excludedNote = '（アプリ側で照合済みのため対象外リストなし）'

  // Detect current prompt structure: 【入力データ】 … 【除外済みアカウント…】
  const INPUT_MARKER = '【入力データ】'
  const EXCLUDED_MARKER = '【除外済みアカウント'
  const inputIdx = promptText.indexOf(INPUT_MARKER)
  const excludedIdx = promptText.lastIndexOf(EXCLUDED_MARKER)

  if (inputIdx >= 0 && excludedIdx > inputIdx) {
    // Inject accounts into 【入力データ】 section (before the excluded section)
    const before = promptText.slice(0, excludedIdx).trimEnd()
    const excludedSection = promptText.slice(excludedIdx)
    // Add note on the line after the excluded section header
    const firstNewline = excludedSection.indexOf('\n') + 1
    const excludedWithNote =
      excludedSection.slice(0, firstNewline) + excludedNote + '\n' + excludedSection.slice(firstNewline)
    return `${before}\n\n${dataBlock}\n\n${excludedWithNote}`.trim()
  }

  // Fallback for older prompt format without 【入力データ】 section
  const oldMarker = '【除外済みアカウント】'
  const promptWithNote = promptText.includes(oldMarker)
    ? promptText.replace(oldMarker, `${oldMarker}\n${excludedNote}`)
    : `${promptText}\n\n${oldMarker}\n${excludedNote}`
  return `${promptWithNote}\n\n${dataBlock}`.trim()
}

function formatOs1Prompt(promptText: string, profile: XProfile): string {
  const tweetLines = profile.posts
    .slice(0, POST_COUNT)
    .map((post, index) => `${index + 1}.（${post.relativeTime || '時刻不明'}）${post.text}`)
    .join('\n')

  const body = [
    '【①プロフィール情報】',
    `アカウント名：${profile.displayName}`,
    `ユーザーネーム：${profile.handle}`,
    `bio：${profile.bio || '無'}`,
    `フォロワー数：${profile.followers || '不明'}／フォロー数：${profile.following || '不明'}／ポスト数：${profile.postsCount || '不明'}`,
    `bioリンク：${profile.bioLink || '無'}`,
    `固定ポスト：${profile.pinnedPost || '無'}`,
    '',
    `【②ツイート一覧（最新${Math.min(profile.posts.length, POST_COUNT)}件・上から新しい順）】`,
    tweetLines || '1.（取得失敗）本文を取得できませんでした',
    '',
    '【③接触対象ツイート】',
    `上記1件目（最新投稿）を接触対象とする。投稿日時：${profile.posts[0]?.relativeTime || '不明'}`,
    '',
    '【④リプ欄サンプル】無',
  ]

  return `${promptText}\n\n${body.join('\n')}`.trim()
}

async function pauseForResidual(waitUntil: number): Promise<boolean> {
  const remaining = waitUntil - Date.now()
  if (remaining <= 0) return true
  setTimeout(() => {
    void schedulePump()
  }, remaining)
  return false
}

async function doOs0Capture(state: RunState): Promise<boolean> {
  const sourceTabId = state.os0SourceTabId
  if (!sourceTabId) {
    await saveRunState(handleError(state, 'Xタブが見つかりません'))
    return false
  }

  let listResult: XListResult
  try {
    await injectContentScript(sourceTabId, 'content/x.js')
    listResult = await sendTabMessage<XCommand, XListResult>(sourceTabId, { cmd: 'X_EXTRACT_LIST' })
  } catch (error) {
    await saveRunState(handleError(state, error instanceof Error ? error.message : 'X一覧の取得に失敗しました'))
    return false
  }

  if (!listResult.ok || listResult.accounts.length === 0) {
    await saveRunState(handleError(state, listResult.error || '一覧ページで実行してください'))
    return false
  }

  const excludedResponse = (await bridgeCall('GET_EXCLUDED', { channel: 'twitter' })) as { handles?: string[] }
  const excluded = new Set((excludedResponse.handles ?? []).map(handle => handle.toLowerCase()))
  const candidates = listResult.accounts.filter(account => !excluded.has(account.handle.toLowerCase()))

  if (candidates.length === 0) {
    await saveRunState({
      ...state,
      phase: 'DONE',
      endedAt: nowIso(),
      message: '新規候補なし',
      stats: { ...state.stats, os0Captured: listResult.accounts.length },
    })
    return false
  }

  const promptResponse = (await bridgeCall('GET_PROMPT', { key: 'OS0_X' })) as { text?: string; ready?: boolean }
  if (!promptResponse.ready || !promptResponse.text) {
    await saveRunState(handleError(state, 'divizero から OS0_X を取得できませんでした'))
    return false
  }

  await saveRunState({
    ...state,
    phase: 'OS0_GEMINI',
    os0PageType: listResult.pageType,
    currentDraft: formatOs0Prompt(promptResponse.text, candidates),
    currentRawInput: candidates.map(account => `${account.displayName}｜${account.handle}｜${account.bio}`).join('\n'),
    message: 'Gemini 送信待ち',
    stats: { ...state.stats, os0Captured: listResult.accounts.length },
  })
  return true
}

async function prepareGemini(state: RunState): Promise<boolean> {
  if (!state.currentDraft || !state.currentDraft.trim()) {
    await saveRunState(handleError(state, 'Gemini に渡す下書きがありません'))
    return false
  }

  try {
    const tabId = await ensureTab([GEMINI_ORIGIN], GEMINI_ORIGIN, 'geminiTabId', { refreshOnReuse: true })
    await injectContentScript(tabId, 'content/gemini.js')
    const label =
      state.phase === 'OS0_GEMINI'
        ? 'OS⓪ 一次選別'
        : `OS① 接触スクリーニング（${Math.min(state.currentIndex + 1, Math.max(state.queue.length, 1))}/${Math.max(state.queue.length, 1)}）`
    const message: GeminiPrepare = {
      cmd: 'GEMINI_PREPARE',
      draftText: state.currentDraft,
      stepLabel: label,
      draftLength: state.currentDraft.length,
      draftPreview: state.currentDraft.slice(0, 180),
    }
    await sendTabMessage<GeminiPrepare, { ok: boolean }>(tabId, message)
    return false
  } catch (error) {
    await saveRunState(handleError(state, error instanceof Error ? error.message : 'Gemini タブに接続できませんでした'))
    return false
  }
}

async function doOs0Import(state: RunState): Promise<boolean> {
  const response = (await bridgeCall('OS0_IMPORT', {
    aiOutput: state.currentCapturedText ?? '',
    channel: 'twitter',
    rawInput: state.currentRawInput ?? '',
    sourceContext: {
      platform: 'twitter',
      pageType: state.os0PageType ?? 'unknown',
      url: state.os0SourceUrl ?? '',
      collectedBy: 'chrome-extension',
      collectedAt: nowIso(),
    },
  })) as
    | { ok: true; passed: Array<{ id: string; handle: string; displayName: string }>; missing?: string[] }
    | { ok: false; missing?: string[] }

  if (!response.ok) {
    await saveRunState(handleError(state, `OS0_IMPORT 失敗: ${(response.missing ?? []).join(', ') || 'unknown'}`))
    return false
  }

  const queue: QueueItem[] = response.passed.slice(0, state.limitN).map(item => ({
    screeningId: item.id,
    handle: item.handle.replace(/^@/, ''),
    displayName: item.displayName,
  }))

  if (queue.length === 0) {
    await saveRunState({
      ...state,
      phase: 'DONE',
      endedAt: nowIso(),
      queue: [],
      currentIndex: 0,
      message: '新規候補なし',
      stats: { ...state.stats, os0Passed: 0 },
    })
    return false
  }

  await saveRunState({
    ...state,
    phase: 'OS1_NAV',
    queue,
    currentIndex: 0,
    currentDraft: undefined,
    currentRawInput: undefined,
    currentCapturedText: undefined,
    currentHandle: queue[0]?.handle,
    message: queue.length < response.passed.length ? `上限 ${state.limitN} 件に制限しました` : 'OS①へ進行中',
    stats: { ...state.stats, os0Passed: queue.length },
  })
  return true
}

async function doOs1Nav(state: RunState): Promise<boolean> {
  if (state.currentIndex >= state.queue.length) {
    await saveRunState({ ...state, phase: 'DONE', endedAt: nowIso(), message: '完了しました' })
    return false
  }

  if (!state.waitUntil) {
    await saveRunState({
      ...state,
      waitUntil: Date.now() + randomThrottle(),
      currentHandle: state.queue[state.currentIndex]?.handle,
    })
    return true
  }

  const ready = await pauseForResidual(state.waitUntil)
  if (!ready) return false

  const sourceTabId = state.os0SourceTabId
  const queueItem = state.queue[state.currentIndex]
  if (!sourceTabId || !queueItem) {
    await saveRunState(handleError(state, 'OS①対象アカウントを特定できませんでした'))
    return false
  }

  try {
    await chrome.tabs.update(sourceTabId, { url: `https://x.com/${queueItem.handle}`, active: true })
    await waitForTabComplete(sourceTabId)
    await new Promise(resolve => setTimeout(resolve, 1500))
  } catch (error) {
    await saveRunState(handleError(state, error instanceof Error ? error.message : 'Xプロフィール遷移に失敗しました'))
    return false
  }

  await saveRunState({
    ...state,
    phase: 'OS1_CAPTURE',
    waitUntil: undefined,
    currentHandle: queueItem.handle,
    message: `${queueItem.handle} のプロフィール取得中`,
  })
  return true
}

async function doOs1Capture(state: RunState): Promise<boolean> {
  const sourceTabId = state.os0SourceTabId
  const queueItem = state.queue[state.currentIndex]
  if (!sourceTabId || !queueItem) {
    await saveRunState(handleError(state, 'OS①対象アカウントが見つかりません'))
    return false
  }

  let profileResult: XProfileResult
  try {
    await injectContentScript(sourceTabId, 'content/x.js')
    profileResult = await sendTabMessage<XCommand, XProfileResult>(sourceTabId, {
      cmd: 'X_EXTRACT_PROFILE',
      postCount: POST_COUNT,
    })
  } catch (error) {
    const failed = {
      ...state,
      phase: 'OS1_NAV',
      currentIndex: state.currentIndex + 1,
      currentDraft: undefined,
      currentRawInput: undefined,
      errors: [...state.errors, { at: nowIso(), phase: state.phase, message: String(error) }],
      stats: { ...state.stats, os1Failed: state.stats.os1Failed + 1 },
    }
    await saveRunState(failed)
    return true
  }

  if (!profileResult.ok || !profileResult.profile) {
    await saveRunState({
      ...state,
      phase: 'OS1_NAV',
      currentIndex: state.currentIndex + 1,
      currentDraft: undefined,
      currentRawInput: undefined,
      errors: [
        ...state.errors,
        { at: nowIso(), phase: state.phase, message: `${queueItem.handle}: ${profileResult.error || 'profile missing'}` },
      ],
      stats: { ...state.stats, os1Failed: state.stats.os1Failed + 1 },
    })
    return true
  }

  const promptResponse = (await bridgeCall('GET_PROMPT', { key: 'OS1_X' })) as { text?: string; ready?: boolean }
  if (!promptResponse.ready || !promptResponse.text) {
    await saveRunState(handleError(state, 'divizero から OS1_X を取得できませんでした'))
    return false
  }

  const rawInput = formatOs1Prompt('', profileResult.profile)

  await saveRunState({
    ...state,
    phase: 'OS1_GEMINI',
    currentDraft: formatOs1Prompt(promptResponse.text, profileResult.profile),
    currentRawInput: rawInput,
    currentHandle: queueItem.handle,
    message: `${queueItem.handle} の Gemini 送信待ち`,
  })
  return true
}

async function notifyGeminiImport(geminiTabId: number | undefined, ok: boolean, message: string): Promise<void> {
  if (!geminiTabId) return
  const msg: GeminiImportResult = { cmd: 'GEMINI_IMPORT_RESULT', ok, message }
  try {
    await sendTabMessage<GeminiImportResult, unknown>(geminiTabId, msg)
  } catch {
    // Gemini tab may be closed or content script not ready — ignore
  }
}

async function doOs1Import(state: RunState): Promise<boolean> {
  const queueItem = state.queue[state.currentIndex]
  if (!queueItem) {
    await saveRunState(handleError(state, 'OS①対象がありません'))
    return false
  }

  let response: { ok: boolean; missing?: string[]; code?: string }
  try {
    response = (await bridgeCall('OS1_IMPORT', {
      aiOutput: state.currentCapturedText ?? '',
      channel: 'twitter',
      screeningId: queueItem.screeningId,
      rawInput: state.currentRawInput ?? '',
      sourceContext: {
        platform: 'twitter',
        pageType: 'profile',
        url: `https://x.com/${queueItem.handle}`,
        collectedBy: 'chrome-extension',
        collectedAt: nowIso(),
      },
    })) as { ok: boolean; missing?: string[]; code?: string }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'bridge exception'
    await notifyGeminiImport(state.geminiTabId, false, `取込失敗: ${errMsg}`)
    await saveRunState({
      ...state,
      phase: 'OS1_NAV',
      currentIndex: state.currentIndex + 1,
      currentDraft: undefined,
      currentRawInput: undefined,
      currentCapturedText: undefined,
      errors: [
        ...state.errors,
        { at: nowIso(), phase: state.phase, message: `${queueItem.handle}: ${errMsg}` },
      ],
      stats: { ...state.stats, os1Failed: state.stats.os1Failed + 1 },
    })
    return true
  }

  if (!response.ok) {
    const reason = (response.missing ?? []).join(', ') || response.code || 'OS1_IMPORT failed'
    await notifyGeminiImport(state.geminiTabId, false, `取込失敗: ${reason}`)
    await saveRunState({
      ...state,
      phase: 'OS1_NAV',
      currentIndex: state.currentIndex + 1,
      currentDraft: undefined,
      currentRawInput: undefined,
      currentCapturedText: undefined,
      errors: [
        ...state.errors,
        {
          at: nowIso(),
          phase: state.phase,
          message: `${queueItem.handle}: ${reason}`,
        },
      ],
      stats: { ...state.stats, os1Failed: state.stats.os1Failed + 1 },
    })
    return true
  }

  await notifyGeminiImport(state.geminiTabId, true, `✓ ${queueItem.handle} を取り込みました（OS①・OS②に追加）`)
  await saveRunState({
    ...state,
    phase: 'OS1_NAV',
    currentIndex: state.currentIndex + 1,
    currentDraft: undefined,
    currentRawInput: undefined,
    currentCapturedText: undefined,
    stats: { ...state.stats, os1Done: state.stats.os1Done + 1 },
    message: `${queueItem.handle} を取り込みました`,
  })
  return true
}

async function pumpOnce(state: RunState): Promise<boolean> {
  switch (state.phase) {
    case 'OS0_CAPTURE':
      return doOs0Capture(state)
    case 'OS0_GEMINI':
      return prepareGemini(state)
    case 'OS0_IMPORT':
      return doOs0Import(state)
    case 'OS1_NAV':
      return doOs1Nav(state)
    case 'OS1_CAPTURE':
      return doOs1Capture(state)
    case 'OS1_GEMINI':
      return prepareGemini(state)
    case 'OS1_IMPORT':
      return doOs1Import(state)
    default:
      return false
  }
}

async function schedulePump(): Promise<void> {
  if (pumpInFlight) return
  pumpInFlight = true
  try {
    let keepGoing = true
    while (keepGoing) {
      const state = await loadRunState()
      keepGoing = await pumpOnce(state)
    }
  } finally {
    pumpInFlight = false
  }
}

async function startRunFromQueue(limitN: number): Promise<PopupResponse> {
  const connection = await loadConnectionState()
  const current = await loadRunState()

  // Require an already-open app tab — never auto-open Vercel here,
  // because the user's data lives on whichever instance they have open.
  const appTab = await findTabByPrefix(DIVIZERO_ORIGINS)
  if (!appTab?.id) {
    return {
      ok: false,
      message: 'アプリ（localhost:5173 または divizero.vercel.app）を先にブラウザで開いてください',
      runState: current,
      connection,
    }
  }

  // Pre-save the tab ID so ensureTab inside bridgeCall reuses it without touching Vercel.
  await saveRunState({ ...current, divizeroTabId: appTab.id })

  // Load pending screenings from the app.
  let queueItems: Array<{ id: string; handle: string; displayName: string }> = []
  try {
    const res = (await bridgeCall('GET_OS0_QUEUE', { channel: 'twitter' })) as { items?: typeof queueItems }
    queueItems = res.items ?? []
  } catch {
    return {
      ok: false,
      message: 'appに接続できませんでした（アプリを再読み込みして再試行）',
      runState: current,
      connection,
    }
  }

  if (queueItems.length === 0) {
    return {
      ok: false,
      message: 'OS⓪待機中のアカウントがありません（Tab0でアカウントを追加してください）',
      runState: current,
      connection,
    }
  }

  // Find or create an X tab for profile navigation.
  let xTabId: number | undefined
  const activeTab = await getActiveTab()
  if (activeTab?.id && isXUrl(activeTab.url)) {
    xTabId = activeTab.id
  } else {
    const existing = await findTabByPrefix(['https://x.com/', 'https://twitter.com/'])
    if (existing?.id) {
      xTabId = existing.id
    } else {
      const created = await chrome.tabs.create({ url: 'https://x.com/', active: true })
      if (!created.id) return { ok: false, message: 'Xタブを作成できませんでした', runState: current, connection }
      await waitForTabComplete(created.id)
      xTabId = created.id
    }
  }

  const queue: QueueItem[] = queueItems.slice(0, clampLimitN(limitN)).map(item => ({
    screeningId: item.id,
    handle: item.handle.replace(/^@/, ''),
    displayName: item.displayName,
  }))

  const nextState: RunState = {
    ...DEFAULT_RUN_STATE,
    runId: makeRunId(),
    phase: 'OS1_NAV',
    channel: 'twitter',
    limitN: clampLimitN(limitN),
    os0SourceTabId: xTabId,
    divizeroTabId: appTab.id,
    queue,
    currentIndex: 0,
    currentHandle: queue[0]?.handle,
    startedAt: nowIso(),
    message: `OS⓪スキップ → ${queue.length}件をOS①処理します`,
    stats: { ...DEFAULT_RUN_STATE.stats, os0Passed: queue.length },
  }

  await saveRunState(nextState)
  void schedulePump()
  return { ok: true, runState: nextState, connection }
}

async function startRun(limitN: number): Promise<PopupResponse> {
  const activeTab = await getActiveTab()
  const connection = await loadConnectionState()
  const current = await loadRunState()

  if (!activeTab?.id || !isXUrl(activeTab.url)) {
    return { ok: false, message: 'Xの検索結果かフォロワー一覧を開いてから押してください', runState: current, connection }
  }

  const nextState: RunState = {
    ...DEFAULT_RUN_STATE,
    runId: makeRunId(),
    phase: 'OS0_CAPTURE',
    channel: 'twitter',
    limitN: clampLimitN(limitN),
    os0SourceTabId: activeTab.id,
    os0SourceUrl: activeTab.url,
    startedAt: nowIso(),
    message: 'OS⓪を開始します',
  }

  await saveRunState(nextState)
  void schedulePump()
  return { ok: true, runState: nextState, connection }
}

async function pauseRun(): Promise<PopupResponse> {
  const runState = await updateRunState(state =>
    state.phase === 'IDLE' || state.phase === 'DONE' || state.phase === 'ERROR' || state.phase === 'PAUSED'
      ? state
      : { ...state, prevPhase: state.phase, phase: 'PAUSED', message: '一時停止中' },
  )
  return { ok: true, runState, connection: await loadConnectionState() }
}

async function resumeRun(): Promise<PopupResponse> {
  const runState = await updateRunState(state => {
    if (state.phase === 'PAUSED' && state.prevPhase) {
      return { ...state, phase: state.prevPhase, prevPhase: undefined, message: '再開します' }
    }
    return state
  })
  void schedulePump()
  return { ok: true, runState, connection: await loadConnectionState() }
}

async function abortRun(): Promise<PopupResponse> {
  const runState = await updateRunState(state => ({
    ...state,
    phase: 'IDLE',
    prevPhase: undefined,
    currentDraft: undefined,
    currentRawInput: undefined,
    currentCapturedText: undefined,
    waitUntil: undefined,
    message: '中止しました',
  }))
  return { ok: true, runState, connection: await loadConnectionState() }
}

async function handlePopupCommand(message: PopupCommand): Promise<PopupResponse> {
  switch (message.cmd) {
    case 'POPUP_START':
      return startRun(message.limitN)
    case 'POPUP_START_FROM_QUEUE':
      return startRunFromQueue(message.limitN)
    case 'POPUP_PAUSE':
      return pauseRun()
    case 'POPUP_RESUME':
      return resumeRun()
    case 'POPUP_ABORT':
      return abortRun()
    case 'POPUP_STATUS':
      return { ok: true, runState: await loadRunState(), connection: await loadConnectionState() }
  }
}

chrome.runtime.onMessage.addListener((message: PopupCommand | GeminiCaptured | GeminiAborted | DivizeroPingReport, _sender, sendResponse) => {
  if ('cmd' in message && message.cmd === 'DIVIZERO_PING_REPORT') {
    const report = message as DivizeroPingReport
    const connection: ConnectionState = report.ok
      ? { status: 'connected', version: report.version, updatedAt: nowIso() }
      : { status: 'error', error: report.error, updatedAt: nowIso() }
    void saveConnectionState(connection).then(() => sendResponse({ ok: true }))
    return true
  }

  if ('cmd' in message && message.cmd === 'GEMINI_CAPTURED') {
    void updateRunState(state => ({
      ...state,
      currentCapturedText: message.clipboardText,
      phase: state.phase === 'OS0_GEMINI' ? 'OS0_IMPORT' : 'OS1_IMPORT',
      message: '取込処理へ進みます',
    }))
      .then(() => schedulePump())
      .then(() => sendResponse({ ok: true }))
    return true
  }

  if ('cmd' in message && message.cmd === 'GEMINI_ABORTED') {
    void updateRunState(state => {
      if (state.phase === 'OS0_GEMINI') {
        return handleError(state, 'Gemini工程を中止しました')
      }
      if (state.phase === 'OS1_GEMINI' && message.reason === 'skip') {
        return {
          ...state,
          phase: 'OS1_NAV',
          currentIndex: state.currentIndex + 1,
          currentDraft: undefined,
          currentRawInput: undefined,
          currentCapturedText: undefined,
          message: 'この件をスキップしました',
        }
      }
      return handleError(state, 'Gemini工程を中止しました')
    })
      .then(() => schedulePump())
      .then(() => sendResponse({ ok: true }))
    return true
  }

  if ('cmd' in message && String(message.cmd).startsWith('POPUP_')) {
    void handlePopupCommand(message as PopupCommand).then(sendResponse)
    return true
  }

  return false
})

chrome.runtime.onStartup.addListener(() => {
  void schedulePump()
})
