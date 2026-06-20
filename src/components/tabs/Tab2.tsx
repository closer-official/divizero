import { useState, useRef } from 'react'
import type { AppData, Prompts, PipelineItem, Touch } from '../../types'
import type { TouchPostType, TouchValidity, TouchReaction } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS2 } from '../../utils/parser'
import { buildTouchPrompt, parseTouchOutput } from '../../utils/touchPrompt'
import {
  addToExcluded, moveToTrash, buildProfileUrl,
  trackBadgeClass, stepsBarData, urgencyClass, daysSince,
  uid, todayStr,
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
    '未記録': 'bg-gray-100 text-gray-400',
  }
  return m[r] ?? 'bg-gray-100 text-gray-400'
}
function judgmentColor(j: string) {
  if (j === '前進' || j.startsWith('前進')) return 'text-violet-700'
  if (j === 'クローズ') return 'text-rose-600'
  if (j === '休眠') return 'text-slate-500'
  return 'text-amber-600'
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
const REACTION_TYPES: TouchReaction[] = ['テキスト返信', 'いいね返り', 'フォロー返し', 'スタンプ・絵文字', '無反応', '公開拒絶（R5）']
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
        タッチを追加→反応を記録→S1ループ管理。テキスト返信のみOS②判定を実行。
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
  const [closeOpen, setCloseOpen] = useState(false)
  const addFormRef = useRef<HTMLDivElement>(null)

  // AI generation
  const [aiOutput, setAiOutput] = useState('')
  const [suggestionA, setSuggestionA] = useState('')
  const [suggestionB, setSuggestionB] = useState('')
  const [copyBtnState, setCopyBtnState] = useState<'idle' | 'copied'>('idle')
  const [autoFillError, setAutoFillError] = useState<string | null>(null)
  const [autoFillWarning, setAutoFillWarning] = useState<string | null>(null)

  // touch add form
  const [tPostText, setTPostText] = useState('')
  const [tPostType, setTPostType] = useState<TouchPostType>('通常投稿')
  const [tValidity, setTValidity] = useState<TouchValidity>('未評価')
  const [tAiText, setTAiText] = useState('')
  const [tSentText, setTSentText] = useState('')
  const [tEditReason, setTEditReason] = useState('')
  const [tMsgValidity, setTMsgValidity] = useState<TouchValidity>('未評価')

  // close
  const [closeResult, setCloseResult] = useState('断り')

  const touches = item.touches || []
  const s1Count = touches.length
  const likeReturnCount = touches.filter(t => t.reactionType === 'いいね返り').length
  const followReturned = touches.some(t => t.reactionType === 'フォロー返し')
  const lastTouchedAt = touches.length > 0
    ? touches.reduce((l, t) => t.date > l ? t.date : l, touches[0].date)
    : item.lastContactDate || null
  const days = daysSince(lastTouchedAt || undefined)
  const totalDays = daysSince(item.startDate)

  // judgment from latest OS② touch or fallback to pipeline item
  const latestOs2Touch = [...touches].reverse().find(t => t.os2Judgment)
  const displayJudgment = latestOs2Touch?.os2Judgment || item.judgment
  const displayNextAction = latestOs2Touch?.os2NextAction || item.nextAction
  const displayReplyA = latestOs2Touch?.os2ReplyA || item.replyA
  const displayReplyB = latestOs2Touch?.os2ReplyB || item.replyB

  function startAddTouch() {
    setAddingTouch(true)
    setTimeout(() => addFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  async function handleCopyPrompt() {
    setAutoFillError(null)
    try {
      const prompt = await buildTouchPrompt(item, touches)
      await navigator.clipboard.writeText(prompt)
      setCopyBtnState('copied')
      setTimeout(() => setCopyBtnState('idle'), 2000)
    } catch {
      setAutoFillError('プロンプトのコピーに失敗しました。')
    }
  }

  function handleAutoFill() {
    setAutoFillError(null)
    setAutoFillWarning(null)
    const parsed = parseTouchOutput(aiOutput)
    if (!parsed) {
      setAutoFillError('AI出力の形式が認識できませんでした。===TOUCH_START=== から ===TOUCH_END=== までを含めて貼り付けてください。')
      return
    }
    setTPostText(parsed.targetPostText)
    setTPostType(parsed.targetPostType as TouchPostType)
    setTValidity(parsed.targetValidity as TouchValidity)
    setTAiText(`A: ${parsed.suggestedTextA}\nB: ${parsed.suggestedTextB}`)
    setSuggestionA(parsed.suggestedTextA)
    setSuggestionB(parsed.suggestedTextB)
    if (parsed.gateJudgment.includes('✕') || parsed.gateJudgment.includes('対象切替')) {
      setAutoFillWarning('⚠️ ゲート判定「対象外」。営業意図での接触は見送り、別投稿を待つことを推奨します。')
    }
  }

  function handleAddTouch() {
    if (!tSentText.trim()) { toast.show('実際に送った文章は必須です', 2000); return }
    const touch: Touch = {
      id: uid(), date: new Date().toISOString(),
      targetPostText: tPostText, targetPostType: tPostType, targetValidity: tValidity,
      aiSuggestedText: tAiText, actualSentText: tSentText, editReason: tEditReason,
      messageValidity: tMsgValidity,
      status: 'awaiting_reaction',
      reactionType: '未記録',
      reactionNote: '',
    }
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => p.id === item.id
        ? { ...p, touches: [...(p.touches || []), touch], lastContactDate: todayStr() }
        : p
      ),
    }))
    setAiOutput(''); setSuggestionA(''); setSuggestionB('')
    setTPostText(''); setTPostType('通常投稿'); setTValidity('未評価')
    setTAiText(''); setTSentText(''); setTEditReason(''); setTMsgValidity('未評価')
    setAddingTouch(false)
    toast.show('タッチを記録しました（反応待ち）')
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

  function handleReactionSaved(
    touchId: string,
    touchUpdates: Partial<Touch>,
    pipelineUpdates: Partial<PipelineItem>
  ) {
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => {
        if (p.id !== item.id) return p
        return {
          ...p,
          ...pipelineUpdates,
          lastContactDate: todayStr(),
          touches: (p.touches || []).map(t => t.id === touchId ? { ...t, ...touchUpdates } : t),
        }
      }),
    }))
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

  const profileUrl = buildProfileUrl(item.url, item.channel)
  const lastTouchedDisplay = lastTouchedAt
    ? new Date(lastTouchedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '/')
    : null

  return (
    <div className="card overflow-hidden">
      {/* ── collapsed header ─────────────────── */}
      <div className="p-4 cursor-pointer select-none active:bg-slate-50" onClick={onToggle}>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${trackBadgeClass(item.track)}`}>{item.track}</span>
          <p className="font-semibold text-sm text-slate-800 flex-1 min-w-0 truncate">{item.accountName}</p>
          <span className="text-xs font-bold text-indigo-600 shrink-0">{item.currentStep}</span>
          {totalDays >= 30 && <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded shrink-0">30日超</span>}
          {totalDays < 30 && days >= 7 && <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded shrink-0">7日超</span>}
          <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-slate-300 text-xs shrink-0`} />
        </div>
        {item.hypothesis && <p className="text-xs text-slate-500 mt-1 truncate">{item.hypothesis}</p>}
        <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
          {lastTouchedDisplay ? <span>最終タッチ：{lastTouchedDisplay}</span> : <span className="text-slate-300">タッチなし</span>}
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
          {(displayJudgment || displayNextAction || displayReplyA || displayReplyB) && (
            <div className="mx-4 mt-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex flex-col gap-1.5 text-xs">
              <p className="font-bold text-indigo-700 text-[10px] uppercase tracking-wide">最新OS②判定</p>
              {displayJudgment && <p className={`font-bold ${judgmentColor(displayJudgment)}`}>{displayJudgment}</p>}
              {displayNextAction && <div className="flex gap-2"><span className="text-slate-400 shrink-0">次アクション</span><span className="text-slate-700 font-semibold">{displayNextAction}</span></div>}
              {item.deadline && <div className="flex gap-2"><span className="text-slate-400 shrink-0">期限</span><span className="text-amber-600 font-semibold">{item.deadline}</span></div>}
              {item.redSignal && item.redSignal !== '無' && <p className="text-rose-600 font-medium">🚨 {item.redSignal}</p>}
              {displayReplyA && (
                <div className="flex items-start gap-1 mt-1">
                  <span className="text-violet-600 font-bold shrink-0 text-[11px]">案A</span>
                  <p className="text-violet-700 flex-1 text-[11px] leading-relaxed">{displayReplyA}</p>
                  <button className="shrink-0 btn-sec text-[10px] py-0.5 px-1.5" onClick={() => copyText(displayReplyA, () => toast.show('案Aをコピーしました'))}>
                    <i className="fa-regular fa-copy" />
                  </button>
                </div>
              )}
              {displayReplyB && (
                <div className="flex items-start gap-1">
                  <span className="text-indigo-500 font-bold shrink-0 text-[11px]">案B</span>
                  <p className="text-indigo-600 flex-1 text-[11px] leading-relaxed">{displayReplyB}</p>
                  <button className="shrink-0 btn-sec text-[10px] py-0.5 px-1.5" onClick={() => copyText(displayReplyB, () => toast.show('案Bをコピーしました'))}>
                    <i className="fa-regular fa-copy" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* touch history */}
          <div className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-3">タッチ履歴</p>
            {touches.length === 0 ? (
              <p className="text-xs text-slate-300 text-center py-6">タッチ履歴がありません</p>
            ) : (
              <div className="flex flex-col gap-2">
                {[...touches].reverse().map(touch => (
                  <TouchItem
                    key={touch.id}
                    touch={touch}
                    pipelineItem={item}
                    prompts={prompts}
                    role={role}
                    onDelete={() => handleDeleteTouch(touch.id)}
                    onReactionSaved={handleReactionSaved}
                    onGoToTab3={onGoToTab3}
                  />
                ))}
              </div>
            )}
          </div>

          {/* add touch */}
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
            <div ref={addFormRef} className="mx-4 mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-4">
              <p className="font-bold text-sm text-slate-800">タッチを追加</p>

              {/* ① AI generation section */}
              <div className="bg-white border border-indigo-100 rounded-xl p-3 flex flex-col gap-2">
                <p className="text-xs font-bold text-indigo-700">① AIで生成</p>
                <button
                  className={`btn-sec text-xs py-2 justify-center ${copyBtnState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                  onClick={handleCopyPrompt}
                >
                  <i className={`fa-solid ${copyBtnState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
                  {copyBtnState === 'copied' ? '✓ コピーしました' : 'プロンプトをコピー'}
                </button>
                <p className="text-[10px] text-slate-400 text-center">↓ ChatGPT等に貼り付け＋投稿スクショを添付して実行</p>

                <p className="text-xs font-bold text-indigo-700 mt-1">② AI出力を貼り付け</p>
                <textarea
                  rows={3}
                  className="input-base cs text-xs resize-y"
                  placeholder="AIの出力をここに貼り付け（===TOUCH_START=== から ===TOUCH_END=== まで）"
                  value={aiOutput}
                  onChange={e => { setAiOutput(e.target.value); setAutoFillError(null); setAutoFillWarning(null) }}
                />
                <button className="btn-primary text-xs py-2 justify-center" style={{ background: '#4f46e5' }} onClick={handleAutoFill}>
                  <i className="fa-solid fa-bolt mr-1" />自動入力
                </button>
                {autoFillError && (
                  <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{autoFillError}</p>
                )}
                {autoFillWarning && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">{autoFillWarning}</p>
                )}
              </div>

              {/* suggestion A/B (shown after auto-fill) */}
              {(suggestionA || suggestionB) && (
                <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 flex flex-col gap-2">
                  <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wide">AI提案（タップで送信文にコピー）</p>
                  {suggestionA && (
                    <div className="flex items-start gap-2">
                      <span className="text-violet-600 font-bold text-xs shrink-0">A</span>
                      <p className="text-violet-700 text-xs flex-1 leading-relaxed">{suggestionA}</p>
                      <button
                        className="shrink-0 btn-sec text-[10px] py-1 px-2"
                        onClick={() => setTSentText(suggestionA)}
                      >使う</button>
                    </div>
                  )}
                  {suggestionB && (
                    <div className="flex items-start gap-2">
                      <span className="text-indigo-500 font-bold text-xs shrink-0">B</span>
                      <p className="text-indigo-600 text-xs flex-1 leading-relaxed">{suggestionB}</p>
                      <button
                        className="shrink-0 btn-sec text-[10px] py-1 px-2"
                        onClick={() => setTSentText(suggestionB)}
                      >使う</button>
                    </div>
                  )}
                </div>
              )}

              <div className="h-px bg-slate-200" />

              {/* form fields */}
              <div className="flex flex-col gap-3">
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
              </div>

              <div className="flex gap-2 mt-1">
                <button className="btn-sec text-xs py-2.5 px-4 flex-1" onClick={() => { setAddingTouch(false); setSuggestionA(''); setSuggestionB(''); setAiOutput('') }}>キャンセル</button>
                <button className="btn-primary text-xs py-2.5 px-4 flex-1 justify-center" style={{ background: '#4f46e5' }} onClick={handleAddTouch}>
                  <i className="fa-solid fa-paper-plane" />送信完了として記録
                </button>
              </div>
            </div>
          )}

          {/* close section */}
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
  )
}

// ── TouchItem ──────────────────────────────────────────────────
interface TouchItemProps {
  touch: Touch
  pipelineItem: PipelineItem
  prompts: Prompts
  role: Role
  onDelete: () => void
  onReactionSaved: (touchId: string, touchUpdates: Partial<Touch>, pipelineUpdates: Partial<PipelineItem>) => void
  onGoToTab3: () => void
}

function TouchItem({ touch, pipelineItem, prompts, role, onDelete, onReactionSaved, onGoToTab3 }: TouchItemProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [recordingReaction, setRecordingReaction] = useState(false)
  const [selectedReaction, setSelectedReaction] = useState<TouchReaction | null>(null)
  const [reactionNote, setReactionNote] = useState('')
  const [os2ConvLog, setOs2ConvLog] = useState('')
  const [os2Output, setOs2Output] = useState('')
  const [os2Parsed, setOs2Parsed] = useState<{ judgment: string; nextAction: string; replyA: string; replyB: string } | null>(null)
  const [os2CopyState, setOs2CopyState] = useState<'idle' | 'copied'>('idle')

  const isAwaiting = touch.status === 'awaiting_reaction'

  // S1-L streak after this reaction
  const newLikeStreak = (pipelineItem.likeReturnStreak || 0) + 1
  const newNoReactionStreak = (pipelineItem.noReactionStreak || 0) + 1
  const touchesWithFollow = (pipelineItem.touches || []).some(t => t.reactionType === 'フォロー返し') || selectedReaction === 'フォロー返し'

  function s1CapJudgment(): string {
    if (newLikeStreak < 3) return `前進（新規投稿待ち → 別の具体点でS1再生成）`
    if (touchesWithFollow) return `前進（チャネル格上げ）`
    return `休眠`
  }
  function noReactionJudgment(): string {
    if (newNoReactionStreak === 1) return `維持（次の新規投稿を待つ）`
    return `休眠（無反応${newNoReactionStreak}連続。追いS1はしない）`
  }

  function handleStartReaction() {
    setRecordingReaction(true)
    // pre-fill conv log for テキスト返信
    setOs2ConvLog(`自分の送信（${touch.date.slice(0, 10)}）：\n${touch.actualSentText}\n\n相手の返信：\n`)
  }

  function handleCopyOs2Prompt() {
    if (!prompts.OS2) return
    copyText(prompts.OS2 + '\n' + os2ConvLog, () => {
      setOs2CopyState('copied')
      setTimeout(() => setOs2CopyState('idle'), 2000)
    })
  }

  function handleParseOs2() {
    const parsed = parseOS2(os2Output)
    setOs2Parsed({
      judgment: parsed.judgment || '',
      nextAction: parsed.nextAction || '',
      replyA: parsed.replyA || '',
      replyB: parsed.replyB || '',
    })
  }

  function handleSaveReaction() {
    if (!selectedReaction) return

    const touchUpdates: Partial<Touch> = {
      status: 'reacted',
      reactionType: selectedReaction,
      reactionNote,
    }
    const pipelineUpdates: Partial<PipelineItem> = {}

    if (selectedReaction === 'テキスト返信') {
      if (os2Parsed) {
        touchUpdates.os2ConversationLog = os2ConvLog
        touchUpdates.os2Judgment = os2Parsed.judgment
        touchUpdates.os2NextAction = os2Parsed.nextAction
        touchUpdates.os2ReplyA = os2Parsed.replyA
        touchUpdates.os2ReplyB = os2Parsed.replyB
        pipelineUpdates.judgment = os2Parsed.judgment || null
        pipelineUpdates.nextAction = os2Parsed.nextAction || null
        pipelineUpdates.replyA = os2Parsed.replyA || null
        pipelineUpdates.replyB = os2Parsed.replyB || null
      }
      pipelineUpdates.likeReturnStreak = 0
      pipelineUpdates.noReactionStreak = 0
    } else if (['いいね返り', 'フォロー返し', 'スタンプ・絵文字'].includes(selectedReaction)) {
      const judgment = s1CapJudgment()
      touchUpdates.os2Judgment = judgment
      pipelineUpdates.likeReturnStreak = newLikeStreak
      pipelineUpdates.noReactionStreak = 0
    } else if (selectedReaction === '無反応') {
      const judgment = noReactionJudgment()
      touchUpdates.os2Judgment = judgment
      pipelineUpdates.noReactionStreak = newNoReactionStreak
      pipelineUpdates.likeReturnStreak = 0
    } else if (selectedReaction === '公開拒絶（R5）') {
      touchUpdates.os2Judgment = 'クローズ'
      pipelineUpdates.judgment = 'クローズ'
    }

    onReactionSaved(touch.id, touchUpdates, pipelineUpdates)
    setRecordingReaction(false)
    setSelectedReaction(null)
    setReactionNote('')
    setOs2ConvLog('')
    setOs2Output('')
    setOs2Parsed(null)
  }

  const dateStr = new Date(touch.date).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '/')
  const isMicroPositive = ['いいね返り', 'フォロー返し', 'スタンプ・絵文字'].includes(selectedReaction || '')
  const isNoReaction = selectedReaction === '無反応'
  const isR5 = selectedReaction === '公開拒絶（R5）'
  const isTextReply = selectedReaction === 'テキスト返信'

  return (
    <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
      {/* ── touch summary ─────────────────── */}
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-slate-400 shrink-0">{dateStr}</span>
          {touch.targetPostType && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${postTypeBadge(touch.targetPostType)}`}>{touch.targetPostType}</span>
          )}
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${validityBadge(touch.targetValidity)}`}>対象{touch.targetValidity}</span>
          {!isAwaiting && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${reactionBadge(touch.reactionType)}`}>{touch.reactionType}</span>
          )}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button className="text-[10px] text-slate-400 hover:text-indigo-500 px-1.5 py-0.5 rounded transition" onClick={() => setDetailOpen(v => !v)}>
              詳細{detailOpen ? '▲' : '▼'}
            </button>
            {role === 'admin' && (
              <button className="text-slate-300 hover:text-rose-500 p-1 rounded transition min-h-[28px] min-w-[28px] flex items-center justify-center" onClick={onDelete}>
                <i className="fa-solid fa-trash text-[10px]" />
              </button>
            )}
          </div>
        </div>

        {touch.targetPostText && (
          <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">📝 {touch.targetPostText}</p>
        )}
        <p className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-3 leading-relaxed">{touch.actualSentText}</p>
        {touch.reactionNote && <p className="text-[11px] text-slate-500 leading-relaxed">💬 {touch.reactionNote}</p>}

        {/* reaction status */}
        {isAwaiting && !recordingReaction && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">⏳ 反応待ち</span>
            <button
              className="text-xs text-indigo-600 font-semibold hover:text-indigo-800 transition min-h-[32px] px-2"
              onClick={handleStartReaction}
            >
              反応を記録 →
            </button>
          </div>
        )}

        {/* os2 judgment result (reacted) */}
        {!isAwaiting && touch.os2Judgment && (
          <div className={`mt-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold ${touch.reactionType === 'テキスト返信' ? 'bg-violet-50 text-violet-700' : touch.os2Judgment.startsWith('休眠') ? 'bg-slate-50 text-slate-500' : 'bg-blue-50 text-blue-700'}`}>
            → {touch.os2Judgment}
          </div>
        )}

        {/* detail accordion */}
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
            {touch.os2ConversationLog && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">会話ログ（OS②）</p>
                <p className="text-slate-600 whitespace-pre-wrap text-[10px]">{touch.os2ConversationLog}</p>
              </div>
            )}
            {touch.os2NextAction && (
              <div className="flex gap-2">
                <span className="text-slate-400 shrink-0 text-[10px]">次アクション</span>
                <span className="text-slate-700 font-semibold text-[10px]">{touch.os2NextAction}</span>
              </div>
            )}
            {(touch.os2ReplyA || touch.os2ReplyB) && (
              <div className="flex flex-col gap-1">
                {touch.os2ReplyA && <p className="text-[10px]"><span className="text-violet-600 font-bold">案A</span> {touch.os2ReplyA}</p>}
                {touch.os2ReplyB && <p className="text-[10px]"><span className="text-indigo-500 font-bold">案B</span> {touch.os2ReplyB}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── reaction recording flow ───────── */}
      {recordingReaction && (
        <div className="border-t border-slate-100 bg-slate-50 p-3 flex flex-col gap-3">
          <p className="text-xs font-bold text-slate-700">相手の反応</p>
          <div className="flex flex-wrap gap-1.5">
            {REACTION_TYPES.map(r => <Chip key={r} label={r} selected={selectedReaction === r} onClick={() => { setSelectedReaction(r); setOs2Parsed(null) }} />)}
          </div>

          {/* テキスト返信 → OS②展開 */}
          {isTextReply && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">反応の補足（相手の返信テキスト）</label>
                <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="相手が返信してきたテキスト" value={reactionNote} onChange={e => setReactionNote(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">会話ログ（OS②に流す）</label>
                <textarea rows={4} className="input-base cs text-xs resize-y" value={os2ConvLog} onChange={e => setOs2ConvLog(e.target.value)} />
              </div>
              <button
                className={`btn-sec text-xs py-2 justify-center ${os2CopyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                onClick={handleCopyOs2Prompt}
              >
                <i className={`fa-solid ${os2CopyState === 'copied' ? 'fa-check' : 'fa-copy'} text-indigo-500 mr-1`} />
                {os2CopyState === 'copied' ? '✓ コピーしました' : 'OS②プロンプトをコピー（外部AIで実行）'}
              </button>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">AI出力を貼り付け</label>
                <textarea rows={3} className="input-base cs text-xs resize-y" placeholder="AIの出力をここに貼り付け" value={os2Output} onChange={e => setOs2Output(e.target.value)} />
              </div>
              <button className="btn-primary text-xs py-2 justify-center" style={{ background: '#4f46e5' }} onClick={handleParseOs2}>
                <i className="fa-solid fa-bolt mr-1" />判定を取り込む
              </button>
              {os2Parsed && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 flex flex-col gap-1 text-xs">
                  <p className={`font-bold ${judgmentColor(os2Parsed.judgment)}`}>OS②判定：{os2Parsed.judgment}</p>
                  {os2Parsed.nextAction && <p className="text-slate-600">次アクション：{os2Parsed.nextAction}</p>}
                  {os2Parsed.replyA && <p className="text-violet-700 text-[11px]"><span className="font-bold">案A</span> {os2Parsed.replyA}</p>}
                  {os2Parsed.replyB && <p className="text-indigo-600 text-[11px]"><span className="font-bold">案B</span> {os2Parsed.replyB}</p>}
                </div>
              )}
            </div>
          )}

          {/* いいね等 → S1-L表示 */}
          {isMicroPositive && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">反応の補足（任意）</label>
                <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="補足メモ（任意）" value={reactionNote} onChange={e => setReactionNote(e.target.value)} />
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-2.5 text-xs">
                <p className="font-bold text-blue-700">
                  {selectedReaction === 'フォロー返し' ? 'フォロー返しを記録' : `いいね連続：${newLikeStreak}回目`}
                </p>
                <p className="text-blue-600 mt-0.5">→ {s1CapJudgment()}</p>
              </div>
            </div>
          )}

          {/* 無反応 → 集計 */}
          {isNoReaction && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">反応の補足（任意）</label>
                <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="補足メモ（任意）" value={reactionNote} onChange={e => setReactionNote(e.target.value)} />
              </div>
              <div className="bg-slate-100 border border-slate-200 rounded-lg p-2.5 text-xs">
                <p className="font-bold text-slate-600">無反応連続：{newNoReactionStreak}回目</p>
                <p className="text-slate-500 mt-0.5">→ {noReactionJudgment()}</p>
              </div>
            </div>
          )}

          {/* R5 → クローズ */}
          {isR5 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex flex-col gap-2 text-xs">
              <p className="font-bold text-red-700">⚠️ 公開拒絶（R5）を記録</p>
              <p className="text-red-600">→ クローズ。OS③で検証してください</p>
              <button
                className="btn-danger text-xs py-2 w-full justify-center"
                onClick={() => { handleSaveReaction(); setTimeout(() => onGoToTab3(), 300) }}
              >
                <i className="fa-solid fa-graduation-cap mr-1" />OS③案件検証へ →
              </button>
            </div>
          )}

          {!isR5 && (
            <div className="flex gap-2">
              <button className="btn-sec text-xs py-2.5 px-4 flex-1" onClick={() => { setRecordingReaction(false); setSelectedReaction(null); setReactionNote('') }}>
                キャンセル
              </button>
              <button
                className="btn-primary text-xs py-2.5 px-4 flex-1 justify-center"
                disabled={!selectedReaction}
                style={{ background: selectedReaction ? '#4f46e5' : undefined }}
                onClick={handleSaveReaction}
              >
                <i className="fa-solid fa-check" />記録する
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
