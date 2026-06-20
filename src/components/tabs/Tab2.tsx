import { useState } from 'react'
import type { AppData, Prompts, PipelineItem, SentMessage, Reply } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS2 } from '../../utils/parser'
import { addToExcluded, moveToTrash, normalizeHandle, buildProfileUrl, trackBadgeClass, stepsBarData, urgencyClass, daysSince, buildConvLog, uid, todayStr } from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'

interface Props {
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
  onGoToTab3: () => void
}

export default function Tab2({ data, saveData, prompts, role, toast, confirm, onGoToTab3 }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState('all')
  const [filterStep, setFilterStep] = useState('all')
  const [sort, setSort] = useState('newest')
  const [resultText, setResultText] = useState('')
  const [step, setStep] = useState('S1')
  const [repCount, setRepCount] = useState(0)
  const [dmCount, setDmCount] = useState(0)
  const [lastDate, setLastDate] = useState(todayStr())
  const [reaction, setReaction] = useState<string[]>([])
  const [targetPost, setTargetPost] = useState('')
  const [replyText, setReplyText] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [convText, setConvText] = useState('')
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendLabel, setSendLabel] = useState('')
  const [sendOriginal, setSendOriginal] = useState('')
  const [sendActual, setSendActual] = useState('')
  const [sendReason, setSendReason] = useState('')
  const [sendPipelineId, setSendPipelineId] = useState<string | null>(null)
  const [closeResult, setCloseResult] = useState('断り')

  const active = data.pipeline.filter(p => p.isOpen)
  let filtered = active
  if (filter === 'FT') filtered = filtered.filter(p => p.track === 'FT')
  else if (filter === 'NT') filtered = filtered.filter(p => p.track === 'NT')
  else if (filter === 'warn') filtered = filtered.filter(p => daysSince(p.lastContactDate) >= 7 || daysSince(p.startDate) >= 30)
  if (filterStep !== 'all') filtered = filtered.filter(p => p.currentStep === filterStep)
  if (sort === 'urgent') filtered = [...filtered].sort((a, b) => daysSince(b.lastContactDate) - daysSince(a.lastContactDate))
  else filtered = [...filtered].reverse()

  const total = filtered.length
  const totalPages = Math.ceil(total / 10)
  const safePage = Math.min(page, Math.max(0, totalPages - 1))
  const pageItems = filtered.slice(safePage * 10, safePage * 10 + 10)
  const selectedItem = selectedId ? data.pipeline.find(x => x.id === selectedId) || null : null

  const warnItems = active.filter(p => daysSince(p.lastContactDate) >= 7 || daysSince(p.startDate) >= 30)

  function selectItem(id: string) {
    setSelectedId(id)
    const p = data.pipeline.find(x => x.id === id)
    if (p) {
      setStep(p.currentStep)
      setRepCount(p.repCount || 0)
      setDmCount(p.dmCount || 0)
      setLastDate(p.lastContactDate || todayStr())
      setConvText(buildConvLog(p))
      setResultText('')
      setTargetPost('')
      setReplyText('')
      setReaction([])
    }
  }

  function handleSubmitOS2() {
    const text = resultText.trim()
    if (!text || !selectedId) { toast.show('AIの出力を貼り付けてください', 2000); return }
    const parsed = parseOS2(text)
    const reactionStr = reaction.join('＋')
    saveData(prev => {
      const d = { ...prev, pipeline: prev.pipeline.map(p => {
        if (p.id !== selectedId) return p
        const newEntry = {
          date: lastDate || todayStr(),
          reaction: reactionStr,
          step: step as PipelineItem['currentStep'],
          repCount: Number(repCount),
          dmCount: Number(dmCount),
          targetPost: targetPost || '',
          judgment: parsed.judgment || '',
          nextAction: parsed.nextAction || '',
          deadline: parsed.deadline || '',
          redSignal: parsed.redSignal || '',
          responseQuality: parsed.responseQuality || '',
          hypothesisCheck: parsed.hypothesisCheck || '',
          ngAction: parsed.ngAction || '',
          replyA: parsed.replyA || '',
          replyB: parsed.replyB || '',
        }
        return {
          ...p,
          currentStep: (parsed.step || step) as PipelineItem['currentStep'],
          repCount: Number(repCount),
          dmCount: Number(dmCount),
          lastContactDate: lastDate || todayStr(),
          judgment: parsed.judgment || null,
          nextAction: parsed.nextAction || null,
          deadline: parsed.deadline || null,
          replyA: parsed.replyA || null,
          replyB: parsed.replyB || null,
          ngAction: parsed.ngAction || null,
          redSignal: parsed.redSignal || null,
          responseQuality: parsed.responseQuality || null,
          history: [...(p.history || []), newEntry],
          analyses: [...(p.analyses || []), { date: lastDate || todayStr(), aiInput: text, aiOutput: text, judgment: parsed.judgment || '' }],
        }
      })}
      return d
    })
    setResultText('')
    setReaction([])
    toast.show('OS②分析を記録しました')
  }

  function openSendModal(label: string, original: string, pipelineId: string | null) {
    setSendLabel(label)
    setSendOriginal(original)
    setSendActual('')
    setSendReason('')
    setSendPipelineId(pipelineId)
    setSendModalOpen(true)
  }

  function handleRecordSend() {
    const actual = sendActual.trim() || sendOriginal
    const msg: SentMessage = {
      id: uid(),
      label: sendLabel,
      original: sendOriginal,
      actual,
      edited: !!sendActual.trim() && sendActual.trim() !== sendOriginal,
      reason: sendReason,
      date: todayStr(),
    }
    if (sendPipelineId) {
      const isStory = sendLabel.includes('ストーリー')
      const isDM = sendLabel.includes('DM')
      saveData(prev => ({
        ...prev,
        pipeline: prev.pipeline.map(p => {
          if (p.id !== sendPipelineId) return p
          const updated = { ...p, sentMessages: [...(p.sentMessages || []), msg] }
          if (isDM && p.currentStep === 'S1') {
            updated.currentStep = 'S2'
            if (!updated.stepHistory) updated.stepHistory = []
            updated.stepHistory = [...updated.stepHistory, { step: 'S2', date: todayStr() }]
          }
          return updated
        })
      }))
      toast.show(`${sendLabel} を送信完了として記録しました`)
    } else {
      toast.show(`${sendLabel} を送信完了として記録`)
    }
    setSendModalOpen(false)
  }

  function handleAddReply() {
    if (!selectedId) return
    const text = replyText.trim()
    const reactionStr = reaction.join('＋')
    const reply: Reply = {
      id: uid(),
      sentMsgId: replyTo || null,
      text,
      reaction: reactionStr,
      date: lastDate || todayStr(),
    }
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => p.id === selectedId ? { ...p, replies: [...(p.replies || []), reply] } : p)
    }))
    setReplyText('')
    setReplyTo('')
    toast.show('返信を記録しました')
  }

  function handleDelete(id: string) {
    const item = data.pipeline.find(x => x.id === id)
    if (!item) return
    saveData(prev => {
      const d = { ...prev, pipeline: prev.pipeline.filter(p => p.id !== id), excluded: [...(prev.excluded || [])], trash: [...(prev.trash || [])] }
      addToExcluded(d, item.url || item.accountName, item.accountName, item.channel, 'パイプライン削除')
      const tid = moveToTrash(d, item as unknown as Record<string, unknown>, 'OS②')
      if (item.targetId) {
        const tIdx = d.targets ? d.targets.findIndex(t => t.id === item.targetId) : -1;
        if (tIdx >= 0) {
          (d as AppData).targets = [...(d as AppData).targets]
          ;(d as AppData).targets[tIdx] = { ...(d as AppData).targets[tIdx], pipelineId: null }
        }
      }
      setTimeout(() => {
        toast.showUndo(`「${item.accountName}」をパイプラインから削除`, () => {
          saveData(prev2 => {
            const d2 = { ...prev2, trash: [...(prev2.trash || [])], pipeline: [...prev2.pipeline] }
            const tidx = d2.trash.findIndex(x => x._trashId === tid)
            if (tidx === -1) return d2
            const restored = { ...d2.trash[tidx] } as Record<string, unknown>
            d2.trash.splice(tidx, 1)
            delete restored._trashSource; delete restored._trashedAt; delete restored._trashId
            d2.pipeline = [...d2.pipeline, restored as unknown as PipelineItem]
            if (item.targetId) {
              d2.targets = d2.targets.map(t => t.id === item.targetId ? { ...t, pipelineId: id } : t)
            }
            return d2
          })
        })
      }, 0)
      return d
    })
    if (selectedId === id) setSelectedId(null)
  }

  function handleClose() {
    if (!selectedId) return
    const item = data.pipeline.find(x => x.id === selectedId)
    if (!item) return
    confirm.show('クローズ確認', `「${item.accountName}」をクローズしますか？（${closeResult}）`, () => {
      const closeDate = todayStr()
      saveData(prev => {
        const d = { ...prev, pipeline: prev.pipeline.map(p => p.id === selectedId ? { ...p, isOpen: false, closedAt: closeDate, closedCaseId: p.caseId || null } : p) }
        const pFinal = d.pipeline.find(p => p.id === selectedId)!
        const closedEntry = {
          id: uid(),
          pipelineId: selectedId,
          createdAt: new Date().toISOString(),
          accountName: pFinal.accountName,
          track: pFinal.track,
          hypothesis: pFinal.hypothesis,
          startDate: pFinal.startDate,
          closeDate,
          result: closeResult,
          ruleFired: false,
        }
        d.closed = [...d.closed, closedEntry]
        return d
      })
      setSelectedId(null)
      toast.show(`「${item.accountName}」をクローズしました（${closeResult}）`)
      if (closeResult === '受注' || ['断り', 'フェードアウト', '未読', '未到達クローズ', 'ブロック'].includes(closeResult)) {
        setTimeout(() => onGoToTab3(), 500)
      }
    })
  }

  const reactionOptions = ['テキスト返信', 'いいね', 'スタンプ/絵文字', 'リポスト', '無反応', '既読スルー']

  function toggleReaction(r: string) {
    setReaction(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])
  }

  const StepsBar = ({ currentStep }: { currentStep: string }) => {
    const nodes = stepsBarData(currentStep)
    return (
      <div className="s-bar">
        {nodes.map((n, i) => <div key={i} className={n.cls} title={n.tip} />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'fadeIn .2s ease-out' }}>
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-900">
        <span className="font-bold"><i className="fa-solid fa-chart-gantt mr-1" />OS② 設計原則：</span>
        S1→S5のステップを管理。7日以上空いたら警告、30日超で強制クローズ判断。
      </div>

      {warnItems.length > 0 && (
        <div className="flex flex-col gap-2">
          {warnItems.map(p => {
            const d30 = daysSince(p.startDate) >= 30
            const msg = d30 ? '30日ルール発動: 強制クローズまたは再接触してください' : '7日ルール発動: 再接触するかクローズしてください'
            const cls = d30 ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'
            return (
              <div key={p.id} className={`border rounded-xl p-3 text-xs ${cls} flex items-center gap-2 cursor-pointer`} onClick={() => selectItem(p.id)}>
                <i className="fa-solid fa-triangle-exclamation" />
                <span className="font-bold">{p.accountName}</span>：{msg}
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: list */}
        <section className="lg:col-span-5 flex flex-col gap-3">
          <div className="card flex flex-col" style={{ minHeight: 480 }}>
            <div className="p-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
              <select className="input-base text-xs py-1.5" style={{ maxWidth: 100 }} value={filter} onChange={e => { setFilter(e.target.value); setPage(0) }}>
                <option value="all">全て</option>
                <option value="FT">FT</option>
                <option value="NT">NT</option>
                <option value="warn">警告のみ</option>
              </select>
              <select className="input-base text-xs py-1.5" style={{ maxWidth: 90 }} value={filterStep} onChange={e => { setFilterStep(e.target.value); setPage(0) }}>
                <option value="all">全ステップ</option>
                {['S1','S2','S3','S4','S5'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input-base text-xs py-1.5" style={{ maxWidth: 100 }} value={sort} onChange={e => setSort(e.target.value)}>
                <option value="newest">登録順</option>
                <option value="urgent">緊急度順</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto cs">
              {total === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-300 gap-2">
                  <i className="fa-solid fa-chart-gantt text-4xl" />
                  <p className="text-sm font-medium">案件がありません</p>
                </div>
              ) : (
                pageItems.map(p => {
                  const days = daysSince(p.lastContactDate)
                  const totalDays = daysSince(p.startDate)
                  const uc = urgencyClass(days)
                  return (
                    <div
                      key={p.id}
                      className={`pipeline-row ${selectedId === p.id ? 'selected' : ''}`}
                      onClick={() => selectItem(p.id)}
                    >
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${trackBadgeClass(p.track)}`}>{p.track}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-800 truncate">{p.accountName}</p>
                        <StepsBar currentStep={p.currentStep} />
                      </div>
                      <span className={`${uc} text-xs font-bold whitespace-nowrap`}>{days < 999 ? days + '日前' : '-'}</span>
                      {days >= 7 && totalDays < 30 && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">7日超</span>}
                      {totalDays >= 30 && <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5">30日超</span>}
                      <span className="text-[10px] font-bold text-slate-500">{p.currentStep}</span>
                    </div>
                  )
                })
              )}
            </div>
            {totalPages > 1 && (
              <div className="p-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <button className="btn-sec text-xs py-1.5 px-3" disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}><i className="fa-solid fa-chevron-left" /></button>
                <span className="text-xs text-slate-500">{safePage * 10 + 1}〜{Math.min(safePage * 10 + 10, total)}件 / 全{total}件</span>
                <button className="btn-sec text-xs py-1.5 px-3" disabled={safePage >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}><i className="fa-solid fa-chevron-right" /></button>
              </div>
            )}
          </div>
        </section>

        {/* Right: detail / OS② form */}
        <section className="lg:col-span-7 flex flex-col gap-3">
          {!selectedItem ? (
            <div className="card flex items-center justify-center text-slate-300 gap-2" style={{ minHeight: 480 }}>
              <i className="fa-solid fa-chart-gantt text-4xl" /><p className="text-sm">案件を選択してください</p>
            </div>
          ) : (
            <>
              <div className="card p-5 flex flex-col gap-4">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${trackBadgeClass(selectedItem.track)} shrink-0`}>{selectedItem.track}</span>
                    <h3 className="font-bold text-slate-900 text-base truncate">{selectedItem.accountName}</h3>
                    {selectedItem.caseId && <span className="text-[10px] text-slate-400">案件ID: {selectedItem.caseId}</span>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {buildProfileUrl(selectedItem.url, selectedItem.channel) && (
                      <a href={buildProfileUrl(selectedItem.url, selectedItem.channel)} target="_blank" rel="noreferrer" className="btn-sec text-xs py-1.5 px-2.5">
                        <i className="fa-solid fa-arrow-up-right-from-square" />
                      </a>
                    )}
                    {role === 'admin' && (
                      <button className="btn-danger text-xs py-1.5 px-2" onClick={() => handleDelete(selectedItem.id)}>
                        <i className="fa-solid fa-trash" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                    <p className="text-slate-400">経過日数</p>
                    <p className={`font-bold text-lg mt-0.5 ${urgencyClass(daysSince(selectedItem.lastContactDate))}`}>{daysSince(selectedItem.startDate)}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                    <p className="text-slate-400">リプ往復</p>
                    <p className="font-bold text-lg mt-0.5">{selectedItem.repCount || 0}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                    <p className="text-slate-400">DM往復</p>
                    <p className="font-bold text-lg mt-0.5">{selectedItem.dmCount || 0}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                    <p className="text-slate-400">最終接触</p>
                    <p className="font-bold text-sm mt-0.5">{selectedItem.lastContactDate ? new Date(selectedItem.lastContactDate).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '-'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="s-bar flex-1"><StepsBar currentStep={selectedItem.currentStep} /></div>
                  <span className="text-xs font-bold text-indigo-600">{selectedItem.currentStep}</span>
                </div>

                {selectedItem.hypothesis && (
                  <div className="bg-slate-50 rounded-lg p-2.5 text-xs">
                    <p className="text-slate-400 text-[10px] mb-0.5">事前仮説</p>
                    <p className="text-slate-700">{selectedItem.hypothesis}</p>
                  </div>
                )}

                {/* Latest judgment */}
                {(selectedItem.judgment || selectedItem.nextAction || selectedItem.replyA || selectedItem.replyB) && (
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex flex-col gap-2 text-xs">
                    <p className="font-bold text-indigo-800 text-[11px] uppercase tracking-wide">最新OS②判定</p>
                    {selectedItem.judgment && (
                      <div className="flex gap-2">
                        <span className="text-slate-400 w-24 shrink-0">判定</span>
                        <span className={`font-bold ${selectedItem.judgment === '前進' ? 'text-violet-700' : selectedItem.judgment === 'クローズ' ? 'text-rose-600' : 'text-amber-600'}`}>{selectedItem.judgment}</span>
                      </div>
                    )}
                    {selectedItem.nextAction && <div className="flex gap-2"><span className="text-slate-400 w-24 shrink-0">次アクション</span><span className="text-slate-700 font-semibold">{selectedItem.nextAction}</span></div>}
                    {selectedItem.deadline && <div className="flex gap-2"><span className="text-slate-400 w-24 shrink-0">実行期限</span><span className="text-amber-600 font-semibold">{selectedItem.deadline}</span></div>}
                    {selectedItem.redSignal && selectedItem.redSignal !== '無' && <div className="flex gap-2"><span className="text-slate-400 w-24 shrink-0">赤信号</span><span className="red-signal">{selectedItem.redSignal}</span></div>}
                    {selectedItem.ngAction && <div className="flex gap-2"><span className="text-slate-400 w-24 shrink-0">やってはいけない</span><span className="text-rose-600">{selectedItem.ngAction}</span></div>}
                    {selectedItem.replyA && (
                      <div className="flex items-start gap-2">
                        <span className="text-violet-600 font-bold shrink-0 w-24">案A（前進）</span>
                        <div className="flex-1 flex gap-1">
                          <p className="text-violet-600 flex-1 whitespace-pre-wrap">{selectedItem.replyA}</p>
                          <button className="shrink-0 btn-sec text-xs py-1 px-2" onClick={() => copyText(selectedItem.replyA!, () => toast.show('案Aをコピーしました'))}><i className="fa-regular fa-copy" /></button>
                          <button className="shrink-0 text-xs py-1 px-2 bg-emerald-50 text-emerald-600 rounded border border-emerald-200 hover:bg-emerald-100 transition" onClick={() => openSendModal('案A（前進案）', selectedItem.replyA!, selectedItem.id)}><i className="fa-regular fa-square-check" /> 送信完了</button>
                        </div>
                      </div>
                    )}
                    {selectedItem.replyB && (
                      <div className="flex items-start gap-2">
                        <span className="text-indigo-500 font-bold shrink-0 w-24">案B（安全）</span>
                        <div className="flex-1 flex gap-1">
                          <p className="text-indigo-500 flex-1 whitespace-pre-wrap">{selectedItem.replyB}</p>
                          <button className="shrink-0 btn-sec text-xs py-1 px-2" onClick={() => copyText(selectedItem.replyB!, () => toast.show('案Bをコピーしました'))}><i className="fa-regular fa-copy" /></button>
                          <button className="shrink-0 text-xs py-1 px-2 bg-emerald-50 text-emerald-600 rounded border border-emerald-200 hover:bg-emerald-100 transition" onClick={() => openSendModal('案B（安全案）', selectedItem.replyB!, selectedItem.id)}><i className="fa-regular fa-square-check" /> 送信完了</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* OS② input form */}
              <div className="card p-5 flex flex-col gap-3">
                <p className="font-bold text-sm text-slate-800"><i className="fa-solid fa-robot text-indigo-500 mr-1" />OS②行動判定を実行</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">ステップ</label>
                    <select className="input-base text-xs py-2" value={step} onChange={e => setStep(e.target.value)}>
                      {['S1','S2','S3','S4','S5'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">接触日</label>
                    <input type="date" className="input-base text-xs py-2" value={lastDate} onChange={e => setLastDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">リプ往復数</label>
                    <input type="number" className="input-base text-xs py-2" value={repCount} onChange={e => setRepCount(Number(e.target.value))} min={0} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">DM往復数</label>
                    <input type="number" className="input-base text-xs py-2" value={dmCount} onChange={e => setDmCount(Number(e.target.value))} min={0} />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">相手の反応</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {reactionOptions.map(r => (
                      <label key={r} className={`reaction-check-label ${reaction.includes(r) ? 'checked' : ''}`}>
                        <input type="checkbox" className="hidden" checked={reaction.includes(r)} onChange={() => toggleReaction(r)} />
                        {r}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">接触対象の投稿（任意）</label>
                  <textarea className="input-base h-14 cs text-xs" placeholder="この接触で言及した投稿本文（任意）" value={targetPost} onChange={e => setTargetPost(e.target.value)} />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">会話ログ（OS②に流す）</label>
                  <textarea className="input-base h-24 cs text-xs" value={convText} onChange={e => setConvText(e.target.value)} placeholder="自動生成されます。編集可" />
                </div>

                <button
                  className="btn-sec w-full justify-center text-xs"
                  onClick={() => {
                    if (!prompts.OS2) { toast.show('プロンプトを読み込み中です'); return }
                    const full = prompts.OS2 + '\n' + convText
                    copyText(full, () => toast.show('OS②プロンプトをコピーしました'))
                  }}
                >
                  <i className="fa-solid fa-copy text-indigo-500" />OS②プロンプトをコピー（外部AIで実行）
                </button>

                <textarea
                  className="input-base h-24 cs text-xs"
                  placeholder="AIの出力を貼り付け"
                  value={resultText}
                  onChange={e => setResultText(e.target.value)}
                />
                <button className="btn-primary w-full justify-center text-sm" style={{ background: '#4f46e5' }} onClick={handleSubmitOS2}>
                  <i className="fa-solid fa-circle-plus" />OS②判定を記録
                </button>
              </div>

              {/* Reply recording */}
              <div className="card p-5 flex flex-col gap-3">
                <p className="font-bold text-sm text-slate-800"><i className="fa-solid fa-reply text-slate-400 mr-1" />相手の返信を記録</p>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">どの送信への返信？</label>
                  <select className="input-base text-xs py-2" value={replyTo} onChange={e => setReplyTo(e.target.value)}>
                    <option value="">選択任意</option>
                    {(selectedItem.sentMessages || []).map((sm, i) => (
                      <option key={sm.id} value={sm.id}>送信{i + 1}（{sm.date}）{sm.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {reactionOptions.map(r => (
                    <label key={r} className={`reaction-check-label ${reaction.includes(r) ? 'checked' : ''}`}>
                      <input type="checkbox" className="hidden" checked={reaction.includes(r)} onChange={() => toggleReaction(r)} />
                      {r}
                    </label>
                  ))}
                </div>
                <textarea className="input-base h-16 cs text-xs" placeholder="返信テキスト（テキスト返信がある場合）" value={replyText} onChange={e => setReplyText(e.target.value)} />
                <button className="btn-sec text-xs py-2 justify-center" onClick={handleAddReply}>
                  <i className="fa-solid fa-plus text-slate-400" />返信を記録
                </button>
              </div>

              {/* Close */}
              <div className="card p-4 flex flex-col gap-3">
                <p className="font-bold text-sm text-slate-800"><i className="fa-solid fa-flag-checkered text-slate-400 mr-1" />クローズ</p>
                <div className="flex gap-2">
                  <select className="input-base text-xs py-2 flex-1" value={closeResult} onChange={e => setCloseResult(e.target.value)}>
                    {['断り', 'フェードアウト', '未読', '未到達クローズ', 'ブロック', '受注'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <button className="btn-danger px-4" onClick={handleClose}>
                    <i className="fa-solid fa-flag-checkered mr-1" />クローズ
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Send modal */}
      {sendModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><i className="fa-solid fa-paper-plane text-violet-500" />送信完了を記録</h3>
              <button className="text-slate-400 hover:text-slate-600 p-1" onClick={() => setSendModalOpen(false)}><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">元の文章（AIが生成）</label>
              <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-200 whitespace-pre-wrap max-h-32 overflow-y-auto cs">{sendOriginal}</p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-700 font-semibold">実際に送った文章 <span className="text-slate-400 font-normal">（変更した場合は修正）</span></label>
              <textarea className="input-base h-24 cs text-xs" placeholder="元の文章のまま送った場合は空白でOK" value={sendActual} onChange={e => setSendActual(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">編集理由 <span className="text-slate-400">（任意）</span></label>
              <textarea className="input-base h-14 cs text-xs" placeholder="例：語調を柔らかくした" value={sendReason} onChange={e => setSendReason(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end mt-1">
              <button className="btn-sec text-xs py-2 px-4" onClick={() => setSendModalOpen(false)}>キャンセル</button>
              <button className="btn-primary text-xs py-2 px-4" onClick={handleRecordSend}><i className="fa-solid fa-check" />送信完了として記録</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
