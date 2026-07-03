import type { AppData } from '../../types'
import type { HomeDashboard, MissionItem, KpiItem, FunnelStep, HomeAlert, ShortcutItem } from './homeTypes'
import {
  DEFAULT_DAILY_TARGETS,
  weekStartStr,
  calcWeeklyFunnel,
  fmtRate,
  getWeekElapsedRatio,
  calcWaiting,
  countTodayOS0,
  countTodayOS1,
  countTodayOS2,
  getDMReplyNeeded,
  get48hExpiredItems,
  getOverdueItems,
  getRecontactDueItems,
  getS1StalledItems,
  getNeedsOS2Touch,
  countOS1Pending,
  countUnverifiedClosed,
} from './homeCalculators'
import { getActiveNotifications } from '../../utils/analysisNotification'

export function getHomeDashboard(data: AppData): HomeDashboard {
  // ── ミッション計算 ────────────────────────────────────────
  const dmReply = getDMReplyNeeded(data)
  const expired48h = get48hExpiredItems(data)
  const overdue = getOverdueItems(data)
  const recontact = getRecontactDueItems(data)
  const needsTouch = getNeedsOS2Touch(data)
  const os1Pending = countOS1Pending(data)
  const os0Pending = (data.screenings || []).length

  const mission: MissionItem[] = [
    {
      id: 'dm_reply',
      priority: 1,
      label: 'DM返信',
      sublabel: '相手から返信あり',
      count: dmReply.length,
      tab: 'tab2',
      urgency: dmReply.length > 0 ? 'critical' : 'low',
      icon: 'fa-comment-dots',
      itemIds: dmReply.map(p => p.id),
    },
    {
      id: 'reaction_48h',
      priority: 2,
      label: '48h判定待ち',
      sublabel: '反応期限超過',
      count: expired48h.length,
      tab: 'tab2',
      urgency: expired48h.length > 0 ? 'high' : 'low',
      icon: 'fa-clock',
      itemIds: expired48h.map(p => p.id),
    },
    {
      id: 'overdue',
      priority: 3,
      label: '期限切れ/遅延',
      sublabel: '7日以上連絡なし',
      count: overdue.length,
      tab: 'tab2',
      urgency: overdue.length > 0 ? 'high' : 'low',
      icon: 'fa-triangle-exclamation',
      itemIds: overdue.map(p => p.id),
    },
    {
      id: 'recontact',
      priority: 4,
      label: '再接触日到来',
      sublabel: 'waiting/sleeping → active',
      count: recontact.length,
      tab: 'tab2',
      urgency: recontact.length > 0 ? 'medium' : 'low',
      icon: 'fa-rotate-right',
      itemIds: recontact.map(p => p.id),
    },
    {
      id: 'needs_touch',
      priority: 5,
      label: 'OS②接触対象',
      sublabel: '今日まだ接触していない',
      count: needsTouch.length,
      tab: 'tab2',
      urgency: needsTouch.length > 0 ? 'medium' : 'low',
      icon: 'fa-arrow-pointer',
      itemIds: needsTouch.map(p => p.id),
    },
    {
      id: 'os1_pending',
      priority: 6,
      label: 'OS①未処理',
      sublabel: 'スクリーニング待ち',
      count: os1Pending,
      tab: 'tab1',
      urgency: os1Pending > 0 ? 'low' : 'low',
      icon: 'fa-filter',
    },
    {
      id: 'os0_pending',
      priority: 7,
      label: 'OS⓪未処理',
      sublabel: '一次選別待機中',
      count: os0Pending,
      tab: 'tab0',
      urgency: os0Pending > 0 ? 'low' : 'low',
      icon: 'fa-magnifying-glass',
    },
  ]

  // ── 今日KPI ──────────────────────────────────────────────
  const todayKpi: KpiItem[] = [
    {
      id: 'os0',
      label: 'OS⓪',
      tab: 'tab0',
      today: countTodayOS0(data),
      dailyTarget: DEFAULT_DAILY_TARGETS.os0,
      icon: 'fa-layer-group',
      color: 'fuchsia',
    },
    {
      id: 'os1',
      label: 'OS①',
      tab: 'tab1',
      today: countTodayOS1(data),
      dailyTarget: DEFAULT_DAILY_TARGETS.os1,
      icon: 'fa-filter',
      color: 'violet',
    },
    {
      id: 'os2',
      label: 'OS②',
      tab: 'tab2',
      today: countTodayOS2(data),
      dailyTarget: DEFAULT_DAILY_TARGETS.os2,
      icon: 'fa-chart-gantt',
      color: 'indigo',
    },
  ]

  // ── 今週ファネル ──────────────────────────────────────────
  const wf = calcWeeklyFunnel(data)
  const weekRatio = getWeekElapsedRatio()
  const weeklyProgress: HomeDashboard['weeklyProgress'] = [
    {
      id: 'os0',
      label: 'OS⓪',
      tab: 'tab0',
      count: wf.os0,
      weeklyTarget: DEFAULT_DAILY_TARGETS.os0 * 7,
      expectedByNow: Math.round(DEFAULT_DAILY_TARGETS.os0 * 7 * weekRatio),
      icon: 'fa-layer-group',
      color: 'fuchsia',
    },
    {
      id: 'os1',
      label: 'OS①',
      tab: 'tab1',
      count: wf.os1,
      weeklyTarget: DEFAULT_DAILY_TARGETS.os1 * 7,
      expectedByNow: Math.round(DEFAULT_DAILY_TARGETS.os1 * 7 * weekRatio),
      icon: 'fa-filter',
      color: 'violet',
    },
    {
      id: 'os2',
      label: 'OS②',
      tab: 'tab2',
      count: wf.os2,
      weeklyTarget: DEFAULT_DAILY_TARGETS.os2 * 7,
      expectedByNow: Math.round(DEFAULT_DAILY_TARGETS.os2 * 7 * weekRatio),
      icon: 'fa-chart-gantt',
      color: 'indigo',
    },
  ]
  const weeklyFunnel: FunnelStep[] = [
    {
      label: 'OS⓪',
      count: wf.os0,
      colorClass: 'bg-fuchsia-500',
    },
    {
      label: 'OS①',
      count: wf.os1,
      convRate: fmtRate(wf.os1, wf.os0),
      colorClass: 'bg-violet-500',
    },
    {
      label: 'OS②',
      count: wf.os2,
      convRate: fmtRate(wf.os2, wf.os1),
      colorClass: 'bg-indigo-500',
    },
    {
      label: 'クローズ',
      count: wf.closed,
      convRate: fmtRate(wf.closed, wf.os2),
      colorClass: 'bg-slate-500',
    },
    {
      label: '受注',
      count: wf.won,
      convRate: fmtRate(wf.won, wf.closed),
      colorClass: 'bg-emerald-500',
    },
  ]

  // ── Waiting サマリ ────────────────────────────────────────
  const waiting = calcWaiting(data)

  // ── アラート ──────────────────────────────────────────────
  const alerts: HomeAlert[] = []

  if (expired48h.length > 0) {
    alerts.push({
      id: 'alert_48h',
      severity: 'critical',
      label: `48h超えが${expired48h.length}件`,
      detail: '反応記録を入力してください',
      tab: 'tab2',
    })
  }

  const s1Stalled = getS1StalledItems(data)
  if (s1Stalled.length > 0) {
    alerts.push({
      id: 'alert_s1',
      severity: 'warning',
      label: `S1滞留が${s1Stalled.length}件`,
      detail: '14日以上 S1 にとどまっています',
      tab: 'tab2',
    })
  }

  const unverified = countUnverifiedClosed(data)
  if (unverified > 0) {
    alerts.push({
      id: 'alert_unverified',
      severity: 'warning',
      label: `OS③未検証が${unverified}件`,
      detail: 'クローズ案件の振り返りを行いましょう',
      tab: 'tab3',
    })
  }

  // 既存の analysisNotification を追加
  const notifs = getActiveNotifications(data)
  notifs.forEach(n => {
    alerts.push({
      id: `notif_${n.type}`,
      severity: n.severity === 'critical' ? 'critical' : 'info',
      label: n.label,
      detail: n.message,
      tab: 'tab5',
    })
  })

  // ── ショートカット ────────────────────────────────────────
  const activePipeline = (data.pipeline || []).filter(p => p.isOpen).length

  const shortcuts: ShortcutItem[] = [
    {
      label: 'OS⓪ 一次選別',
      icon: 'fa-layer-group',
      tab: 'tab0',
      description: `${os0Pending}件 待機中`,
      badge: os0Pending,
      variant: 'secondary',
    },
    {
      label: 'OS① スクリーニング',
      icon: 'fa-filter',
      tab: 'tab1',
      description: `${os1Pending}件 未処理`,
      badge: os1Pending,
      variant: 'secondary',
    },
    {
      label: 'OS② 案件管理',
      icon: 'fa-chart-gantt',
      tab: 'tab2',
      description: `${activePipeline}件 進行中`,
      badge: activePipeline,
      variant: 'primary',
    },
    {
      label: 'OS③ 案件検証',
      icon: 'fa-graduation-cap',
      tab: 'tab3',
      description: unverified > 0 ? `${unverified}件 未検証` : '振り返り',
      badge: unverified || undefined,
      variant: 'secondary',
    },
    {
      label: '集計ダッシュボード',
      icon: 'fa-chart-pie',
      tab: 'tab4',
      description: '数値・グラフ確認',
      variant: 'secondary',
    },
    {
      label: '分析履歴',
      icon: 'fa-clock-rotate-left',
      tab: 'tab5',
      description: '定期分析レポート',
      variant: 'secondary',
    },
  ]

  return {
    mission,
    todayKpi,
    weeklyProgress,
    weeklyFunnel,
    weekStart: weekStartStr(),
    waiting,
    alerts,
    shortcuts,
    generatedAt: new Date().toISOString(),
  }
}
