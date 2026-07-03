export type XPageType = 'search' | 'followers' | 'unknown'

export interface XAccount {
  displayName: string
  handle: string
  bio: string
}

export interface XPost {
  text: string
  relativeTime: string
  isPinned: boolean
}

export interface XProfile {
  displayName: string
  handle: string
  bio: string
  followers: string
  following: string
  postsCount: string
  bioLink: string
  pinnedPost: string | null
  posts: XPost[]
}

export type XCommand =
  | { cmd: 'X_EXTRACT_LIST' }
  | { cmd: 'X_EXTRACT_PROFILE'; postCount: number }

export interface XListResult {
  ok: boolean
  pageType: XPageType
  accounts: XAccount[]
  error?: string
}

export interface XProfileResult {
  ok: boolean
  profile?: XProfile
  error?: string
}

export interface BridgeRelay {
  cmd: 'BRIDGE'
  type: string
  payload: unknown
}

export interface GeminiPrepare {
  cmd: 'GEMINI_PREPARE'
  draftText: string
  stepLabel: string
  draftLength?: number
  draftPreview?: string
}

export interface GeminiCaptured {
  cmd: 'GEMINI_CAPTURED'
  clipboardText: string
}

export interface GeminiAborted {
  cmd: 'GEMINI_ABORTED'
  reason: 'skip' | 'abort'
}

export interface DivizeroPingReport {
  cmd: 'DIVIZERO_PING_REPORT'
  ok: boolean
  version?: string
  error?: string
}

export type PopupCommand =
  | { cmd: 'POPUP_START'; limitN: number }
  | { cmd: 'POPUP_START_FROM_QUEUE'; limitN: number }
  | { cmd: 'POPUP_PAUSE' }
  | { cmd: 'POPUP_RESUME' }
  | { cmd: 'POPUP_ABORT' }
  | { cmd: 'POPUP_STATUS' }

export type PopupResponse =
  | { ok: true; runState: RunState; connection: ConnectionState }
  | { ok: false; message: string; runState: RunState; connection: ConnectionState }

export interface QueueItem {
  screeningId: string
  handle: string
  displayName: string
}

export interface RunError {
  at: string
  phase: string
  message: string
}

export interface RunState {
  runId: string
  phase:
    | 'IDLE'
    | 'OS0_CAPTURE'
    | 'OS0_GEMINI'
    | 'OS0_IMPORT'
    | 'OS1_NAV'
    | 'OS1_CAPTURE'
    | 'OS1_GEMINI'
    | 'OS1_IMPORT'
    | 'PAUSED'
    | 'DONE'
    | 'ERROR'
  channel: 'twitter'
  limitN: number
  os0SourceTabId?: number
  os0SourceUrl?: string
  os0PageType?: XPageType
  divizeroTabId?: number
  geminiTabId?: number
  queue: QueueItem[]
  currentIndex: number
  currentHandle?: string
  currentDraft?: string
  currentRawInput?: string
  currentCapturedText?: string
  waitUntil?: number
  prevPhase?: RunState['phase']
  errors: RunError[]
  startedAt: string
  endedAt?: string
  message?: string
  stats: {
    os0Captured: number
    os0Passed: number
    os1Done: number
    os1Failed: number
  }
}

export interface ConnectionState {
  status: 'unknown' | 'connected' | 'error'
  version?: string
  updatedAt?: string
  error?: string
}

export const DEFAULT_RUN_STATE: RunState = {
  runId: '',
  phase: 'IDLE',
  channel: 'twitter',
  limitN: 10,
  queue: [],
  currentIndex: 0,
  errors: [],
  startedAt: '',
  stats: {
    os0Captured: 0,
    os0Passed: 0,
    os1Done: 0,
    os1Failed: 0,
  },
}

export const DEFAULT_CONNECTION_STATE: ConnectionState = {
  status: 'unknown',
}
