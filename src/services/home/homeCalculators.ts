import type { AppData, PipelineItem, Prompts, Touch } from '../../types'
import type {
  AuditSummary,
  PromptCheckItem,
  PromptCheckSummary,
  S1ActionSummary,
  S1AgeSummary,
  TemperatureSummary,
  TrackSummaryItem,
} from './homeTypes'
import { todayStr, daysSince, getLastContactDate } from '../../utils/helpers'

export const DEFAULT_DAILY_TARGETS = {
  os0: 10,
  os1: 8,
  os2: 10,
} as const

// ── 日付ユーティリティ ────────────────────────────────────────

export function getWeekStart(): Date {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day // 月曜基準
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

export function weekStartStr(): string {
  const ws = getWeekStart()
  return `${ws.getFullYear()}-${String(ws.getMonth() + 1).padStart(2, '0')}-${String(ws.getDate()).padStart(2, '0')}`
}

export function getWeekElapsedDays(): number {
  const day = new Date().getDay()
  return day === 0 ? 7 : day
}

export function getWeekElapsedRatio(): number {
  return getWeekElapsedDays() / 7
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isToday(dateStr: string): boolean {
  if (!dateStr) return false
  const t = todayStr()
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr === t
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  return localDateStr(d) === t
}

export function isThisWeek(dateStr: string): boolean {
  if (!dateStr) return false
  const ws = weekStartStr()
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr >= ws
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  return d >= getWeekStart()
}

export function is48hExpired(dateStr: string): boolean {
  if (!dateStr) return false
  return new Date(dateStr).getTime() <= Date.now() - 48 * 60 * 60 * 1000
}

// ── KPI 今日カウント ──────────────────────────────────────────

export function countTodayOS0(data: AppData): number {
  return (data.screenings || []).filter(s => isToday(s.createdAt)).length
}

export function countTodayOS1(data: AppData): number {
  return (data.targets || []).filter(t => isToday(t.createdAt)).length
}

export function countTodayOS2(data: AppData): number {
  return (data.pipeline || [])
    .flatMap(p => p.touches || [])
    .filter(t => isToday(t.date))
    .length
}

export function countTodayOS3(data: AppData): number {
  return (data.closed || []).filter(c => isToday(c.createdAt)).length
}

// ── ミッション系計算 ──────────────────────────────────────────

function isLikeOnlyTouch(t: { status?: string; reactionReplyMode?: string; conversationTurns?: Array<{ role: string; text: string }> }): boolean {
  if (t.reactionReplyMode === 'like_only') return true
  const turns = t.conversationTurns || []
  const last = turns[turns.length - 1]
  return t.status === 'reacted' && !!last && last.role === '自分' && /いいねのみ/.test(last.text)
}

function isAwaitingReactionTouch(t: { status?: string; reactionReplyMode?: string; conversationTurns?: Array<{ role: string; text: string }> }): boolean {
  return t.status === 'awaiting_reaction' && !isLikeOnlyTouch(t)
}

// 面談待ち・日程確定済みは「今、自分が動く案件」ではない。
export function isMeetingWaitingItem(item: PipelineItem): boolean {
  return item.state === 'meeting_scheduled'
}

// DM返信が必要：会話スレッドの最新ターンが '相手' 側で送信済み
export function getDMReplyNeeded(data: AppData): PipelineItem[] {
  return (data.pipeline || []).filter(p => {
    if (!p.isOpen || isMeetingWaitingItem(p)) return false
    return (p.touches || []).some(t => {
      if (t.touchMode !== 'conversation') return false
      if (t.threadStatus === 'closed') return false
      const turns = t.conversationTurns || []
      if (turns.length === 0) return false
      const sorted = [...turns].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      const last = sorted[sorted.length - 1]
      return last.role === '相手' && last.sentStatus !== 'draft'
    })
  })
}

// 48h判定待ち超過
export function get48hExpiredItems(data: AppData): PipelineItem[] {
  return (data.pipeline || []).filter(p =>
    p.isOpen &&
    !isMeetingWaitingItem(p) &&
    (p.touches || []).some(t => isAwaitingReactionTouch(t) && is48hExpired(t.date))
  )
}

// 期限切れ/遅延：active で 7日連絡なし
export function getOverdueItems(data: AppData): PipelineItem[] {
  return (data.pipeline || []).filter(p => {
    if (!p.isOpen || isMeetingWaitingItem(p) || (p.state && p.state !== 'active')) return false
    const baseDate = p.lastContactDate || p.startDate
    return daysSince(baseDate) >= 7
  })
}

// 再接触日到来
export function getRecontactDueItems(data: AppData): PipelineItem[] {
  const t = todayStr()
  return (data.pipeline || []).filter(p =>
    p.isOpen &&
    !isMeetingWaitingItem(p) &&
    (p.state === 'waiting' || p.state === 'sleeping' || p.state === 'archived') &&
    p.recontact_date != null &&
    p.recontact_date <= t
  )
}

// S1で14日以上滞留
export function getS1StalledItems(data: AppData): PipelineItem[] {
  return (data.pipeline || []).filter(p =>
    p.isOpen && p.currentStep === 'S1' && daysSince(p.startDate) >= 14
  )
}

// OS2接触が必要：active / awaiting 中でなく / 今日まだ触れていない
export function getNeedsOS2Touch(data: AppData): PipelineItem[] {
  return (data.pipeline || []).filter(p => {
    if (!p.isOpen || isMeetingWaitingItem(p) || (p.state && p.state !== 'active')) return false
    const lastContactDate = getLastContactDate(p)
    const touches = p.touches || []
    if (touches.some(t => isAwaitingReactionTouch(t))) return false
    if (touches.length > 0 && touches.some(t => isToday(t.date))) return false
    if (!lastContactDate && touches.some(t => isToday(t.date))) return false
    return true
  })
}

// OS1未処理件数
export function countOS1Pending(data: AppData): number {
  return (data.targets || []).filter(t => !t.pipelineId && t.track !== 'SKIP').length
}

// OS3未検証件数
export function countUnverifiedClosed(data: AppData): number {
  return (data.closed || []).filter(c => !c.hypothesisResult).length
}

// ── 今週ファネル ──────────────────────────────────────────────

export function calcWeeklyFunnel(data: AppData): {
  os0: number; os1: number; os2: number; closed: number; won: number
} {
  const os0 = (data.screenings || []).filter(s => isThisWeek(s.createdAt)).length
  const os1 = (data.targets || []).filter(t => isThisWeek(t.createdAt)).length
  const os2 = (data.pipeline || []).filter(p => p.startDate && isThisWeek(p.startDate)).length
  const closedList = (data.closed || []).filter(c => isThisWeek(c.closeDate || c.createdAt))
  return {
    os0,
    os1,
    os2,
    closed: closedList.length,
    won: closedList.filter(c => c.result === '受注').length,
  }
}

export function fmtRate(numerator: number, denominator: number): string {
  if (denominator === 0) return '-'
  return `${Math.round((numerator / denominator) * 100)}%`
}

// ── Waiting サマリ ────────────────────────────────────────────

export function calcWaiting(data: AppData) {
  const open = (data.pipeline || []).filter(p => p.isOpen && !isMeetingWaitingItem(p))
  const allTouches = open.flatMap(p => p.touches || [])

  const awaitingReaction = allTouches.filter(t => isAwaitingReactionTouch(t)).length
  const expired48h = allTouches.filter(t => isAwaitingReactionTouch(t) && is48hExpired(t.date)).length
  const waiting7d = open.filter(p => p.state === 'waiting').length
  const sleeping = open.filter(p => p.state === 'sleeping' || p.state === 'archived').length
  const s1Stalled = getS1StalledItems(data).length
  const meetingScheduled = (data.pipeline || []).filter(p => p.isOpen && p.state === 'meeting_scheduled').length

  return { awaitingReaction, expired48h, waiting7d, sleeping, s1Stalled, meetingScheduled }
}

// ── ホーム監査用ダッシュボード ───────────────────────────────

function getOpenPipeline(data: AppData): PipelineItem[] {
  return (data.pipeline || []).filter(p => p.isOpen)
}

function getTouchKind(touch: Touch): S1ActionSummary['items'][number]['kind'] {
  if (touch.threadEntry === 's1_story_reply' || touch.targetPostType === 'ストーリー') return 'story_reply'
  if (touch.reactionReplyMode === 'like_only') return 'like_only'
  const text = `${touch.actualSentText || ''} ${touch.reactionNote || ''}`
  if (/いいねのみ/.test(text)) return 'like_only'
  if (touch.touchMode === 'conversation' || touch.threadEntry === 's3_direct') return 'dm_or_other'
  return 'comment'
}

export function calcTrackSummary(data: AppData): TrackSummaryItem[] {
  const open = getOpenPipeline(data)
  const total = open.length || 1
  const order: Array<{ id: TrackSummaryItem['id']; label: string }> = [
    { id: 'UT', label: 'UT' },
    { id: 'FT', label: 'FT' },
    { id: 'NT', label: 'NT' },
    { id: 'SKIP', label: 'SKIP' },
  ]
  return order.map(({ id, label }) => {
    const itemIds = open.filter(p => p.track === id).map(p => p.id)
    return {
      id,
      label,
      count: itemIds.length,
      ratio: Math.round((itemIds.length / total) * 100),
      itemIds,
    }
  })
}

export function calcTemperatureSummary(data: AppData): TemperatureSummary {
  const open = getOpenPipeline(data)
  const withTemp = open
    .filter(p => typeof p.temperature === 'number' && !Number.isNaN(p.temperature))
    .map(p => ({
      id: p.id,
      accountName: p.accountName,
      track: p.track,
      temperature: p.temperature as number,
      daysSinceStart: daysSince(p.startDate),
      state: p.state,
    }))
    .sort((a, b) => b.temperature - a.temperature || b.daysSinceStart - a.daysSinceStart)

  const max = withTemp.length > 0 ? withTemp[0].temperature : null
  const maxCount = max == null ? 0 : withTemp.filter(item => item.temperature === max).length
  const min = withTemp.length > 0 ? withTemp[withTemp.length - 1].temperature : null
  const average = withTemp.length > 0
    ? Math.round(withTemp.reduce((sum, item) => sum + item.temperature, 0) / withTemp.length)
    : null

  const bucketDefs: Array<{ label: string; min: number; max: number | null }> = [
    { label: '0-19', min: 0, max: 19 },
    { label: '20-39', min: 20, max: 39 },
    { label: '40-59', min: 40, max: 59 },
    { label: '60-79', min: 60, max: 79 },
    { label: '80+', min: 80, max: null },
  ]
  const buckets = bucketDefs.map(def => {
    const itemIds = open.filter(p => {
      if (typeof p.temperature !== 'number' || Number.isNaN(p.temperature)) return false
      if (def.max == null) return (p.temperature as number) >= def.min
      return (p.temperature as number) >= def.min && (p.temperature as number) <= def.max
    }).map(p => p.id)
    return {
      label: def.label,
      min: def.min,
      max: def.max,
      count: itemIds.length,
      itemIds,
    }
  })

  return {
    total: open.length,
    withTemperature: withTemp.length,
    missing: open.length - withTemp.length,
    min,
    max,
    maxCount,
    average,
    items: withTemp,
    buckets,
  }
}

export function calcS1ActionSummary(data: AppData): S1ActionSummary {
  const open = getOpenPipeline(data)
  const items = open
    .filter(p => String(p.currentStep || '').startsWith('S1'))
    .flatMap(p => (p.touches || []).map(touch => ({
      id: `${p.id}_${touch.id}`,
      accountName: p.accountName,
      track: p.track,
      currentStep: p.currentStep,
      kind: getTouchKind(touch),
      date: touch.date,
    })))
    .sort((a, b) => b.date.localeCompare(a.date))

  const counts = items.reduce((acc, item) => {
    acc[item.kind] += 1
    return acc
  }, { like_only: 0, comment: 0, story_reply: 0, dm_or_other: 0 })

  const touchingItems = new Set(items.map(item => item.id.split('_')[0])).size

  return {
    totalTouches: items.length,
    touchingItems,
    likeOnly: counts.like_only,
    comment: counts.comment,
    storyReply: counts.story_reply,
    dmOrOther: counts.dm_or_other,
    items,
  }
}

export function calcS1AgeSummary(data: AppData): S1AgeSummary {
  const open = getOpenPipeline(data)
  const items = open
    .filter(p => String(p.currentStep || '').startsWith('S1'))
    .map(p => ({
      id: p.id,
      accountName: p.accountName,
      track: p.track,
      currentStep: p.currentStep,
      days: daysSince(p.startDate),
      startDate: p.startDate,
    }))
    .sort((a, b) => b.days - a.days || a.accountName.localeCompare(b.accountName))

  const averageDays = items.length > 0
    ? Math.round(items.reduce((sum, item) => sum + item.days, 0) / items.length)
    : null
  const maxDays = items.length > 0 ? items[0].days : null

  const bucketDefs: Array<{ label: string; min: number; max: number | null }> = [
    { label: '0-6日', min: 0, max: 6 },
    { label: '7-13日', min: 7, max: 13 },
    { label: '14-29日', min: 14, max: 29 },
    { label: '30日以上', min: 30, max: null },
  ]
  const buckets = bucketDefs.map(def => {
    const itemIds = items.filter(item => {
      if (def.max == null) return item.days >= def.min
      return item.days >= def.min && item.days <= def.max
    }).map(item => item.id)
    return {
      label: def.label,
      min: def.min,
      max: def.max,
      count: itemIds.length,
      itemIds,
    }
  })

  return {
    totalItems: items.length,
    averageDays,
    maxDays,
    buckets,
    items,
  }
}

function assessPrompt(label: string, prompt?: string): PromptCheckItem {
  const text = prompt || ''
  const hasDmMove = /DM移行/.test(text)
  const hasUtageThreshold = /関係温度15以上/.test(text)
  const hasNormalThreshold = /関係温度25以上/.test(text)
  const hasConditionRules = /営業対象判定.*対象/.test(text) && /仮説検証価値/.test(text)

  if (!text.trim()) {
    return { id: label, label, status: 'missing', detail: 'プロンプト未読込', evidence: ['読み込み失敗'] }
  }
  if (hasDmMove && hasUtageThreshold && hasNormalThreshold && hasConditionRules) {
    return {
      id: label,
      label,
      status: 'ok',
      detail: 'UTAGE 15 / 通常 25 の条件式を確認',
      evidence: ['DM移行', '関係温度15以上', '関係温度25以上', '営業対象判定が対象'],
    }
  }
  return {
    id: label,
    label,
    status: 'warning',
    detail: 'DM移行条件は見えるが、必要要素が一部不足',
    evidence: [
      hasDmMove ? 'DM移行あり' : 'DM移行なし',
      hasUtageThreshold ? 'UTAGE閾値あり' : 'UTAGE閾値なし',
      hasNormalThreshold ? '通常閾値あり' : '通常閾値なし',
    ],
  }
}

export function calcAuditSummary(prompts?: Prompts): AuditSummary {
  const items = [
    assessPrompt('OS2_行動判定', prompts?.OS2),
    assessPrompt('S1_ACTION', prompts?.S1_ACTION),
    assessPrompt('S1_ACTION_BATCH', prompts?.S1_ACTION_BATCH),
  ]
  const status: PromptCheckSummary['status'] = items.every(item => item.status === 'ok')
    ? 'ok'
    : items.some(item => item.status === 'ok')
      ? 'warning'
      : 'missing'
  const summary = status === 'ok'
    ? 'DM移行ロジック関連の条件式は現行プロンプトで確認できました。'
    : status === 'warning'
      ? '一部のプロンプトは条件式が確認できましたが、抜けがあります。'
      : 'DM移行ロジックの確認材料が見つかりませんでした。'
  return { dmMigration: { status, summary, items } }
}
