import { useState } from 'react'
import MdPreviewModal from '../MdPreviewModal'
import { buildSummaryMd, summaryMdFilename } from '../../utils/mdExport'
import type { AppData, TrashItem, PipelineItem, Target } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { closeTypeBadgeClass, daysSince } from '../../utils/helpers'

interface Props {
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  role: Role
  toast: ToastAPI
  confirm?: ConfirmAPI
}

export default function Tab4({ data, saveData, toast, confirm, role: _role }: Props) {
  const [trashOpen, setTrashOpen] = useState(false)
  const [mdPreview, setMdPreview] = useState<{ content: string; filename: string } | null>(null)
  const targets = data.targets || []
  const pipeline = data.pipeline || []
  const closed = data.closed || []
  const screenings = data.screenings || []

  const active = pipeline.filter(p => p.isOpen)
  const totalScreened = targets.length
  const totalPipeline = active.length
  const totalClosed = closed.length
  const wonCount = closed.filter(c => c.result === '受注').length
  const lostCount = closed.filter(c => c.result !== '受注').length

  const convRate = totalScreened > 0 ? Math.round((totalPipeline / totalScreened) * 100) : 0
  const closeRate = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 0

  const avgLV = (() => {
    const vals = closed.filter(c => c.learningValue != null).map(c => c.learningValue as number)
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  })()

  // Funnel — each stage counted by its own IDs, not cumulative
  const funnelSteps = [
    { label: 'OS⓪ 一次選別（通過数）', count: screenings.length, color: 'bg-fuchsia-500' },
    { label: 'OS① スクリーニング済み', count: targets.length, color: 'bg-violet-500' },
    { label: 'OS② パイプライン（累計）', count: pipeline.length, color: 'bg-indigo-500' },
    { label: 'OS② 進行中', count: totalPipeline, color: 'bg-blue-500' },
    { label: 'OS③ クローズ', count: totalClosed, color: 'bg-emerald-500' },
    { label: '受注', count: wonCount, color: 'bg-green-500' },
  ]
  const maxCount = Math.max(...funnelSteps.map(s => s.count), 1)

  // Close type distribution
  const typeCount: Record<string, number> = {}
  closed.forEach(c => {
    const t = c.closeType || 'Unknown'
    typeCount[t] = (typeCount[t] || 0) + 1
  })
  const typeEntries = Object.entries(typeCount).sort((a, b) => b[1] - a[1])

  // What did they want (market needs)
  const wantedCount: Record<string, number> = {}
  closed.forEach(c => {
    if (c.wanted) {
      const k = c.wanted.trim()
      wantedCount[k] = (wantedCount[k] || 0) + 1
    }
  })
  const wantedEntries = Object.entries(wantedCount).sort((a, b) => b[1] - a[1])
  const maxWanted = wantedEntries[0]?.[1] || 1

  // Conservative bias check
  const ftCount = active.filter(p => p.track === 'FT').length
  const ntCount = active.filter(p => p.track === 'NT').length
  const ftRatio = totalPipeline > 0 ? Math.round((ftCount / totalPipeline) * 100) : 0

  // Alert checks
  const warns: string[] = []
  if (totalScreened >= 10) {
    if (convRate < 20) warns.push(`パイプライン転換率が${convRate}%（目標：20%以上）。OS①でSKIPを増やしすぎていないか確認。`)
    if (closeRate < 30 && totalClosed >= 5) warns.push(`受注率が${closeRate}%（目標：30%以上）。クローズタイプを分析して改善ポイントを探してください。`)
    if (ftRatio < 30 && totalPipeline > 5) warns.push(`FTトラックの割合が${ftRatio}%（目標：30%以上）。DM直行できるFT案件を積極的に発掘してください。`)
  }

  function handleRestoreFromTrash(item: TrashItem) {
    saveData(prev => {
      const { _trashId, _trashSource, _trashedAt, ...rest } = item
      const updated = { ...prev, trash: (prev.trash || []).filter(t => t._trashId !== _trashId) }
      if (_trashSource === 'OS②') {
        updated.pipeline = [...(updated.pipeline || []), { ...rest, isOpen: true } as unknown as PipelineItem]
      } else if (_trashSource === 'target') {
        updated.targets = [...(updated.targets || []), rest as unknown as Target]
      }
      return updated
    })
    toast.show('ゴミ箱から復元しました')
  }

  function handlePurgeTrash(trashId: string) {
    if (!confirm) {
      saveData(prev => ({ ...prev, trash: (prev.trash || []).filter(t => t._trashId !== trashId) }))
      toast.show('完全に削除しました')
      return
    }
    confirm.show('完全削除確認', 'このデータを完全に削除しますか？元に戻せません。', () => {
      saveData(prev => ({ ...prev, trash: (prev.trash || []).filter(t => t._trashId !== trashId) }))
      toast.show('完全に削除しました')
    })
  }

  function handleExportSentLog() {
    const pipeline = data.pipeline || []
    const sentMsgs: Array<{ accountName: string; channel: string; date: string; label: string; original: string; actual: string; reason: string }> = []
    pipeline.forEach(p => {
      (p.sentMessages || []).forEach(sm => {
        sentMsgs.push({ accountName: p.accountName, channel: p.channel, date: sm.date, label: sm.label, original: sm.original, actual: sm.actual, reason: sm.reason })
      })
    })
    if (sentMsgs.length === 0) { toast.show('送信ログがありません'); return }

    const lines = sentMsgs.map(m =>
      `## ${m.accountName}（${m.channel}）${m.date} ${m.label}\n**元のAI案：**\n${m.original}\n\n**実際に送った文章：**\n${m.actual || m.original}\n\n${m.reason ? `**編集理由：** ${m.reason}\n` : ''}`
    ).join('\n---\n\n')
    const md = `# 送信文章ログ\n生成：${new Date().toLocaleDateString('ja-JP')}\n\n---\n\n${lines}`
    setMdPreview({ content: md, filename: 'sent_log.md' })
  }

  function handleExportSummary() {
    const content = buildSummaryMd(data)
    setMdPreview({ content, filename: summaryMdFilename() })
  }

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'fadeIn .2s ease-out' }}>
      {/* KPI metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'スクリーニング済', value: totalScreened, sub: `OS⓪通過: ${screenings.length}` },
          { label: 'パイプライン（進行中）', value: totalPipeline, sub: `FT: ${ftCount} / NT: ${ntCount}` },
          { label: 'クローズ（総計）', value: totalClosed, sub: `受注: ${wonCount} / 失注: ${lostCount}` },
          { label: '受注率', value: `${closeRate}%`, sub: avgLV != null ? `平均学習価値: ${avgLV}pt` : '' },
        ].map(m => (
          <div key={m.label} className="metric-card">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">{m.label}</p>
            <p className="text-2xl font-bold text-slate-900">{m.value}</p>
            {m.sub && <p className="text-[10px] text-slate-400">{m.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Funnel */}
        <div className="card p-5">
          <h3 className="font-bold text-sm text-slate-800 mb-4 flex items-center gap-2">
            <i className="fa-solid fa-filter text-violet-500" />転換ファネル
          </h3>
          <div className="flex flex-col gap-2">
            {funnelSteps.map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="text-slate-400 w-36 shrink-0">{s.label}</span>
                <div className="flex-1">
                  <div
                    className={`funnel-bar ${s.color}`}
                    style={{ width: `${Math.max(10, Math.round((s.count / maxCount) * 100))}%` }}
                  >
                    <span className="text-[10px] font-bold">{s.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Conservative bias */}
        <div className="card p-5">
          <h3 className="font-bold text-sm text-slate-800 mb-4 flex items-center gap-2">
            <i className="fa-solid fa-scale-balanced text-amber-500" />保守バイアス判定
          </h3>
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">OS①転換率</span>
              <span className={`font-bold ${convRate >= 20 ? 'text-emerald-600' : 'text-rose-600'}`}>{convRate}%（目標：20%+）</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">FTトラック比率</span>
              <span className={`font-bold ${ftRatio >= 30 ? 'text-emerald-600' : 'text-amber-600'}`}>{ftRatio}%（目標：30%+）</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">受注率</span>
              <span className={`font-bold ${closeRate >= 30 ? 'text-emerald-600' : 'text-rose-600'}`}>{closeRate}%（目標：30%+）</span>
            </div>
            {warns.length === 0 && totalScreened >= 10 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-800">
                <i className="fa-solid fa-circle-check text-emerald-500 mr-1" />すべての指標が目標範囲内です
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Close type distribution */}
        <div className="card p-5">
          <h3 className="font-bold text-sm text-slate-800 mb-4 flex items-center gap-2">
            <i className="fa-solid fa-chart-pie text-emerald-500" />クローズタイプ分布
          </h3>
          {typeEntries.length === 0 ? (
            <p className="text-xs text-slate-300 text-center py-8">データなし</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {typeEntries.map(([type, count]) => (
                <div key={type} className="flex items-center gap-2 text-xs">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${closeTypeBadgeClass(type)} w-16 text-center shrink-0`}>{type}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${Math.round((count / (typeEntries[0]?.[1] || 1)) * 100)}%` }} />
                  </div>
                  <span className="text-slate-500 w-8 text-right">{count}件</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Market needs */}
        <div className="card p-5">
          <h3 className="font-bold text-sm text-slate-800 mb-4 flex items-center gap-2">
            <i className="fa-solid fa-store text-indigo-500" />相手が欲しかったもの
          </h3>
          {wantedEntries.length === 0 ? (
            <p className="text-xs text-slate-300 text-center py-8">データなし</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {wantedEntries.slice(0, 10).map(([want, count]) => (
                <div key={want} className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600 flex-1 truncate">{want}</span>
                  <div className="w-20 bg-slate-100 rounded-full h-2">
                    <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${Math.round((count / maxWanted) * 100)}%` }} />
                  </div>
                  <span className="text-slate-400 w-6 text-right">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* OS調整チェック */}
      {warns.length > 0 && (
        <div className="card p-5">
          <h3 className="font-bold text-sm text-slate-800 mb-3 flex items-center gap-2">
            <i className="fa-solid fa-triangle-exclamation text-amber-500" />OS調整チェック（10件以上で発動）
          </h3>
          <div className="flex flex-col gap-2">
            {warns.map((w, i) => (
              <div key={i} className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                <i className="fa-solid fa-triangle-exclamation mr-1" />{w}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trash */}
      <div className="card overflow-hidden">
        <button
          className="w-full p-4 flex items-center gap-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          onClick={() => setTrashOpen(v => !v)}
        >
          <i className="fa-solid fa-trash text-rose-400" />
          ゴミ箱
          <span className="ml-1 text-xs font-bold bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full">{(data.trash || []).length}件</span>
          <i className={`fa-solid fa-chevron-${trashOpen ? 'up' : 'down'} text-slate-300 text-xs ml-auto`} />
        </button>
        {trashOpen && (
          <div className="border-t border-slate-100 p-4 flex flex-col gap-2">
            {(data.trash || []).length === 0 ? (
              <p className="text-xs text-slate-300 text-center py-4">ゴミ箱は空です</p>
            ) : (
              <>
                <p className="text-[11px] text-slate-400 mb-1">ゴミ箱から削除して初めてデータが完全に消えます。</p>
                {(data.trash || []).map(t => (
                  <div key={t._trashId} className="flex items-center gap-2 text-xs bg-rose-50 border border-rose-100 rounded-lg p-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-700 truncate">
                        {(t as unknown as {accountName?: string}).accountName || (t as unknown as {handle?: string}).handle || t._trashId}
                      </p>
                      <p className="text-slate-400 text-[10px]">
                        {t._trashSource} • {new Date(t._trashedAt).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                    <button
                      className="shrink-0 text-[11px] py-1 px-2 border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 transition"
                      onClick={() => handleRestoreFromTrash(t)}
                    >
                      <i className="fa-solid fa-rotate-left mr-1" />戻す
                    </button>
                    <button
                      className="shrink-0 text-[11px] py-1 px-2 border border-rose-200 text-rose-500 rounded-lg hover:bg-rose-100 transition"
                      onClick={() => handlePurgeTrash(t._trashId)}
                    >
                      <i className="fa-solid fa-trash" />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Export section */}
      <div className="card p-5 flex flex-col gap-4">
        <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
          <i className="fa-solid fa-file-arrow-down text-violet-500" />MDエクスポート
        </h3>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-0.5">全案件サマリ</p>
            <p className="text-xs text-slate-400 mb-2">進行中・クローズ済みの一覧を1ファイルにまとめて出力。</p>
            <button className="btn-primary text-xs" onClick={handleExportSummary}>
              <i className="fa-solid fa-file-lines" />全案件をプレビュー
            </button>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-700 mb-0.5">送信文章ログ</p>
            <p className="text-xs text-slate-400 mb-2">送信した文章・元のAI案・編集理由をMDでまとめて出力。</p>
            <button className="btn-sec text-xs" onClick={handleExportSentLog}>
              <i className="fa-solid fa-file-lines" />送信ログをプレビュー
            </button>
          </div>
        </div>
      </div>

      {mdPreview && (
        <MdPreviewModal
          content={mdPreview.content}
          filename={mdPreview.filename}
          onClose={() => setMdPreview(null)}
        />
      )}
    </div>
  )
}
