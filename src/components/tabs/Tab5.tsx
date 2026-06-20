import { useState } from 'react'
import type { AppData, Analysis } from '../../types'
import type { Role } from '../../hooks/useAuth'

interface Props {
  data: AppData
  role: Role
}

const TYPE_LABELS: Record<string, string> = {
  case_pattern: '📊 失注パターン分析',
  touch_trend: '📝 文面傾向分析',
  emergency_alert: '🔴 対象選び警告',
}
const STATUS_LABELS: Record<string, string> = {
  pending: '未実施',
  prompted: 'プロンプト生成済み',
  completed: '完了',
}

function ActionBadge({ item }: { item: string }) {
  if (!item || item === '（前回分析なし）') return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
      <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wide mb-0.5">今すぐ直すべき1点</p>
      <p className="text-amber-800 font-semibold">{item}</p>
    </div>
  )
}

function AnalysisCard({ a, defaultOpen }: { a: Analysis; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  const date = a.completedAt || a.triggeredAt
  const dateStr = date ? new Date(date).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '/') : '—'

  return (
    <div className="card overflow-hidden">
      <button
        className="w-full p-4 text-left flex items-start gap-3 hover:bg-slate-50 transition"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-bold text-slate-700">{TYPE_LABELS[a.type] ?? a.type}</p>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${a.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {STATUS_LABELS[a.status] ?? a.status}
            </span>
            <span className="text-[10px] text-slate-400 ml-auto">{dateStr}</span>
          </div>
          {a.actionItem && (
            <p className="text-[11px] text-amber-700 mt-1 font-medium truncate">{a.actionItem}</p>
          )}
          {a.type === 'emergency_alert' && a.alertDetail && (
            <p className="text-[11px] text-red-600 mt-1 truncate">{a.alertDetail}</p>
          )}
        </div>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-slate-300 text-xs shrink-0 mt-0.5`} />
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4 flex flex-col gap-3 text-xs">
          {a.actionItem && <ActionBadge item={a.actionItem} />}

          {a.type === 'case_pattern' && (
            <div className="flex flex-col gap-2">
              {a.winRate && <Row label="受注率" value={a.winRate} />}
              {a.topLossType && <Row label="最多失注タイプ" value={a.topLossType} />}
              {a.patternSummary && <Block label="パターン要約" value={a.patternSummary} />}
              {a.lastActionImprovement && <Row label="前回指摘の改善状況" value={a.lastActionImprovement} />}
              {a.highValuePattern && <Block label="高学習価値案件の共通点" value={a.highValuePattern} />}
              {a.nextFocusPoint && <Row label="次回注目ポイント" value={a.nextFocusPoint} />}
            </div>
          )}

          {a.type === 'touch_trend' && (
            <div className="flex flex-col gap-2">
              {a.targetValiditySummary && <Row label="対象妥当性サマリ" value={a.targetValiditySummary} />}
              {a.messageValiditySummary && <Row label="文面妥当性サマリ" value={a.messageValiditySummary} />}
              {a.editEvalSummary && <Row label="編集評価サマリ" value={a.editEvalSummary} />}
              {a.topImprovementPattern && <Block label="最多改善提案パターン" value={a.topImprovementPattern} />}
              {a.frequentNgPostType && <Row label="✕多い投稿種別" value={a.frequentNgPostType} />}
              {a.trendComment && <Block label="傾向コメント" value={a.trendComment} />}
              {a.lastActionImprovement && <Row label="前回指摘の改善状況" value={a.lastActionImprovement} />}
              {a.nextFocusPoint && <Row label="次回注目ポイント" value={a.nextFocusPoint} />}
            </div>
          )}

          {a.type === 'emergency_alert' && a.alertDetail && (
            <pre className="text-[11px] text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap leading-relaxed border border-slate-200">{a.alertDetail}</pre>
          )}

          {a.rawOutput && (
            <details className="mt-1">
              <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600">フル出力を表示</summary>
              <pre className="mt-2 text-[10px] text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap overflow-x-auto border border-slate-100">{a.rawOutput}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className="text-slate-700 font-medium">{value}</span>
    </div>
  )
}
function Block({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700 leading-relaxed whitespace-pre-wrap">{value}</span>
    </div>
  )
}

export default function Tab5({ data, role: _role }: Props) {
  const analyses = [...(data.analyses || [])].sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))
  const completed = analyses.filter(a => a.status === 'completed')
  const caseActions = completed.filter(a => a.type === 'case_pattern' && a.actionItem).map(a => a.actionItem!)
  const touchActions = completed.filter(a => a.type === 'touch_trend' && a.actionItem).map(a => a.actionItem!)

  return (
    <div className="flex flex-col gap-4" style={{ animation: 'fadeIn .2s ease-out' }}>
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-xs text-violet-900">
        <span className="font-bold">📊 分析履歴：</span>
        失注パターン・文面傾向の分析PDCA軌跡。「今すぐ直すべき1点」の時系列が改善の軸。
      </div>

      {/* PDCA Timeline */}
      {(caseActions.length > 0 || touchActions.length > 0) && (
        <div className="card p-4 flex flex-col gap-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">「今すぐ直すべき1点」タイムライン</p>
          {caseActions.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-bold text-violet-600">📊 失注分析</p>
              {caseActions.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-slate-300 shrink-0">#{caseActions.length - i}</span>
                  <span className="text-slate-700">{a}</span>
                </div>
              ))}
            </div>
          )}
          {touchActions.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-bold text-indigo-600">📝 文面分析</p>
              {touchActions.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-slate-300 shrink-0">#{touchActions.length - i}</span>
                  <span className="text-slate-700">{a}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {analyses.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-slate-300 gap-2">
          <i className="fa-solid fa-chart-line text-4xl" />
          <p className="text-sm font-medium">分析履歴がありません</p>
          <p className="text-xs text-center">案件管理タブで「分析する→」を実行すると記録されます</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {analyses.map((a, i) => (
            <AnalysisCard key={a.id} a={a} defaultOpen={i === 0} />
          ))}
        </div>
      )}
    </div>
  )
}
