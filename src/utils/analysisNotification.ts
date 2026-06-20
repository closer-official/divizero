import type { AppData, Analysis } from '../types'
import { uid, todayStr } from './helpers'

export type NotificationType = 'case_pattern' | 'touch_trend' | 'emergency_alert'

export interface ActiveNotification {
  type: NotificationType
  label: string
  message: string
  icon: string
  severity: 'info' | 'critical'
  count: number
  pendingAnalysisId: string | null
}

function getLastCompleted(analyses: Analysis[], type: NotificationType): Analysis | null {
  return [...(analyses || [])]
    .filter(a => a.type === type && a.status === 'completed')
    .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))[0] ?? null
}

function getDismissedUntil(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('notification_dismissed') || '{}')
  } catch { return {} }
}

export function setDismissedUntil(type: NotificationType): void {
  const d = getDismissedUntil()
  d[type] = Date.now() + 24 * 60 * 60 * 1000
  localStorage.setItem('notification_dismissed', JSON.stringify(d))
}

export function getActiveNotifications(data: AppData): ActiveNotification[] {
  const analyses = data.analyses || []
  const dismissed = getDismissedUntil()
  const now = Date.now()
  const result: ActiveNotification[] = []

  // ── emergency_alert ─────────────────────────────────────────
  if (!dismissed['emergency_alert'] || dismissed['emergency_alert'] < now) {
    const allTouches = (data.pipeline || []).flatMap(p => p.touches || [])
    const recent10 = [...allTouches]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
    const ngCount = recent10.filter(t => t.targetValidity === '✕').length
    const hasPending = analyses.some(a => a.type === 'emergency_alert' && a.status === 'pending')
    if (ngCount >= 3 && !hasPending) {
      result.push({
        type: 'emergency_alert',
        label: '対象選びに注意',
        message: `直近10タッチで対象✕が${ngCount}件。Rinパターンの兆候があります。`,
        icon: '🔴',
        severity: 'critical',
        count: ngCount,
        pendingAnalysisId: null,
      })
    }
  }

  // ── case_pattern ─────────────────────────────────────────────
  if (!dismissed['case_pattern'] || dismissed['case_pattern'] < now) {
    const last = getLastCompleted(analyses, 'case_pattern')
    const sinceDate = last?.completedAt ?? null
    const newClosed = (data.closed || []).filter(c => {
      if (!sinceDate) return true
      return (c.closeDate || c.createdAt || '') > sinceDate
    })
    if (newClosed.length >= 5) {
      const existing = analyses.find(a => a.type === 'case_pattern' && a.status !== 'completed')
      result.push({
        type: 'case_pattern',
        label: '失注パターン分析',
        message: `失注案件が${newClosed.length}件増えました。傾向をチェックしてみましょう。`,
        icon: '📊',
        severity: 'info',
        count: newClosed.length,
        pendingAnalysisId: existing?.id ?? null,
      })
    }
  }

  // ── touch_trend ──────────────────────────────────────────────
  if (!dismissed['touch_trend'] || dismissed['touch_trend'] < now) {
    const last = getLastCompleted(analyses, 'touch_trend')
    const sinceDate = last?.completedAt ?? null
    const allTouches = (data.pipeline || []).flatMap(p => p.touches || [])
    const newJudged = allTouches.filter(t => {
      if (!t.judgedAt) return false
      if (!sinceDate) return true
      return t.judgedAt > sinceDate
    })
    if (newJudged.length >= 20) {
      const existing = analyses.find(a => a.type === 'touch_trend' && a.status !== 'completed')
      result.push({
        type: 'touch_trend',
        label: '文面傾向分析',
        message: `文面判定が${newJudged.length}件溜まりました。傾向をチェックしてみましょう。`,
        icon: '📝',
        severity: 'info',
        count: newJudged.length,
        pendingAnalysisId: existing?.id ?? null,
      })
    }
  }

  return result
}

export function createPendingAnalysis(
  data: AppData,
  type: NotificationType,
  count: number
): Analysis {
  return {
    id: uid(),
    type,
    triggeredAt: new Date().toISOString(),
    status: 'pending',
    targetCount: count,
    alertDetail: type === 'emergency_alert' ? `直近10タッチで対象✕が${count}件` : undefined,
  }
}

export function markEmergencyAlertRead(
  data: AppData,
  saveData: (updater: (prev: AppData) => AppData) => void
): void {
  const a = createPendingAnalysis(data, 'emergency_alert', 0)
  const completed: Analysis = {
    ...a,
    status: 'completed',
    completedAt: new Date().toISOString(),
  }
  saveData(prev => ({
    ...prev,
    analyses: [...(prev.analyses || []), completed],
  }))
  setDismissedUntil('emergency_alert')
}

export function buildEmergencyAlertDetail(data: AppData): string {
  const allTouches = (data.pipeline || []).flatMap(p =>
    (p.touches || []).map(t => ({ ...t, accountName: p.accountName }))
  )
  const recent10 = [...allTouches]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)
  return recent10.map(t => {
    const mark = t.targetValidity === '✕' ? '✕' : t.targetValidity === '△' ? '△' : '◯'
    return `${t.date.slice(0, 10)} ${mark} ${t.targetPostType || '種別不明'} — ${(t as typeof t & {accountName: string}).accountName}`
  }).join('\n')
}

export { getLastCompleted, todayStr }
