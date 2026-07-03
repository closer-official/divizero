import { useMemo } from 'react'
import type { AppData } from '../../types'
import type { TabId, MissionItem, KpiItem, WeeklyProgressItem, FunnelStep, HomeAlert, ShortcutItem } from '../../services/home/homeTypes'
import { getHomeDashboard } from '../../services/home/HomeService'

interface Props {
  data: AppData
  onGoTo: (tab: TabId) => void
  onGoToTab2WithItem: (itemId: string) => void
}

// ── 静的カラーマップ（Tailwind スキャン対応） ─────────────────

const KPI_COLORS: Record<string, { bar: string; text: string }> = {
  fuchsia: { bar: 'bg-fuchsia-500', text: 'text-fuchsia-700' },
  violet:  { bar: 'bg-violet-500',  text: 'text-violet-700'  },
  indigo:  { bar: 'bg-indigo-500',  text: 'text-indigo-700'  },
  emerald: { bar: 'bg-emerald-500', text: 'text-emerald-700' },
}

const URGENCY_STYLE: Record<string, { border: string; bg: string; count: string }> = {
  critical: { border: 'border-l-4 border-rose-400',   bg: 'bg-rose-50',   count: 'text-rose-600'   },
  high:     { border: 'border-l-4 border-amber-400',  bg: 'bg-amber-50',  count: 'text-amber-600'  },
  medium:   { border: 'border-l-4 border-indigo-300', bg: 'bg-indigo-50', count: 'text-indigo-600' },
  low:      { border: 'border-l-4 border-slate-200',  bg: 'bg-white',     count: 'text-slate-300'  },
}

const ALERT_STYLE: Record<string, { bg: string; border: string; icon: string; ic: string }> = {
  critical: { bg: 'bg-rose-50',   border: 'border-rose-200',   icon: 'fa-circle-exclamation',  ic: 'text-rose-500'  },
  warning:  { bg: 'bg-amber-50',  border: 'border-amber-200',  icon: 'fa-triangle-exclamation', ic: 'text-amber-500' },
  info:     { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: 'fa-circle-info',          ic: 'text-blue-400'  },
}

const WAIT_STYLE: Record<string, { bg: string; txt: string; num: string }> = {
  indigo: { bg: 'bg-indigo-50', txt: 'text-indigo-500', num: 'text-indigo-700' },
  rose:   { bg: 'bg-rose-50',   txt: 'text-rose-500',   num: 'text-rose-700'   },
  amber:  { bg: 'bg-amber-50',  txt: 'text-amber-500',  num: 'text-amber-700'  },
  slate:  { bg: 'bg-slate-50',  txt: 'text-slate-400',  num: 'text-slate-500'  },
  sky:    { bg: 'bg-sky-50',    txt: 'text-sky-500',    num: 'text-sky-700'    },
}

// ── サブコンポーネント ────────────────────────────────────────

function WaitBadge({ label, count, color }: { label: string; count: number; color: string }) {
  const s = WAIT_STYLE[color] ?? WAIT_STYLE.slate
  return (
    <div className={`${s.bg} rounded-lg px-2 py-2 flex items-center justify-between gap-1`}>
      <span className={`text-xs ${s.txt} truncate`}>{label}</span>
      <span className={`text-sm font-bold tabular-nums ${s.num} flex-shrink-0`}>{count}</span>
    </div>
  )
}

function KpiCard({ item, onClick }: { item: KpiItem; onClick: () => void }) {
  const colors = KPI_COLORS[item.color] ?? KPI_COLORS.indigo
  const pct = item.dailyTarget > 0 ? Math.min(100, (item.today / item.dailyTarget) * 100) : 0
  const remaining = Math.max(0, item.dailyTarget - item.today)
  const done = item.today >= item.dailyTarget

  return (
    <div
      className="cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-semibold ${colors.text} flex items-center gap-1`}>
          <i className={`fa-solid ${item.icon}`} />
          {item.label}
        </span>
        <span className="text-xs text-slate-500 tabular-nums">
          <span className={`font-bold ${colors.text}`}>{item.today}</span>
          <span className="text-slate-400"> / {item.dailyTarget}</span>
          {!done && remaining > 0 && (
            <span className="ml-1 text-slate-400 text-[10px]">あと{remaining}</span>
          )}
          {done && (
            <span className="ml-1 text-emerald-500 text-[10px]">
              <i className="fa-solid fa-check" />
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${done ? 'bg-emerald-400' : colors.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function WeeklyProgressCard({ item, onClick }: { item: WeeklyProgressItem; onClick: () => void }) {
  const colors = KPI_COLORS[item.color] ?? KPI_COLORS.indigo
  const pct = item.weeklyTarget > 0 ? Math.min(100, (item.count / item.weeklyTarget) * 100) : 0
  const gap = item.count - item.expectedByNow
  const ahead = gap >= 0
  const gapLabel = gap === 0 ? '予定どおり' : ahead ? `予定より+${gap}` : `予定より${gap}`

  return (
    <button
      type="button"
      className="w-full text-left cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-semibold ${colors.text} flex items-center gap-1`}>
          <i className={`fa-solid ${item.icon}`} />
          {item.label}
        </span>
        <span className="text-xs text-slate-500 tabular-nums">
          <span className={`font-bold ${colors.text}`}>{item.count}</span>
          <span className="text-slate-400"> / {item.weeklyTarget}</span>
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${colors.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
        <span>{Math.round(pct)}%</span>
        <span className={ahead ? 'text-emerald-600' : 'text-rose-500'}>
          {gapLabel}
        </span>
      </div>
    </button>
  )
}

function MissionRow({ item, onClick }: { item: MissionItem; onClick: () => void }) {
  const isDone = item.count === 0
  const styleKey = isDone ? 'low' : item.urgency
  const s = URGENCY_STYLE[styleKey] ?? URGENCY_STYLE.low

  return (
    <li
      className={`${s.border} ${s.bg} flex items-center gap-3 px-4 py-2.5 ${!isDone ? 'cursor-pointer hover:brightness-95' : ''} transition-all`}
      onClick={!isDone ? onClick : undefined}
    >
      <span className="text-[11px] text-slate-400 w-4 text-center font-mono shrink-0">{item.priority}</span>
      <i className={`fa-solid ${item.icon} w-4 text-center shrink-0 text-sm ${isDone ? 'text-slate-200' : 'text-slate-500'}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-tight ${isDone ? 'text-slate-300' : 'text-slate-700'}`}>
          {item.label}
        </p>
        <p className={`text-[11px] truncate ${isDone ? 'text-slate-200' : 'text-slate-400'}`}>
          {item.sublabel}
        </p>
      </div>
      {isDone ? (
        <i className="fa-solid fa-circle-check text-emerald-400 text-base shrink-0" />
      ) : (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-xl font-bold tabular-nums leading-none ${s.count}`}>{item.count}</span>
          <span className={`text-xs ${s.count}`}>件</span>
          <i className="fa-solid fa-chevron-right text-xs text-slate-300" />
        </div>
      )}
    </li>
  )
}

function FunnelStepBlock({ step, isFirst }: { step: FunnelStep; isFirst: boolean }) {
  return (
    <div className="flex items-center shrink-0">
      {!isFirst && (
        <div className="flex flex-col items-center w-10 shrink-0">
          {step.convRate && step.convRate !== '-' && (
            <span className="text-[10px] text-slate-400 leading-none mb-0.5">{step.convRate}</span>
          )}
          <i className="fa-solid fa-arrow-right text-slate-300 text-xs" />
        </div>
      )}
      <div className="flex flex-col items-center">
        <div className={`w-11 h-11 rounded-xl ${step.colorClass} flex items-center justify-center shadow-sm`}>
          <span className="text-white text-sm font-bold tabular-nums">{step.count}</span>
        </div>
        <span className="text-[10px] text-slate-500 mt-1 text-center leading-tight">{step.label}</span>
      </div>
    </div>
  )
}

function AlertRow({ alert, onClick }: { alert: HomeAlert; onClick: () => void }) {
  const s = ALERT_STYLE[alert.severity] ?? ALERT_STYLE.info
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${s.bg} ${s.border} cursor-pointer hover:brightness-95 transition-all`}
      onClick={onClick}
    >
      <i className={`fa-solid ${s.icon} ${s.ic} text-sm shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700">{alert.label}</p>
        <p className="text-xs text-slate-500 truncate">{alert.detail}</p>
      </div>
      <i className="fa-solid fa-chevron-right text-xs text-slate-300 shrink-0" />
    </div>
  )
}

function ShortcutCard({ sc, onClick }: { sc: ShortcutItem; onClick: () => void }) {
  const isPrimary = sc.variant === 'primary'
  return (
    <button
      onClick={onClick}
      className={`relative text-left p-3 rounded-xl border transition-all hover:shadow-sm active:scale-95 ${
        isPrimary
          ? 'bg-indigo-600 border-indigo-700 text-white hover:bg-indigo-700'
          : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
      }`}
    >
      {sc.badge !== undefined && sc.badge > 0 && (
        <span className="absolute top-2 right-2 text-[10px] bg-rose-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold leading-none">
          {sc.badge}
        </span>
      )}
      <i className={`fa-solid ${sc.icon} text-base mb-1.5 block ${isPrimary ? 'text-indigo-200' : 'text-indigo-500'}`} />
      <p className={`text-xs font-semibold leading-tight ${isPrimary ? 'text-white' : 'text-slate-700'}`}>
        {sc.label}
      </p>
      <p className={`text-[10px] mt-0.5 ${isPrimary ? 'text-indigo-200' : 'text-slate-400'}`}>
        {sc.description}
      </p>
    </button>
  )
}

// ── メインコンポーネント ──────────────────────────────────────

export default function TabHome({ data, onGoTo, onGoToTab2WithItem }: Props) {
  const db = useMemo(() => getHomeDashboard(data), [data])

  const today = new Date()
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
  const dateLabel = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日（${WEEKDAYS[today.getDay()]}）`

  const totalMissionCount = db.mission.reduce((s, m) => s + m.count, 0)
  const weeklyTotal = db.weeklyProgress.reduce((s, item) => s + item.count, 0)
  const weeklyTarget = db.weeklyProgress.reduce((s, item) => s + item.weeklyTarget, 0)
  const weeklyExpected = db.weeklyProgress.reduce((s, item) => s + item.expectedByNow, 0)
  const weeklyPct = weeklyTarget > 0 ? (weeklyTotal / weeklyTarget) * 100 : 0
  const weeklyGap = weeklyTotal - weeklyExpected

  function handleMissionClick(item: MissionItem) {
    if (item.tab === 'tab2' && item.itemIds && item.itemIds.length > 0) {
      onGoToTab2WithItem(item.itemIds[0])
    } else {
      onGoTo(item.tab)
    }
  }

  return (
    <div className="w-full mx-auto p-4 space-y-5 pb-10">

      {/* ── ヘッダー ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <i className="fa-solid fa-house text-indigo-500" />
            営業 Command Center
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">{dateLabel}</p>
        </div>
        <button
          onClick={() => onGoTo('tab2')}
          className="btn-primary text-sm px-4 py-2 shrink-0"
        >
          <i className="fa-solid fa-play mr-1.5" />OS②へ
        </button>
      </div>

      {/* ── ミッション + Today KPI ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* ミッション */}
        <div className="lg:col-span-3 card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-sm text-slate-700 flex items-center gap-1.5">
              <i className="fa-solid fa-list-check text-indigo-500" />
              今日のミッション
            </h2>
            {totalMissionCount === 0 ? (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                <i className="fa-solid fa-circle-check" />全完了
              </span>
            ) : (
              <span className="text-xs text-slate-400">残り {totalMissionCount} 件</span>
            )}
          </div>
          <ul className="divide-y divide-slate-50">
            {db.mission.map(item => (
              <MissionRow
                key={item.id}
                item={item}
                onClick={() => handleMissionClick(item)}
              />
            ))}
          </ul>
        </div>

        {/* Today KPI + Waiting */}
        <div className="lg:col-span-2 space-y-3">

          {/* KPI */}
          <div className="card p-4">
            <h2 className="font-semibold text-sm text-slate-700 mb-3 flex items-center gap-1.5">
              <i className="fa-solid fa-bullseye text-indigo-500" />
              今日の進捗
            </h2>
            <div className="space-y-3">
              {db.todayKpi.map(item => (
                <KpiCard
                  key={item.id}
                  item={item}
                  onClick={() => onGoTo(item.tab)}
                />
              ))}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-semibold text-sm text-slate-700 mb-3 flex items-center gap-1.5">
              <i className="fa-solid fa-calendar-week text-violet-500" />
              今週の進捗
            </h2>
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 mb-3">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] text-slate-400">週累計 / 週目標</p>
                  <p className="text-base font-bold text-slate-800 tabular-nums">
                    {weeklyTotal} / {weeklyTarget}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-400">達成率</p>
                  <p className="text-base font-bold text-violet-600 tabular-nums">
                    {Math.round(weeklyPct)}%
                  </p>
                </div>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(100, weeklyPct)}%` }} />
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px]">
                <span className="text-slate-500">今週の理想進捗との差</span>
                <span className={weeklyGap >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-500 font-semibold'}>
                  {weeklyGap === 0 ? '予定どおり' : weeklyGap > 0 ? `+${weeklyGap}` : `${weeklyGap}`} 件
                </span>
              </div>
            </div>
            <div className="space-y-2">
              {db.weeklyProgress.map(item => (
                <WeeklyProgressCard
                  key={item.id}
                  item={item}
                  onClick={() => onGoTo(item.tab)}
                />
              ))}
            </div>
          </div>

          {/* Waiting */}
          <div className="card p-4">
            <h2 className="font-semibold text-sm text-slate-700 mb-2 flex items-center gap-1.5">
              <i className="fa-solid fa-hourglass-half text-amber-500" />
              ウェイティング
            </h2>
            <div className="grid grid-cols-2 gap-1.5">
              <WaitBadge label="反応待ち"  count={db.waiting.awaitingReaction} color="indigo" />
              <WaitBadge label="48h超え"   count={db.waiting.expired48h}       color={db.waiting.expired48h > 0 ? 'rose' : 'slate'} />
              <WaitBadge label="7日待機"   count={db.waiting.waiting7d}        color="amber" />
              <WaitBadge label="休眠/保管" count={db.waiting.sleeping}         color="slate" />
              <WaitBadge label="面談待ち"  count={db.waiting.meetingScheduled} color={db.waiting.meetingScheduled > 0 ? 'sky' : 'slate'} />
              <div className="col-span-1">
                <WaitBadge label="S1滞留（14日超え）" count={db.waiting.s1Stalled} color={db.waiting.s1Stalled > 0 ? 'amber' : 'slate'} />
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── 今週ファネル ─────────────────────────────────── */}
      <div className="card p-4">
        <h2 className="font-semibold text-sm text-slate-700 mb-3 flex items-center gap-1.5">
          <i className="fa-solid fa-filter-circle-dollar text-indigo-500" />
          今週のファネル
          <span className="ml-1 text-xs text-slate-400 font-normal">{db.weekStart} 〜</span>
        </h2>
        <div className="flex items-start gap-0 overflow-x-auto pb-1">
          {db.weeklyFunnel.map((step, i) => (
            <FunnelStepBlock key={step.label} step={step} isFirst={i === 0} />
          ))}
        </div>
      </div>

      {/* ── アラート ─────────────────────────────────────── */}
      {db.alerts.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-sm text-slate-700 flex items-center gap-1.5">
            <i className="fa-solid fa-bell text-amber-500" />
            アラート
            <span className="ml-1 bg-rose-500 text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold">
              {db.alerts.length}
            </span>
          </h2>
          {db.alerts.map(alert => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onClick={() => onGoTo(alert.tab)}
            />
          ))}
        </div>
      )}

      {/* ── 作業開始ショートカット ──────────────────────── */}
      <div>
        <h2 className="font-semibold text-sm text-slate-700 mb-2 flex items-center gap-1.5">
          <i className="fa-solid fa-rocket text-indigo-500" />
          作業開始
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {db.shortcuts.map(sc => (
            <ShortcutCard
              key={sc.tab}
              sc={sc}
              onClick={() => onGoTo(sc.tab)}
            />
          ))}
        </div>
      </div>

    </div>
  )
}
