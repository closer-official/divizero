import type { AppData, PipelineItem } from '../../types'
import { todayStr, daysSince } from '../../utils/helpers'

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
    (p.touches || []).some(t => t.status === 'awaiting_reaction' && is48hExpired(t.date))
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
    const touches = p.touches || []
    if (touches.some(t => t.status === 'awaiting_reaction')) return false
    if (touches.some(t => isToday(t.date))) return false
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

  const awaitingReaction = allTouches.filter(t => t.status === 'awaiting_reaction').length
  const expired48h = allTouches.filter(t => t.status === 'awaiting_reaction' && is48hExpired(t.date)).length
  const waiting7d = open.filter(p => p.state === 'waiting').length
  const sleeping = open.filter(p => p.state === 'sleeping' || p.state === 'archived').length
  const s1Stalled = getS1StalledItems(data).length
  const meetingScheduled = (data.pipeline || []).filter(p => p.isOpen && p.state === 'meeting_scheduled').length

  return { awaitingReaction, expired48h, waiting7d, sleeping, s1Stalled, meetingScheduled }
}
