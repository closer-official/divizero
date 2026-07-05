// ── タブ識別子（App.tsx でも import して使う） ──────────────────
export type TabId =
  | 'home'
  | 'tab0'
  | 'tab1'
  | 'tab2'
  | 'tab3'
  | 'tab4'
  | 'tab5'
  | 'tab6'

// ── ミッション（優先順位付き今日やること） ─────────────────────
export interface MissionItem {
  id: string
  priority: number               // 1 = 最高優先
  label: string                  // "DM返信"
  sublabel: string               // "相手から返信あり"
  count: number
  tab: TabId
  urgency: 'critical' | 'high' | 'medium' | 'low'
  icon: string                   // Font Awesome class
  itemIds?: string[]             // 対象 pipelineItem の ID
}

// ── 今日KPI ───────────────────────────────────────────────────
export interface KpiItem {
  id: string
  label: string                  // "OS0"
  tab: TabId
  today: number                  // 今日の実績
  dailyTarget: number            // 目標値（定数）
  icon: string
  color: string                  // "violet" | "indigo" | "fuchsia" | "emerald"
}

// ── 週次進捗 ─────────────────────────────────────────────────
export interface WeeklyProgressItem {
  id: string
  label: string
  tab: TabId
  count: number                  // 今週実績
  weeklyTarget: number           // 週目標
  expectedByNow: number          // 本日時点の理想進捗
  icon: string
  color: string
}

// ── 今週ファネル ──────────────────────────────────────────────
export interface FunnelStep {
  label: string
  count: number
  convRate?: string              // 前ステップからの転換率 "45%"
  colorClass: string             // tailwind bg class e.g. "bg-fuchsia-500"
}

// ── Waiting 状態サマリ ────────────────────────────────────────
export interface WaitingSummary {
  awaitingReaction: number       // awaiting_reaction タッチ件数
  expired48h: number             // 48h 超えた awaiting
  waiting7d: number              // state === 'waiting'
  sleeping: number               // state === 'sleeping' | 'archived'
  s1Stalled: number              // S1 で 14日超え
  meetingScheduled: number       // state === 'meeting_scheduled'
}

export interface TrackSummaryItem {
  id: string
  label: string
  count: number
  ratio: number
  itemIds: string[]
}

export interface TemperatureBucketItem {
  label: string
  min: number
  max: number | null
  count: number
  itemIds: string[]
}

export interface TemperatureSummaryItem {
  id: string
  accountName: string
  track: string
  temperature: number
  daysSinceStart: number
  state?: string
}

export interface TemperatureSummary {
  total: number
  withTemperature: number
  missing: number
  min: number | null
  max: number | null
  maxCount: number
  average: number | null
  items: TemperatureSummaryItem[]
  buckets: TemperatureBucketItem[]
}

export interface S1ActionItem {
  id: string
  accountName: string
  track: string
  currentStep: string
  kind: 'like_only' | 'comment' | 'story_reply' | 'dm_or_other'
  date: string
}

export interface S1ActionSummary {
  totalTouches: number
  touchingItems: number
  likeOnly: number
  comment: number
  storyReply: number
  dmOrOther: number
  items: S1ActionItem[]
}

export interface S1AgeBucketItem {
  label: string
  min: number
  max: number | null
  count: number
  itemIds: string[]
}

export interface S1AgeItem {
  id: string
  accountName: string
  track: string
  days: number
  currentStep: string
  startDate?: string
}

export interface S1AgeSummary {
  totalItems: number
  averageDays: number | null
  maxDays: number | null
  buckets: S1AgeBucketItem[]
  items: S1AgeItem[]
}

export interface PromptCheckItem {
  id: string
  label: string
  status: 'ok' | 'warning' | 'missing'
  detail: string
  evidence: string[]
}

export interface PromptCheckSummary {
  status: 'ok' | 'warning' | 'missing'
  summary: string
  items: PromptCheckItem[]
}

export interface AuditSummary {
  dmMigration: PromptCheckSummary
}

// ── アラート ─────────────────────────────────────────────────
export interface HomeAlert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  label: string
  detail: string
  tab: TabId
}

// ── 作業開始ショートカット ────────────────────────────────────
export interface ShortcutItem {
  label: string
  icon: string
  tab: TabId
  description: string
  badge?: number
  variant: 'primary' | 'secondary'
}

// ── ホーム画面全体のデータ ────────────────────────────────────
export interface HomeDashboard {
  mission: MissionItem[]
  todayKpi: KpiItem[]
  weeklyProgress: WeeklyProgressItem[]
  weeklyFunnel: FunnelStep[]
  weekStart: string              // "YYYY-MM-DD"
  waiting: WaitingSummary
  alerts: HomeAlert[]
  shortcuts: ShortcutItem[]
  trackSummary: TrackSummaryItem[]
  temperatureSummary: TemperatureSummary
  s1ActionSummary: S1ActionSummary
  s1AgeSummary: S1AgeSummary
  auditSummary: AuditSummary
  generatedAt: string            // ISO datetime
}
