import { useState, useRef } from 'react'
import type { AppData, Prompts, PipelineItem, Touch, SentMessage } from '../../types'
import type { TouchPostType, TouchValidity, TouchReaction } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS2 } from '../../utils/parser'
import {
  addToExcluded, moveToTrash, buildProfileUrl,
  trackBadgeClass, stepsBarData, urgencyClass, daysSince,
  buildConvLog, uid, todayStr,
} from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'

// ── badge helpers ──────────────────────────────────────────────
function validityBadge(v: string) {
  if (v === '◯') return 'bg-green-100 text-green-700'
  if (v === '△') return 'bg-yellow-100 text-yellow-700'
  if (v === '✕') return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-500'
}
function postTypeBadge(t: string) {
  const m: Record<string, string> = {
    '課題ツイート': 'bg-blue-100 text-blue-700',
    '通常投稿': 'bg-purple-100 text-purple-700',
    '達成・嬉しい報告': 'bg-green-100 text-green-700',
    '愚痴・本音': 'bg-orange-100 text-orange-700',
    'ネタ': 'bg-pink-100 text-pink-700',
    'ストーリー': 'bg-indigo-100 text-indigo-700',
  }
  return m[t] ?? 'bg-gray-100 text-gray-500'
}
function reactionBadge(r: string) {
  const m: Record<string, string> = {
    'テキスト返信': 'bg-green-100 text-green-700',
    'いいね返り': 'bg-blue-100 text-blue-700',
    'フォロー返し': 'bg-purple-100 text-purple-700',
    'スタンプ・絵文字': 'bg-indigo-100 text-indigo-700',
    '無反応': 'bg-gray-100 text-gray-500',
    '公開拒絶（R5）': 'bg-red-100 text-red-700',
  }
  return m[r] ?? 'bg-gray-100 text-gray-400'
}

// ── chip ───────────────────────────────────────────────────────
function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition min-h-[36px] ${
        selected
          ? 'bg-indigo-600 border-indigo-600 text-white'
          : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
      }`}
    >
      {label}
    </button>
  )
}

function StepsBar({ currentStep }: { currentStep: string }) {
  return (
    <div className="s-bar">
      {stepsBarData(currentStep).map((n, i) => (
        <div key={i} className={n.cls} title={n.tip} />
      ))}
    </div>
  )
}

// ── constants ──────────────────────────────────────────────────
const POST_TYPES: TouchPostType[] = ['課題ツイート', '通常投稿', '達成・嬉しい報告', '愚痴・本音', 'ネタ', 'ストーリー', 'その他']
const VALIDITY_OPTS: TouchValidity[] = ['◯', '△', '✕', '未評価']
const REACTION_TYPES: TouchReaction[] = ['テキスト返信', 'いいね返り', 'フォロー返し', 'スタンプ・絵文字', '無反応', '公開拒絶（R5）', '未記録']
const OS2_REACTIONS = ['テキスト返信', 'いいね', 'スタンプ/絵文字', 'リポスト', '無反応', '既読スルー']
const CLOSE_RESULTS = ['断り', 'フェードアウト', '未読', '未到達クローズ', 'ブロック', '受注']

// ── Tab2 ───────────────────────────────────────────────────────
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('all')
  const [filterStep, setFilterStep] = useState('all')
  const [sort, setSort] = useState('newest')

  const active = data.pipeline.filter(p => p.isOpen)
  let filtered = [...active]
  if (filter === 'FT') filtered = filtered.filter(p => p.track === 'FT')
  else if (filter === 'NT') filtered = filtered.filter(p => p.track === 'NT')
  else if (filter === 'warn') filtered = filtered.filter(p => daysSince(p.lastContactDate) >= 7 || daysSince(p.startDate) >= 30)
  if (filterStep !== 'all') filtered = filtered.filter(p => p.currentStep === filterStep)
  if (sort === 'urgent') filtered.sort((a, b) => daysSince(b.lastContactDate) - daysSince(a.lastContactDate))
  else filtered.reverse()

  const warnItems = active.filter(p => daysSince(p.lastContactDate) >= 7 || daysSince(p.startDate) >= 30)

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function expandId(id: string) {
    setExpandedIds(prev => { const next = new Set(prev); next.add(id); return next })
  }

  return (
    <div className="flex flex-col gap-4" style={{ animation: 'fadeIn .2s ease-out' }}>
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-900">
        <span className="font-bold"><i className="fa-solid fa-chart-gantt mr-1" />OS②案件管理：</span>
        各案件のタッチ履歴を記録し、S1→S5の進捗を管理します。
      </div>

      {warnItems.length > 0 && (
        <div className="flex flex-col gap-2">
          {warnItems.map(p => {
            const d30 = daysSince(p.startDate) >= 30
            return (
              <div
                key={p.id}
                className={`border rounded-xl p-3 text-xs flex items-center gap-2 cursor-pointer ${d30 ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
                onClick={() => expandId(p.id)}
              >
                <i className="fa-solid fa-triangle-exclamation" />
                <span className="font-bold">{p.accountName}</span>：
                {d30 ? '30日ルール発動 — 強制クローズまたは再接触' : '7日ルール発動 — 再接触するかクローズ'}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <select className="input-base text-xs py-1.5" style={{ maxWidth: 110 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">全て ({active.length})</option>
          <option value="FT">FT</option>
          <option value="NT">NT</option>
          <option value="warn">警告のみ</option>
        </select>
        <select className="input-base text-xs py-1.5" style={{ maxWidth: 90 }} value={filterStep} onChange={e => setFilterStep(e.target.value)}>
          <option value="all">全ステップ</option>
          {['S1','S2','S3','S4','S5'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input-base text-xs py-1.5" style={{ maxWidth: 100 }} value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">登録順</option>
          <option value="urgent">緊急度順</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-slate-300 gap-2">
          <i className="fa-solid fa-chart-gantt text-4xl" />
          <p className="text-sm font-medium">案件がありません</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(p => (
            <CaseCard
              key={p.id}
              item={p}
              expanded={expandedIds.has(p.id)}
              onToggle={() => toggleExpand(p.id)}
              data={data}
              saveData={saveData}
              prompts={prompts}
              role={role}
              toast={toast}
              confirm={confirm}
              onGoToTab3={onGoToTab3}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── CaseCard ───────────────────────────────────────────────────
interface CardProps {
  item: PipelineItem
  expanded: boolean
  onToggle: () => void
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
  onGoToTab3: () => void
}

function CaseCard({ item, expanded, onToggle, data: _data, saveData, prompts, role, toast, confirm, onGoToTab3 }: CardProps) {
  const [addingTouch, setAddingTouch] = useState(false)
  const [os2Open, setOs2Open] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const addFormRef = useRef<HTMLDivElement>(null)

  // touch add form state
  const [tPostText, setTPostText] = useState('')
  const [tPostType, setTPostType] = useState<TouchPostType>('通常投稿')
  const [tValidity, setTValidity] = useState<TouchValidity>('未評価')
  const [tAiText, setTAiText] = useState('')
  const [tSentText, setTSentText] = useState('')
  const [tEditReason, setTEditReason] = useState('')
  const [tMsgValidity, setTMsgValidity] = useState<TouchValidity>('未評価')
  const [tReaction, setTReaction] = useState<TouchReaction>('未記録')
  const [tReactionNote, setTReactionNote] = useState('')

  // OS② form state
  const [step, setStep] = useState<PipelineItem['currentStep']>(item.currentStep)
  const [repCount, setRepCount] = useState(item.repCount || 0)
  const [dmCount, setDmCount] = useState(item.dmCount || 0)
  const [lastDate, setLastDate] = useState(item.lastContactDate || todayStr())
  const [os2Reaction, setOs2Reaction] = useState<string[]>([])
  const [targetPost, setTargetPost] = useState('')
  const [convText, setConvText] = useState(() => buildConvLog(item))
  const [resultText, setResultText] = useState('')

  // close + send modal
  const [closeResult, setCloseResult] = useState('断り')
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendLabel, setSendLabel] = useState('')
  const [sendOriginal, setSendOriginal] = useState('')
  const [sendActual, setSendActual] = useState('')
  const [sendReason, setSendReason] = useState('')

  const touches = item.touches || []
  const s1Count = touches.length
  const likeReturnCount = touches.filter(t => t.reactionType === 'いいね返り').length
  const followReturned = touches.some(t => t.reactionType === 'フォロー返し')
  const lastTouchedAt = touches.length > 0
    ? touches.reduce((l, t) => t.date > l ? t.date : l, touches[0].date)
    : item.lastContactDate || null

  const days = daysSince(lastTouchedAt || undefined)
  const totalDays = daysSince(item.startDate)

  function startAddTouch() {
    setAddingTouch(true)
    setTimeout(() => addFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  function handleAddTouch() {
    if (!tSentText.trim()) { toast.show('実際に送った文章は必須です', 2000); return }
    const touch: Touch = {
      id: uid(), date: new Date().toISOString(),
      targetPostText: tPostText, targetPostType: tPostType, targetValidity: tValidity,
      aiSuggestedText: tAiText, actualSentText: tSentText, editReason: tEditReason,
      messageValidity: tMsgValidity, reactionType: tReaction, reactionNote: tReactionNote,
    }
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => p.id === item.id
        ? { ...p, touches: [...(p.touches || []), touch], lastContactDate: todayStr() }
        : p
      ),
    }))
    setTPostText(''); setTPostType('通常投稿'); setTValidity('未評価')
    setTAiText(''); setTSentText(''); setTEditReason(''); setTMsgValidity('未評価')
    setTReaction('未記録'); setTReactionNote('')
    setAddingTouch(false)
    toast.show('タッチを記録しました')
  }

  function handleDeleteTouch(touchId: string) {
    confirm.show('削除確認', 'このタッチ記録を削除しますか？', () => {
      saveData(prev => ({
        ...prev,
        pipeline: prev.pipeline.map(p => p.id === item.id
          ? { ...p, touches: (p.touches || []).filter(t => t.id !== touchId) }
          : p
        ),
      }))
      toast.show('タッチを削除しました')
    })
  }

  function handleSubmitOS2() {
    const text = resultText.trim()
    if (!text) { toast.show('AIの出力を貼り付けてください', 2000); return }
    const parsed = parseOS2(text)
    const reactionStr = os2Reaction.join('＋')
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => {
        if (p.id !== item.id) return p
        const newEntry = {
          date: lastDate || todayStr(), reaction: reactionStr,
          step: step, repCount: Number(repCount), dmCount: Number(dmCount),
          targetPost: targetPost || '',
          judgment: parsed.judgment || '', nextAction: parsed.nextAction || '',
          deadline: parsed.deadline || '', redSignal: parsed.redSignal || '',
          responseQuality: parsed.responseQuality || '', hypothesisCheck: parsed.hypothesisCheck || '',
          ngAction: parsed.ngAction || '', replyA: parsed.replyA || '', replyB: parsed.replyB || '',
        }
        return {
          ...p,
          currentStep: (parsed.step || step) as PipelineItem['currentStep'],
          repCount: Number(repCount), dmCount: Number(dmCount),
          lastContactDate: lastDate || todayStr(),
          judgment: parsed.judgment || null, nextAction: parsed.nextAction || null,
          deadline: parsed.deadline || null, replyA: parsed.replyA || null,
          replyB: parsed.replyB || null, ngAction: parsed.ngAction || null,
          redSignal: parsed.redSignal || null, responseQuality: parsed.responseQuality || null,
          history: [...(p.history || []), newEntry],
          analyses: [...(p.analyses || []), { date: lastDate || todayStr(), aiInput: text, aiOutput: text, judgment: parsed.judgment || '' }],
        }
      }),
    }))
    setResultText(''); setOs2Reaction([])
    toast.show('OS②分析を記録しました')
  }

  function handleDelete() {
    confirm.show('削除確認', `「${item.accountName}」をパイプラインから削除しますか？`, () => {
      saveData(prev => {
        const d = { ...prev, pipeline: prev.pipeline.filter(p => p.id !== item.id), excluded: [...(prev.excluded || [])], trash: [...(prev.trash || [])] }
        addToExcluded(d, item.url || item.accountName, item.accountName, item.channel, 'パイプライン削除')
        moveToTrash(d, item as unknown as Record<string, unknown>, 'OS②')
        if (item.targetId) {
          d.targets = d.targets.map(t => t.id === item.targetId ? { ...t, pipelineId: null } : t)
        }
        return d
      })
      toast.show(`「${item.accountName}」を削除しました`)
    })
  }

  function handleClose() {
    confirm.show('クローズ確認', `「${item.accountName}」をクローズしますか？（${closeResult}）`, () => {
      const closeDate = todayStr()
      saveData(prev => {
        const d = { ...prev, pipeline: prev.pipeline.map(p => p.id === item.id ? { ...p, isOpen: false, closedAt: closeDate } : p) }
        const pFinal = d.pipeline.find(p => p.id === item.id)!
        d.closed = [...d.closed, {
          id: uid(), pipelineId: item.id, createdAt: new Date().toISOString(),
          accountName: pFinal.accountName, track: pFinal.track,
          hypothesis: pFinal.hypothesis, startDate: pFinal.startDate,
          closeDate, result: closeResult, ruleFired: false,
        }]
        return d
      })
      toast.show(`「${item.accountName}」をクローズしました（${closeResult}）`)
      setTimeout(() => onGoToTab3(), 500)
    })
  }

  function openSendModal(label: string, text: string) {
    setSendLabel(label); setSendOriginal(text); setSendActual(''); setSendReason(''); setSendModalOpen(true)
  }

  function handleRecordSend() {
    const actual = sendActual.trim() || sendOriginal
    const msg: SentMessage = {
      id: uid(), label: sendLabel, original: sendOriginal, actual,
      edited: !!sendActual.trim() && sendActual.trim() !== sendOriginal,
      reason: sendReason, date: todayStr(),
    }
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => {
        if (p.id !== item.id) return p
        const updated = { ...p, sentMessages: [...(p.sentMessages || []), msg] }
        if (p.currentStep === 'S1') {
          updated.currentStep = 'S2'
          updated.stepHistory = [...(updated.stepHistory || []), { step: 'S2' as const, date: todayStr() }]
        }
        return updated
      }),
    }))
    toast.show(`${sendLabel} を送信完了として記録しました`)
    setSendModalOpen(false)
  }

  const profileUrl = buildProfileUrl(item.url, item.channel)
  const lastTouchedDisplay = lastTouchedAt
    ? new Date(lastTouchedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '/')
    : null

  return (
    <>
      <div className="card overflow-hidden">
        {/* ── collapsed header ─────────────────── */}
        <div
          className="p-4 cursor-pointer select-none active:bg-slate-50"
          onClick={onToggle}
        >
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${trackBadgeClass(item.track)}`}>{item.track}</span>
            <p className="font-semibold text-sm text-slate-800 flex-1 min-w-0 truncate">{item.accountName}</p>
            <span className="text-xs font-bold text-indigo-600 shrink-0">{item.currentStep}</span>
            {totalDays >= 30 && (
              <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded shrink-0">30日超</span>
            )}
            {totalDays < 30 && days >= 7 && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded shrink-0">7日超</span>
            )}
            <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-slate-300 text-xs shrink-0`} />
          </div>
          {item.hypothesis && (
            <p className="text-xs text-slate-500 mt-1 truncate">{item.hypothesis}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
            {lastTouchedDisplay
              ? <span>最終タッチ：{lastTouchedDisplay}</span>
              : <span className="text-slate-300">タッチなし</span>
            }
            <span>計{s1Count}回</span>
            {likeReturnCount > 0 && <span className="text-blue-500">♡{likeReturnCount}</span>}
            {followReturned && <span className="text-purple-500 font-medium">フォロー返し✓</span>}
          </div>
        </div>

        {/* ── expanded ─────────────────────────── */}
        {expanded && (
          <div className="border-t border-slate-100">
            {/* step bar + actions */}
            <div className="px-4 py-2.5 flex items-center gap-2 bg-slate-50 border-b border-slate-100">
              <StepsBar currentStep={item.currentStep} />
              <div className="ml-auto flex items-center gap-1 shrink-0">
                {profileUrl && (
                  <a href={profileUrl} target="_blank" rel="noreferrer" className="btn-sec text-[11px] py-1 px-2">
                    <i className="fa-solid fa-arrow-up-right-from-square" />
                  </a>
                )}
                {role === 'admin' && (
                  <button className="btn-danger text-[11px] py-1 px-2" onClick={handleDelete}>
                    <i className="fa-solid fa-trash" />
                  </button>
                )}
              </div>
            </div>

            {/* latest OS② judgment */}
            {(item.judgment || item.nextAction || item.replyA || item.replyB) && (
              <div className="mx-4 mt-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex flex-col gap-1.5 text-xs">
                <p className="font-bold text-indigo-700 text-[10px] uppercase tracking-wide">最新OS②判定</p>
                {item.judgment && (
                  <p className={`font-bold ${item.judgment === '前進' ? 'text-violet-700' : item.judgment === 'クローズ' ? 'text-rose-600' : 'text-amber-600'}`}>{item.judgment}</p>
                )}
                {item.nextAction && <div className="flex gap-2"><span className="text-slate-400 shrink-0">次アクション</span><span className="text-slate-700 font-semibold">{item.nextAction}</span></div>}
                {item.deadline && <div className="flex gap-2"><span className="text-slate-400 shrink-0">期限</span><span className="text-amber-600 font-semibold">{item.deadline}</span></div>}
                {item.redSignal && item.redSignal !== '無' && <p className="text-rose-600 font-medium">🚨 {item.redSignal}</p>}
                {item.ngAction && <div className="flex gap-2"><span className="text-slate-400 shrink-0">NGアクション</span><span className="text-rose-600">{item.ngAction}</span></div>}
                {item.replyA && (
                  <div className="flex items-start gap-1 mt-1">
                    <span className="text-violet-600 font-bold shrink-0 text-[11px]">案A</span>
                    <p className="text-violet-700 flex-1 text-[11px] leading-relaxed">{item.replyA}</p>
                    <button className="shrink-0 btn-sec text-[10px] py-0.5 px-1.5" onClick={() => openSendModal('案A（前進案）', item.replyA!)}>送信完了</button>
                  </div>
                )}
                {item.replyB && (
                  <div className="flex items-start gap-1">
                    <span className="text-indigo-500 font-bold shrink-0 text-[11px]">案B</span>
                    <p className="text-indigo-600 flex-1 text-[11px] leading-relaxed">{item.replyB}</p>
                    <button className="shrink-0 btn-sec text-[10px] py-0.5 px-1.5" onClick={() => openSendModal('案B（安全案）', item.replyB!)}>送信完了</button>
                  </div>
                )}
              </div>
            )}

            {/* ── touch history ─────────────────── */}
            <div className="p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-3">タッチ履歴</p>
              {touches.length === 0 ? (
                <p className="text-xs text-slate-300 text-center py-6">タッチ履歴がありません</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {[...touches].reverse().map(touch => (
                    <TouchItem key={touch.id} touch={touch} role={role} onDelete={() => handleDeleteTouch(touch.id)} />
                  ))}
                </div>
              )}
            </div>

            {/* ── add touch ─────────────────────── */}
            {!addingTouch ? (
              <div className="px-4 pb-4">
                <button
                  className="w-full py-3 text-sm font-semibold text-indigo-600 border-2 border-dashed border-indigo-200 rounded-xl hover:bg-indigo-50 transition min-h-[44px]"
                  onClick={startAddTouch}
                >
                  <i className="fa-solid fa-plus mr-1" />タッチを追加
                </button>
              </div>
            ) : (
              <div ref={addFormRef} className="mx-4 mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-3">
                <p className="font-bold text-sm text-slate-800">タッチを追加</p>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">接触した投稿（相手の文）</label>
                  <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="相手の投稿を引用または要約" value={tPostText} onChange={e => setTPostText(e.target.value)} />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">投稿種別</label>
                  <div className="flex flex-wrap gap-1.5">
                    {POST_TYPES.map(t => <Chip key={t} label={t} selected={tPostType === t} onClick={() => setTPostType(t)} />)}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">対象妥当性</label>
                  <div className="flex flex-wrap gap-1.5">
                    {VALIDITY_OPTS.map(v => <Chip key={v} label={v} selected={tValidity === v} onClick={() => setTValidity(v)} />)}
                  </div>
                  <p className="text-[10px] text-slate-400">◯=課題/通常/達成　△=グレー　✕=愚痴/ネタへの営業</p>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">AIの提案文（任意）</label>
                  <textarea rows={3} className="input-base cs text-xs resize-y" placeholder="AIが提案した文章" value={tAiText} onChange={e => setTAiText(e.target.value)} />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-700">実際に送った文章 <span className="text-rose-500">*</span></label>
                  <textarea rows={3} className="input-base cs text-xs resize-y" placeholder="実際に送ったコメント・DM文" value={tSentText} onChange={e => setTSentText(e.target.value)} />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">変えた理由（任意）</label>
                  <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="AIの提案から変更した理由" value={tEditReason} onChange={e => setTEditReason(e.target.value)} />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">文面妥当性</label>
                  <div className="flex flex-wrap gap-1.5">
                    {VALIDITY_OPTS.map(v => <Chip key={v} label={v} selected={tMsgValidity === v} onClick={() => setTMsgValidity(v)} />)}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">相手の反応</label>
                  <div className="flex flex-wrap gap-1.5">
                    {REACTION_TYPES.map(r => <Chip key={r} label={r} selected={tReaction === r} onClick={() => setTReaction(r)} />)}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">反応の補足（任意）</label>
                  <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="相手のテキスト返信内容など" value={tReactionNote} onChange={e => setTReactionNote(e.target.value)} />
                </div>

                <div className="flex gap-2 mt-1">
                  <button className="btn-sec text-xs py-2.5 px-4 flex-1" onClick={() => setAddingTouch(false)}>キャンセル</button>
                  <button className="btn-primary text-xs py-2.5 px-4 flex-1 justify-center" style={{ background: '#4f46e5' }} onClick={handleAddTouch}>
                    <i className="fa-solid fa-check" />記録する
                  </button>
                </div>
              </div>
            )}

            {/* ── OS② section ───────────────────── */}
            <div className="border-t border-slate-100">
              <button
                className="w-full px-4 py-3 text-xs text-slate-600 font-semibold flex items-center gap-2 hover:bg-slate-50 transition min-h-[44px]"
                onClick={() => setOs2Open(v => !v)}
              >
                <i className="fa-solid fa-robot text-indigo-400" />OS②行動判定
                <i className={`fa-solid fa-chevron-${os2Open ? 'up' : 'down'} text-slate-400 ml-auto text-[10px]`} />
              </button>
              {os2Open && (
                <div className="px-4 pb-4 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-400">ステップ</label>
                      <select className="input-base text-xs py-2" value={step} onChange={e => setStep(e.target.value as PipelineItem['currentStep'])}>
                        {['S1','S2','S3','S4','S5'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-400">接触日</label>
                      <input type="date" className="input-base text-xs py-2" value={lastDate} onChange={e => setLastDate(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-400">リプ往復数</label>
                      <input type="number" className="input-base text-xs py-2" value={repCount} min={0} onChange={e => setRepCount(Number(e.target.value))} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-400">DM往復数</label>
                      <input type="number" className="input-base text-xs py-2" value={dmCount} min={0} onChange={e => setDmCount(Number(e.target.value))} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">相手の反応</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {OS2_REACTIONS.map(r => (
                        <label key={r} className={`reaction-check-label ${os2Reaction.includes(r) ? 'checked' : ''}`}>
                          <input type="checkbox" className="hidden" checked={os2Reaction.includes(r)} onChange={() => setOs2Reaction(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])} />
                          {r}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">接触対象の投稿（任意）</label>
                    <textarea rows={2} className="input-base cs text-xs" value={targetPost} onChange={e => setTargetPost(e.target.value)} />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">会話ログ（OS②に流す）</label>
                    <textarea rows={4} className="input-base cs text-xs" value={convText} onChange={e => setConvText(e.target.value)} placeholder="自動生成されます。編集可" />
                  </div>

                  <button
                    className="btn-sec w-full justify-center text-xs"
                    onClick={() => {
                      if (!prompts.OS2) { toast.show('プロンプトを読み込み中です'); return }
                      copyText(prompts.OS2 + '\n' + convText, () => toast.show('OS②プロンプトをコピーしました'))
                    }}
                  >
                    <i className="fa-solid fa-copy text-indigo-500" />OS②プロンプトをコピー（外部AIで実行）
                  </button>

                  <textarea rows={4} className="input-base cs text-xs" placeholder="AIの出力を貼り付け" value={resultText} onChange={e => setResultText(e.target.value)} />
                  <button className="btn-primary w-full justify-center text-sm" style={{ background: '#4f46e5' }} onClick={handleSubmitOS2}>
                    <i className="fa-solid fa-circle-plus" />OS②判定を記録
                  </button>
                </div>
              )}
            </div>

            {/* ── close section ─────────────────── */}
            <div className="border-t border-slate-100">
              <button
                className="w-full px-4 py-3 text-xs text-slate-600 font-semibold flex items-center gap-2 hover:bg-slate-50 transition min-h-[44px]"
                onClick={() => setCloseOpen(v => !v)}
              >
                <i className="fa-solid fa-flag-checkered text-slate-400" />クローズ
                <i className={`fa-solid fa-chevron-${closeOpen ? 'up' : 'down'} text-slate-400 ml-auto text-[10px]`} />
              </button>
              {closeOpen && (
                <div className="px-4 pb-4 flex gap-2">
                  <select className="input-base text-xs py-2 flex-1" value={closeResult} onChange={e => setCloseResult(e.target.value)}>
                    {CLOSE_RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button className="btn-danger text-xs px-4 min-h-[44px]" onClick={handleClose}>
                    <i className="fa-solid fa-flag-checkered mr-1" />クローズ
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* send modal */}
      {sendModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <i className="fa-solid fa-paper-plane text-violet-500" />送信完了を記録
              </h3>
              <button className="text-slate-400 hover:text-slate-600 p-1 min-h-[36px] min-w-[36px]" onClick={() => setSendModalOpen(false)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">元の文章（AIが生成）</label>
              <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-200 whitespace-pre-wrap max-h-32 overflow-y-auto cs">{sendOriginal}</p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-700 font-semibold">実際に送った文章 <span className="text-slate-400 font-normal">（変更した場合は修正）</span></label>
              <textarea rows={4} className="input-base cs text-xs" placeholder="元の文章のまま送った場合は空白でOK" value={sendActual} onChange={e => setSendActual(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">編集理由（任意）</label>
              <textarea rows={2} className="input-base cs text-xs" value={sendReason} onChange={e => setSendReason(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end mt-1">
              <button className="btn-sec text-xs py-2.5 px-4" onClick={() => setSendModalOpen(false)}>キャンセル</button>
              <button className="btn-primary text-xs py-2.5 px-4" onClick={handleRecordSend}><i className="fa-solid fa-check" />送信完了として記録</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── TouchItem ──────────────────────────────────────────────────
function TouchItem({ touch, role, onDelete }: { touch: Touch; role: Role; onDelete: () => void }) {
  const [detailOpen, setDetailOpen] = useState(false)
  const dateStr = new Date(touch.date).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '/')

  return (
    <div className="bg-white border border-slate-100 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-slate-400 shrink-0">{dateStr}</span>
        {touch.targetPostType && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${postTypeBadge(touch.targetPostType)}`}>{touch.targetPostType}</span>
        )}
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${validityBadge(touch.targetValidity)}`}>対象{touch.targetValidity}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${reactionBadge(touch.reactionType)}`}>{touch.reactionType}</span>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            className="text-[10px] text-slate-400 hover:text-indigo-500 px-1.5 py-0.5 rounded transition"
            onClick={() => setDetailOpen(v => !v)}
          >
            詳細{detailOpen ? '▲' : '▼'}
          </button>
          {role === 'admin' && (
            <button
              className="text-slate-300 hover:text-rose-500 p-1 rounded transition min-h-[28px] min-w-[28px] flex items-center justify-center"
              onClick={onDelete}
            >
              <i className="fa-solid fa-trash text-[10px]" />
            </button>
          )}
        </div>
      </div>

      {touch.targetPostText && (
        <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">📝 {touch.targetPostText}</p>
      )}
      <p className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-3 leading-relaxed">{touch.actualSentText}</p>
      {touch.reactionNote && (
        <p className="text-[11px] text-slate-500 leading-relaxed">💬 {touch.reactionNote}</p>
      )}

      {detailOpen && (
        <div className="mt-1 p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex flex-col gap-2 text-xs">
          {touch.aiSuggestedText && (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">AI提案文</p>
              <p className="text-slate-600 whitespace-pre-wrap">{touch.aiSuggestedText}</p>
            </div>
          )}
          {touch.editReason && (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">変えた理由</p>
              <p className="text-slate-600">{touch.editReason}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-[10px]">文面妥当性</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${validityBadge(touch.messageValidity)}`}>{touch.messageValidity}</span>
          </div>
        </div>
      )}
    </div>
  )
}
