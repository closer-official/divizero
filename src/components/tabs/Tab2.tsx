import { useState, useRef, useEffect } from 'react'
import MdPreviewModal from '../MdPreviewModal'
import { buildCaseMd, caseMdFilename } from '../../utils/mdExport'
import type { AppData, Prompts, PipelineItem, Touch, Analysis, ConversationTurn, Step, PostStock, SubJudgment, OtherPostResearch } from '../../types'
import type { TouchPostType, TouchValidity, TouchReaction } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS2, block, field } from '../../utils/parser'
import { buildPhenomenonFuturePrompt, parsePhenomenonFutureOutput, type PhenomenonFutureResult } from '../../utils/phenomenonFuturePrompt'
import { buildOS2ConversationPrompt, parseOS2CheckpointOutput, type OS2CheckpointResult } from '../../utils/os2Prompt'
import { buildTouchPrompt, parseTouchOutput } from '../../utils/touchPrompt'
import { buildBatchS1ActionPrompt, parseBatchS1ActionOutput, type BatchS1ActionItem } from '../../utils/batchS1ActionPrompt'
import { buildS1ActionPrompt, parseS1ActionOutput, type S1ActionResult } from '../../utils/s1ActionPrompt'
import { buildDMJudgmentPrompt, parseDMJudgmentOutput, type DMJudgmentResult } from '../../utils/dmJudgmentPrompt'
import { buildJudgmentPrompt, parseJudgmentOutput } from '../../utils/judgmentPrompt'
import { buildBatchJudgmentPrompt, parseBatchJudgmentOutput } from '../../utils/batchJudgmentPrompt'
import {
  getOpportunityFitLabel,
  getOpportunityStatusLabel,
  getPrioritySegmentLabel,
  isStrongOpportunity,
  isUTAGEPriority,
  OPPORTUNITY_FACT_ITEMS,
} from '../../utils/opportunityUtils'
import {
  getActiveNotifications, setDismissedUntil, createPendingAnalysis,
  markEmergencyAlertRead, buildEmergencyAlertDetail,
  type ActiveNotification,
} from '../../utils/analysisNotification'
import {
  buildCaseAnalysisPrompt, parseCaseAnalysis,
  buildTouchAnalysisPrompt, parseTouchAnalysis,
} from '../../utils/analysisPrompt'
import {
  addToExcluded, moveToTrash, buildProfileUrl,
  trackBadgeClass, stepsBarData, daysSince, normalizeHandle, buildXSearchUrl,
  uid, shortPostId, todayStr, hasReaction, toReactionArr, reactionDisplay, getLastContactDate, isContactedToday,
} from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'
import { useReceive } from '../../services/receive/useReceive'
import type { OS2TouchPayload } from '../../services/receive/types'

// ── thread helpers ─────────────────────────────────────────────
type LogTurn = { role: '自分' | '相手'; text: string; date: string; channel: 'リプ' | 'DM' }

function parseLogOcrDate(raw: string): string {
  if (!raw || raw === '不明') return new Date().toISOString().slice(0, 16)
  // "YYYY-MM-DD HH:MM" → "YYYY-MM-DDTHH:MM"
  const normalized = raw.trim().replace(' ', 'T')
  const d = new Date(normalized)
  if (!isNaN(d.getTime())) return normalized
  // "YYYY-MM-DD" のみ
  const d2 = new Date(raw.trim())
  if (!isNaN(d2.getTime())) return raw.trim() + 'T00:00'
  return new Date().toISOString().slice(0, 16)
}

function parseLogOcrOutput(raw: string): LogTurn[] | null {
  const blocks = [...raw.matchAll(/={1,3}CONV_START={1,3}([\s\S]*?)={1,3}CONV_END={1,3}/g)].map(m => m[1])
  if (blocks.length === 0) return null
  const segments = blocks.flatMap(block => block.split(/={1,3}SEP={1,3}/).map(s => s.trim()).filter(Boolean))
  const turns = segments.map(seg => {
    const role = (seg.match(/役割:\s*(.+)/)?.[1].trim() ?? '自分') as '自分' | '相手'
    const channel = (seg.match(/チャネル:\s*(.+)/)?.[1].trim() ?? 'DM') as 'リプ' | 'DM'
    const rawDate = seg.match(/日時:\s*(.+)/)?.[1].trim() ?? ''
    const date = parseLogOcrDate(rawDate)
    const text = seg.match(/本文:\s*([\s\S]+)/)?.[1].trim() ?? ''
    return { role, channel, date, text }
  }).filter(t => t.text.length > 0)
  return turns.length > 0 ? turns : null
}

function advanceStep(step: Step): Step {
  const map: Record<string, Step> = { S1: 'S2', S2: 'S3', S3: 'S4', S4: 'S5', S5: 'S5' }
  return (map[step] ?? step) as Step
}

function stepToNum(s: string): number {
  return ({ S1: 1, 'S1-L': 1, S2: 2, S3: 3, S4: 4, S5: 5 } as Record<string, number>)[s] ?? 0
}

function readAgoLabel(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime()
  const diffH = diffMs / (1000 * 60 * 60)
  if (diffH < 1) return `既読${Math.floor(diffH * 60)}分`
  if (diffH < 24) return `既読${Math.floor(diffH)}時間`
  return `既読${Math.floor(diffH / 24)}日`
}

// ── badge helpers ──────────────────────────────────────────────
function validityBadge(v: string) {
  if (v === '◯') return 'bg-green-100 text-green-700'
  if (v === '△') return 'bg-yellow-100 text-yellow-700'
  if (v === '✕') return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-500'
}
function provisionalBadgeText(j: string) {
  if (!j) return null
  if (j.startsWith('◯')) return { text: j, cls: 'text-emerald-600' }
  if (j.startsWith('△')) return { text: j, cls: 'text-amber-600' }
  if (j.startsWith('✕')) return { text: j, cls: 'text-rose-600' }
  return { text: j, cls: 'text-slate-500' }
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
const CHANNEL_LABEL: Record<string, string> = { twitter: 'X', instagram: 'IG', threads: 'TH', dm: 'DM' }
function channelLabel(ch: string) { return CHANNEL_LABEL[ch] ?? ch.toUpperCase() }
function stateBadgeStyle(s?: string): string {
  if (!s || s === 'active') return 'bg-emerald-100 text-emerald-700'
  if (s === 'waiting') return 'bg-amber-100 text-amber-700'
  if (s === 'meeting_scheduled') return 'bg-sky-100 text-sky-700'
  if (s === 'sleeping') return 'bg-slate-100 text-slate-500'
  if (s === 'archived') return 'bg-purple-100 text-purple-600'
  return 'bg-rose-100 text-rose-600'
}
function stateLabel(s?: string): string {
  if (!s || s === 'active') return 'active'
  if (s === 'meeting_scheduled') return '面談待ち'
  return s
}
function tempBadgeStyle(t: number): string {
  if (t >= 80) return 'bg-orange-100 text-orange-600'
  if (t >= 50) return 'bg-emerald-100 text-emerald-600'
  if (t >= 20) return 'bg-blue-100 text-blue-600'
  return 'bg-slate-100 text-slate-500'
}
function judgmentColor(j: string) {
  if (j === '正常' || j.startsWith('正常')) return 'text-emerald-600'
  if (j === 'クローズ') return 'text-rose-600'
  if (j === '休眠') return 'text-slate-500'
  if (j === '保管') return 'text-purple-600'
  if (j === '対象再選定') return 'text-amber-600'
  return 'text-slate-600'
}

type TemperatureFilter = 'all' | 'high' | 'mid' | 'low' | 'unset'
type TemperatureSort = 'default' | 'desc' | 'asc'

function temperatureBucket(temp?: number | null): Exclude<TemperatureFilter, 'all'> | null {
  if (temp == null) return 'unset'
  if (temp >= 60) return 'high'
  if (temp >= 30) return 'mid'
  if (temp >= 0) return 'low'
  return null
}

function isLikeOnlyTouch(touch: Pick<Touch, 'reactionReplyMode' | 'conversationTurns' | 'status'>): boolean {
  if (touch.reactionReplyMode === 'like_only') return true
  const turns = touch.conversationTurns || []
  const lastTurn = turns[turns.length - 1]
  return touch.status === 'reacted' && !!lastTurn && lastTurn.role === '自分' && /いいねのみ/.test(lastTurn.text)
}

function isAwaitingReactionTouch(touch: Pick<Touch, 'status' | 'reactionReplyMode' | 'conversationTurns'>): boolean {
  return touch.status === 'awaiting_reaction' && !isLikeOnlyTouch(touch)
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
const POST_TYPES: TouchPostType[] = ['課題ツイート', '通常投稿', '達成・嬉しい報告', '愚痴・本音', 'ネタ', 'ストーリー', '引用RT', 'その他']
const VALIDITY_OPTS: TouchValidity[] = ['◯', '△', '✕', '未評価']
const MSG_VALIDITY_OPTS: TouchValidity[] = ['◯', '△', '✕', '未判定']
const REACTION_TYPES: TouchReaction[] = ['テキスト返信', 'いいね返り', 'フォロー返し', 'スタンプ・絵文字', '無反応', '公開拒絶（R5）']
const CLOSE_RESULTS = ['断り', 'フェードアウト', '未読', '未到達クローズ', 'ブロック', 'HP/LP所有済み', '受注']

// ── KanbanCard ─────────────────────────────────────────────────
interface KanbanCardProps {
  item: PipelineItem
  isActive: boolean
  onClick: () => void
  onInlineReaction?: (touchId: string, r: TouchReaction) => void
  priorityMeta?: { label: string; className: string; title: string }
}
function KanbanCard({ item, isActive, onClick, onInlineReaction, priorityMeta }: KanbanCardProps) {
  const touches = item.touches || []
  const latestOs2 = [...touches].reverse().find(t => t.os2Judgment)
  const displayJ = latestOs2?.os2Judgment || item.judgment
  const daysUntil = item.recontact_date
    ? Math.round((new Date(item.recontact_date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
    : null
  const daysUntilMeeting = item.state === 'meeting_scheduled' && item.meetingDate
    ? Math.round((new Date(item.meetingDate).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
    : null
  const daysSinceLast = daysSince(getLastContactDate(item) || item.startDate)
  const awaitingTouch = [...touches].reverse().find(t => isAwaitingReactionTouch(t))
  const priority = priorityMeta || { label: '通常', className: 'bg-slate-100 text-slate-500', title: '優先度未設定' }

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-2.5 cursor-pointer transition select-none ${
        isActive ? 'border-indigo-400 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center gap-1 flex-wrap mb-1">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${trackBadgeClass(item.track)}`}>{item.track}</span>
        <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1 py-0.5 rounded shrink-0">{channelLabel(item.channel)}</span>
        {(item.temperature ?? 0) > 0 && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${tempBadgeStyle(item.temperature ?? 0)}`}>温{item.temperature}</span>
        )}
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${priority.className}`} title={priority.title}>
          優先 {priority.label}
        </span>
        {item.inbound_signal && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 bg-teal-100 text-teal-700">{item.inbound_signal.type}</span>
        )}
        {item.prioritySegment && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${isUTAGEPriority(item) ? 'bg-violet-100 text-violet-700' : item.opportunityFit === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {isUTAGEPriority(item) ? 'UTAGE優先' : `適合${getOpportunityFitLabel(item.opportunityFit)}`}
          </span>
        )}
        {isStrongOpportunity(item) && (item.state === 'sleeping' || item.state === 'archived') && (
          <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 bg-orange-100 text-orange-600">🛡保護</span>
        )}
        {awaitingTouch && <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 bg-amber-100 text-amber-600">反応待ち</span>}
        {item.state === 'meeting_scheduled' && <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 bg-sky-100 text-sky-700">面談待ち</span>}
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-slate-100 text-slate-500">接触{touches.length}回</span>
      </div>
      <p className="text-xs font-semibold text-slate-800 leading-tight line-clamp-2">{item.accountName}</p>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
        {daysUntilMeeting !== null ? (
          <span className={`${daysUntilMeeting < 0 ? 'text-rose-500' : 'text-sky-500'} font-medium`}>
            {daysUntilMeeting < 0 ? `面談${Math.abs(daysUntilMeeting)}日前` : daysUntilMeeting === 0 ? '本日面談' : `面談あと${daysUntilMeeting}日`}
          </span>
        ) : daysUntil !== null ? (
          <span className={daysUntil < 0 ? 'text-rose-500 font-medium' : daysUntil <= 3 ? 'text-amber-500 font-medium' : ''}>
            {daysUntil < 0 ? `${Math.abs(daysUntil)}日超過` : `あと${daysUntil}日`}
          </span>
        ) : daysSinceLast > 0 ? (
          <span>{daysSinceLast}日前</span>
        ) : null}
      </div>
      {displayJ && <p className={`text-[10px] mt-1 font-medium truncate ${judgmentColor(displayJ)}`}>{displayJ}</p>}
      {/* ③ インラインリアクションボタン */}
      {awaitingTouch && onInlineReaction && (
        <div className="flex gap-1 mt-1.5" onClick={e => e.stopPropagation()}>
          {(['いいね返り', 'テキスト返信', '無反応'] as TouchReaction[]).map(r => (
            <button
              key={r}
              className="flex-1 text-[9px] font-bold py-0.5 rounded border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-500 hover:text-indigo-600 transition"
              onClick={() => onInlineReaction(awaitingTouch.id, r)}
              title={r}
            >
              {r === 'いいね返り' ? '❤️' : r === 'テキスト返信' ? '💬' : '✕'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── KanbanColumn ───────────────────────────────────────────────
const KANBAN_PAGE = 20
interface KanbanColumnProps {
  label: string
  colorClass: string
  items: PipelineItem[]
  activeId: string | null
  onCardClick: (id: string) => void
  onInlineReaction?: (pipelineId: string, touchId: string, r: TouchReaction) => void
  getPriorityMeta?: (item: PipelineItem) => { label: string; className: string; title: string }
}
function KanbanColumn({ label, colorClass, items, activeId, onCardClick, onInlineReaction, getPriorityMeta }: KanbanColumnProps) {
  const [visible, setVisible] = useState(KANBAN_PAGE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setVisible(KANBAN_PAGE) }, [items.length])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) setVisible(v => Math.min(v + KANBAN_PAGE, items.length))
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [items.length])

  const shown = items.slice(0, visible)

  return (
    <div className="flex-shrink-0 w-44 sm:w-48 flex flex-col snap-start">
      <div className="flex items-center gap-1.5 mb-2 px-0.5">
        <p className={`text-[11px] font-bold flex-1 ${colorClass}`}>{label}</p>
        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium">{items.length}</span>
      </div>
      <div
        className="flex flex-col gap-1.5 min-h-[60px] overflow-y-auto overscroll-contain cs"
        style={{ maxHeight: 'calc(100vh - 320px)' }}
      >
        {items.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-100 py-6 flex items-center justify-center">
            <span className="text-[10px] text-slate-300">なし</span>
          </div>
        ) : (
          <>
            {shown.map(item => (
              <KanbanCard
                key={item.id}
                item={item}
                isActive={item.id === activeId}
                onClick={() => onCardClick(item.id)}
                priorityMeta={getPriorityMeta ? getPriorityMeta(item) : undefined}
                onInlineReaction={onInlineReaction ? (touchId, r) => onInlineReaction(item.id, touchId, r) : undefined}
              />
            ))}
            {visible < items.length && (
              <div ref={sentinelRef} className="py-2 flex justify-center shrink-0">
                <span className="text-[10px] text-slate-300">読込中…</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Tab2 ───────────────────────────────────────────────────────
interface Props {
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
  onGoToTab3: () => void
  onCloseCase: (item: PipelineItem, result: string) => void
  onReturnToOS0: (item: PipelineItem) => void
  openItemId?: string | null
  onOpenItemConsumed?: () => void
}

export default function Tab2({ data, saveData, prompts, role, toast, confirm, onGoToTab3, onCloseCase, onReturnToOS0, openItemId, onOpenItemConsumed }: Props) {
  const [filter, setFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [channelFilter, setChannelFilter] = useState('all')
  const [temperatureFilter, setTemperatureFilter] = useState<TemperatureFilter>('all')
  const [temperatureSort, setTemperatureSort] = useState<TemperatureSort>('default')
  const [searchQuery, setSearchQuery] = useState('')
  const [drawerItemId, setDrawerItemId] = useState<string | null>(null)
  const [drawerWidth, setDrawerWidth] = useState<number | null>(null)
  useEffect(() => {
    const resetMobileDrawerWidth = () => {
      if (window.innerWidth < 640) setDrawerWidth(null)
    }
    resetMobileDrawerWidth()
    window.addEventListener('resize', resetMobileDrawerWidth)
    return () => window.removeEventListener('resize', resetMobileDrawerWidth)
  }, [])
  const [continuousMode, setContinuousMode] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartW = useRef(0)

  // ── MD preview modal state ────────────────────────────────────
  const [mdPreview, setMdPreview] = useState<{ content: string; filename: string } | null>(null)

  // ── Analysis modal state ──────────────────────────────────────
  const [modalNotif, setModalNotif] = useState<ActiveNotification | null>(null)
  const [modalCopyState, setModalCopyState] = useState<'idle' | 'copied'>('idle')
  const [modalOutput, setModalOutput] = useState('')
  const [modalParseError, setModalParseError] = useState<string | null>(null)
  const [modalParseSuccess, setModalParseSuccess] = useState(false)
  // Emergency alert detail view
  const [emergencyDetail, setEmergencyDetail] = useState<string | null>(null)

  // #14 scroll to top on mount (bell click → tab switch)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // ④ 再接触通知から直接案件を開く
  useEffect(() => {
    if (openItemId) {
      setDrawerItemId(openItemId)
      onOpenItemConsumed?.()
    }
  }, [openItemId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ドロワー開閉時にbodyスクロールを制御
  useEffect(() => {
    if (drawerItemId) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerItemId])

  const notifications = getActiveNotifications(data)

  const active = data.pipeline.filter(p => p.isOpen && p.state !== 'closed')
  const myXHandle = data.settings?.myXHandle?.trim() || ''
  const warnItems = active.filter(p => daysSince(p.startDate) >= 30)
  const unverifiedTouches = data.pipeline
    .filter(p => p.isOpen)
    .flatMap(p => (p.touches || [])
      .filter(t => (!t.messageValidity || t.messageValidity === '未判定') && !!t.actualSentText && !t.threadEntry)
      .map(t => ({ touch: t, pipelineItem: p }))
    )
    .slice(0, 10)

  const [batchJudgOpen, setBatchJudgOpen] = useState(false)
  const [batchJudgOutput, setBatchJudgOutput] = useState('')
  const [batchJudgCopyState, setBatchJudgCopyState] = useState<'idle' | 'copied'>('idle')
  const [batchJudgInputShown, setBatchJudgInputShown] = useState(false)
  const [batchJudgError, setBatchJudgError] = useState<string | null>(null)
  const [batchJudgSuccess, setBatchJudgSuccess] = useState(false)

  // 行動判定プロンプト一括（S1バッチ）
  const [batchS1Open, setBatchS1Open] = useState(false)
  const [batchS1CopyState, setBatchS1CopyState] = useState<'idle' | 'copied'>('idle')
  const [batchS1Output, setBatchS1Output] = useState('')
  const [batchS1ApplyState, setBatchS1ApplyState] = useState<'idle' | 'applied'>('idle')
  const [batchS1Error, setBatchS1Error] = useState<string | null>(null)

  // 温度再判定（temperature未設定の過去S1案件を10件ずつ再判定）
  const [tempRetryOpen, setTempRetryOpen] = useState(false)
  const [tempRetryBatch, setTempRetryBatch] = useState(0)
  const [tempRetryOutputs, setTempRetryOutputs] = useState<Record<number, string>>({})
  const [tempRetryCopyStates, setTempRetryCopyStates] = useState<Record<number, 'idle' | 'copied'>>({})
  const [tempRetryApplied, setTempRetryApplied] = useState<Record<number, boolean>>({})
  const [tempRetryError, setTempRetryError] = useState<string | null>(null)

  // ① 本日やること
  const [todayOpen, setTodayOpen] = useState(true)

  // カウントダウン用（1分ごと再レンダー）
  const [tickNow, setTickNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setTickNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // ③ 未判定一括コピー
  const [nextActionBatchOpen, setNextActionBatchOpen] = useState(false)
  const [nextActionCopyStates, setNextActionCopyStates] = useState<Record<string, 'idle' | 'copied'>>({})

  // ② バルクタッチ記録
  const [bulkTouchOpen, setBulkTouchOpen] = useState(false)
  const [bulkPostText, setBulkPostText] = useState('')
  const [bulkPostType, setBulkPostType] = useState<TouchPostType>('課題ツイート')
  const [bulkDate, setBulkDate] = useState(todayStr())
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set())

  // カンバン列定義
  type KanbanColKey = 's1' | 's1l' | 's2' | 's3plus' | 'archived'
  const KANBAN_COLS: Array<{ key: KanbanColKey; label: string; colorClass: string }> = [
    { key: 's1', label: 'S1 接触中', colorClass: 'text-indigo-600' },
    { key: 's1l', label: 'S1-L 待機・休眠', colorClass: 'text-amber-600' },
    { key: 's2', label: 'S2 会話中', colorClass: 'text-violet-600' },
    { key: 's3plus', label: 'S3〜 DM提案', colorClass: 'text-emerald-600' },
    { key: 'archived', label: '保管', colorClass: 'text-purple-600' },
  ]
  function getColKey(item: PipelineItem): KanbanColKey {
    if (item.state === 'archived') return 'archived'
    if (item.state === 'waiting' || item.state === 'sleeping') return 's1l'
    if (item.currentStep === 'S1') return 's1'
    if (item.currentStep === 'S2') return 's2'
    return 's3plus'
  }
  function getPriorityMeta(item: PipelineItem): { label: string; className: string; title: string } {
    const touches = item.touches || []
    const lastContactDate = getLastContactDate(item)
    const awaiting = touches.some(t => isAwaitingReactionTouch(t))
    const warn = warnIds.has(item.id)
    const recontactDue = !!item.recontact_date && new Date(item.recontact_date) <= tickNow
    const contactedToday = isContactedToday(item)
    if (touches.length === 0) {
      return { label: '初回接触', className: 'bg-emerald-100 text-emerald-700', title: 'まだ接触履歴がありません' }
    }
    if (warn) {
      return { label: '要対応', className: 'bg-rose-100 text-rose-700', title: '30日ルールの注意対象です' }
    }
    if (awaiting) {
      return { label: '反応待ち', className: 'bg-amber-100 text-amber-700', title: '相手の反応待ちです' }
    }
    if (recontactDue) {
      return { label: '再接触', className: 'bg-sky-100 text-sky-700', title: '再接触日が到来しています' }
    }
    if (contactedToday) {
      return { label: '今日接触', className: 'bg-violet-100 text-violet-700', title: '今日はすでに接触済みです' }
    }
    const days = daysSince(lastContactDate || item.startDate)
    if (days >= 7) {
      return { label: '低優先', className: 'bg-slate-100 text-slate-500', title: 'しばらく接触していないため後回しです' }
    }
    if (days >= 3) {
      return { label: '通常', className: 'bg-slate-100 text-slate-600', title: '通常優先度です' }
    }
    return { label: '高優先', className: 'bg-indigo-100 text-indigo-700', title: '直近接触のため優先度高めです' }
  }
  const warnIds = new Set(warnItems.map(w => w.id))

  function urgencySort(a: PipelineItem, b: PipelineItem): number {
    // 0. no touches (brand new) → top, newest first
    const aNew = (a.touches || []).length === 0
    const bNew = (b.touches || []).length === 0
    if (aNew !== bNew) return aNew ? -1 : 1
    if (aNew && bNew) return new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime()
    // 1. 30d warn (forced close)
    const aWarn = warnIds.has(a.id) ? 1 : 0
    const bWarn = warnIds.has(b.id) ? 1 : 0
    if (bWarn !== aWarn) return bWarn - aWarn
    // 2. awaiting_reaction (longer elapsed first)
    const aLast = (a.touches || []).slice(-1)[0]
    const bLast = (b.touches || []).slice(-1)[0]
    const aAwaiting = !!aLast && isAwaitingReactionTouch(aLast)
    const bAwaiting = !!bLast && isAwaitingReactionTouch(bLast)
    if (aAwaiting !== bAwaiting) return aAwaiting ? -1 : 1
    // 3. oldest last contact first (b-a: larger daysSince = more urgent = earlier in list)
    return daysSince(getLastContactDate(b) || b.startDate) - daysSince(getLastContactDate(a) || a.startDate)
  }

  function filterActive(items: PipelineItem[]): PipelineItem[] {
    let result = items
    if (filter === 'FT') result = result.filter(p => p.track === 'FT')
    else if (filter === 'NT') result = result.filter(p => p.track === 'NT')
    else if (filter === 'UT') result = result.filter(p => p.track === 'UT')
    else if (filter === 'warn') result = result.filter(p => warnIds.has(p.id))
    else if (filter === 'awaiting') result = result.filter(p => (p.touches || []).some(t => isAwaitingReactionTouch(t)))
    else if (filter === 'elite') result = result.filter(p => isStrongOpportunity(p))
    if (stateFilter !== 'all') result = result.filter(p => (p.state || 'active') === stateFilter)
    if (channelFilter !== 'all') result = result.filter(p => p.channel === channelFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(p =>
        p.accountName.toLowerCase().includes(q) || p.url.toLowerCase().includes(q)
      )
    }
    if (temperatureFilter !== 'all') {
      result = result.filter(p => temperatureBucket(p.temperature) === temperatureFilter)
    }
    return result
  }

  function sortVisibleItems(items: PipelineItem[]): PipelineItem[] {
    const list = [...items]
    if (temperatureSort === 'default') return list.sort(urgencySort)
    const toTemp = (p: PipelineItem) => p.temperature ?? null
    const compareTemp = (a: PipelineItem, b: PipelineItem) => {
      const ta = toTemp(a)
      const tb = toTemp(b)
      if (ta == null && tb == null) return 0
      if (ta == null) return 1
      if (tb == null) return -1
      if (ta === tb) return urgencySort(a, b)
      return temperatureSort === 'desc' ? tb - ta : ta - tb
    }
    return list.sort(compareTemp)
  }

  function getColItems(key: KanbanColKey): PipelineItem[] {
    return sortVisibleItems(filterActive(active.filter(p => getColKey(p) === key)))
  }

  function handleExportCaseMd(item: PipelineItem) {
    const content = buildCaseMd(item)
    const filename = caseMdFilename(item)
    setMdPreview({ content, filename })
  }

  function exportAllMD() {
    const items = sortVisibleItems(filterActive(active))
    const lines: string[] = [
      `# OS② パイプライン`,
      `生成: ${new Date().toLocaleDateString('ja-JP')}`,
      '',
    ]
    items.forEach((item, i) => {
      lines.push(`## ${i + 1}. ${item.accountName}（${item.channel} / ${item.track}）`)
      if (item.hypothesis) lines.push(`**仮説：** ${item.hypothesis}`)
      lines.push(`**現在ステップ：** ${item.currentStep}`)
      lines.push(`**接触開始：** ${item.startDate || '-'}`)
      if (item.judgment) lines.push(`**最終OS②判定：** ${item.judgment}`)
      if (item.nextAction) lines.push(`**次アクション：** ${item.nextAction}`)
      lines.push('')
      const touches = item.touches || []
      if (touches.length > 0) {
        lines.push(`### タッチ履歴（${touches.length}回）`)
        touches.forEach((t, ti) => {
          lines.push(`\n#### タッチ${ti + 1}（${t.date.slice(0, 10)}）`)
          lines.push(`- 投稿種別: ${t.targetPostType}`)
          lines.push(`- 対象妥当性: ${t.targetValidity}`)
          if (t.targetPostText) lines.push(`- 接触した投稿（要約）: ${t.targetPostText}`)
          lines.push(`- 送った文章: ${t.actualSentText}`)
          if (t.editReason) lines.push(`- 変えた理由: ${t.editReason}`)
          lines.push(`- 文面妥当性: ${t.messageValidity}`)
          lines.push(`- 反応: ${reactionDisplay(t.reactionType)}`)
          if (t.os2Judgment) lines.push(`- OS②判定: ${t.os2Judgment}`)
        })
      }
      lines.push('\n---\n')
    })
    setMdPreview({ content: lines.join('\n'), filename: `os2_pipeline.md` })
  }

  function openManualAnalysis(type: 'case_pattern' | 'touch_trend') {
    const judgedCount = data.pipeline.flatMap(p => p.touches || []).filter(t => t.judgedAt).length
    handleOpenModal({
      type,
      label: type === 'case_pattern' ? '失注パターン分析' : '文面傾向分析',
      message: '手動実行',
      icon: type === 'case_pattern' ? '📊' : '📝',
      severity: 'info',
      count: type === 'case_pattern' ? data.closed.length : judgedCount,
      pendingAnalysisId: null,
    })
  }

  function advanceContinuous() {
    const list = sortVisibleItems(filterActive(active))
    const idx = list.findIndex(p => p.id === drawerItemId)
    const next = list[idx + 1]
    if (next) {
      setDrawerItemId(next.id)
    } else {
      setContinuousMode(false)
      setDrawerItemId(null)
      toast.show('すべての案件を処理しました')
    }
  }

  function startContinuousMode() {
    const list = sortVisibleItems(filterActive(active))
    if (list.length === 0) { toast.show('処理対象の案件がありません'); return }
    setContinuousMode(true)
    setDrawerItemId(list[0].id)
  }

  function handleWarnItemClick(itemId: string) {
    setDrawerItemId(itemId)
  }

  // ── Analysis modal handlers ───────────────────────────────────
  async function handleOpenModal(notif: ActiveNotification) {
    if (notif.type === 'emergency_alert') {
      setEmergencyDetail(buildEmergencyAlertDetail(data))
      setModalNotif(notif)
      return
    }
    setModalOutput('')
    setModalParseError(null)
    setModalParseSuccess(false)
    setModalCopyState('idle')
    setModalNotif(notif)
  }

  async function handleModalCopyPrompt() {
    if (!modalNotif) return
    try {
      const prompt = modalNotif.type === 'case_pattern'
        ? await buildCaseAnalysisPrompt(data)
        : await buildTouchAnalysisPrompt(data)
      await copyText(prompt)
      setModalCopyState('copied')
      setTimeout(() => setModalCopyState('idle'), 2000)
      // os_accuracy_alert は touch_trend として記録
      const recordType = modalNotif.type === 'os_accuracy_alert' ? 'touch_trend' : modalNotif.type
      const pending = createPendingAnalysis(data, recordType, modalNotif.count)
      saveData(prev => ({ ...prev, analyses: [...(prev.analyses || []), pending] }))
    } catch {
      setModalParseError('プロンプトのコピーに失敗しました。')
    }
  }

  function handleModalImport() {
    if (!modalNotif) return
    setModalParseError(null)
    const parsed = modalNotif.type === 'case_pattern'
      ? parseCaseAnalysis(modalOutput)
      : parseTouchAnalysis(modalOutput)
    if (!parsed) {
      setModalParseError('AI出力の形式が認識できませんでした。開始タグから終了タグまで含めて貼り付けてください。')
      return
    }
    // os_accuracy_alert は touch_trend として保存
    const recordType = modalNotif.type === 'os_accuracy_alert' ? 'touch_trend' : modalNotif.type
    saveData(prev => {
      const analyses = [...(prev.analyses || [])]
      const pendingIdx = [...analyses].reverse().findIndex(a => a.type === recordType && a.status !== 'completed')
      const now = new Date().toISOString()
      if (pendingIdx >= 0) {
        const realIdx = analyses.length - 1 - pendingIdx
        analyses[realIdx] = { ...analyses[realIdx], ...parsed, status: 'completed', completedAt: now }
      } else {
        analyses.push({
          id: uid(), type: recordType, triggeredAt: now,
          status: 'completed', completedAt: now, targetCount: modalNotif.count,
          ...parsed,
        } as Analysis)
      }
      return { ...prev, analyses }
    })
    setModalParseSuccess(true)
    setTimeout(() => {
      setModalNotif(null)
      setModalParseSuccess(false)
    }, 1500)
    toast.show('分析結果を保存しました')
  }

  function handleDrawerResizeStart(e: React.MouseEvent) {
    e.preventDefault()
    resizingRef.current = true
    resizeStartX.current = e.clientX
    resizeStartW.current = drawerRef.current?.offsetWidth ?? Math.round(window.innerWidth * 0.5)
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = resizeStartX.current - ev.clientX
      const next = Math.max(320, Math.min(window.innerWidth - 40, resizeStartW.current + delta))
      setDrawerWidth(next)
    }
    const onUp = () => {
      resizingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function handleDismiss(type: ActiveNotification['type']) {
    setDismissedUntil(type)
    // Force re-render by toggling state (notifications computed from data+localStorage)
    setFilter(f => f)
  }

  function handleEmergencyConfirm() {
    markEmergencyAlertRead(data, saveData)
    setModalNotif(null)
    setEmergencyDetail(null)
    toast.show('確認済みにしました')
  }

  async function handleCopyBatchJudgPrompt() {
    setBatchJudgError(null)
    try {
      const prompt = await buildBatchJudgmentPrompt(unverifiedTouches)
      await copyText(prompt)
      setBatchJudgCopyState('copied')
      setBatchJudgInputShown(true)
      setTimeout(() => setBatchJudgCopyState('idle'), 2000)
    } catch {
      setBatchJudgError('コピーに失敗しました')
    }
  }

  function handleBatchS1Copy() {
    if (!prompts.S1_ACTION_BATCH) { toast.show('プロンプトを読み込み中です', 2000); return }
    if (pendingS1Touches.length === 0) { toast.show('行動判定が必要なタッチはありません', 2000); return }
    const prompt = buildBatchS1ActionPrompt(pendingS1Touches, prompts.S1_ACTION_BATCH)
    copyText(prompt).then(() => {
      setBatchS1CopyState('copied')
      setTimeout(() => setBatchS1CopyState('idle'), 2500)
    }).catch(() => toast.show('コピーに失敗しました', 2000))
  }

  function handleBatchS1Apply() {
    setBatchS1Error(null)
    if (!batchS1Output.trim()) { setBatchS1Error('AI出力を貼り付けてください'); return }
    const results = parseBatchS1ActionOutput(batchS1Output, pendingS1Touches)
    if (results.length === 0) {
      setBatchS1Error('AI出力の形式が認識できませんでした。===S1_RESULT_START=== を含む出力を貼り付けてください。')
      return
    }
    const total = pendingS1Touches.length
    const missing = pendingS1Touches.filter(item => !results.some(r => r.pipelineId === item.pipelineId && r.touchId === item.touchId))
    const failed = Math.max(0, total - results.length)
    const byPipeline: Record<string, typeof results> = {}
    for (const r of results) {
      if (!byPipeline[r.pipelineId]) byPipeline[r.pipelineId] = []
      byPipeline[r.pipelineId].push(r)
    }
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => {
        const pResults = byPipeline[p.id]
        if (!pResults || pResults.length === 0) return p
        let extra: Partial<PipelineItem> = {}
        let sawDmMove = false
        const addDaysBatch = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
        for (const r of pResults) {
          if (r.judgment === 'DM移行') {
            sawDmMove = true
            extra = {
              currentStep: 'S2',
              state: 'active',
              recontact_date: undefined,
              todayTask: undefined,
            }
          } else if (!sawDmMove && r.judgment === '休眠') {
            extra = { state: 'sleeping', recontact_date: addDaysBatch(r.waitDays ?? 30) }
          } else if (!sawDmMove && r.judgment === '保管') {
            extra = { state: 'archived', recontact_date: addDaysBatch(r.waitDays ?? 180) }
          } else if (!sawDmMove && (r.judgment === '次投稿再接触' || r.judgment === 'S1継続') && r.waitDays && r.waitDays > 0) {
            extra = { state: 'waiting', recontact_date: addDaysBatch(r.waitDays) }
          }
          // 0日後（今日）判定: 休眠・保管以外でwaitDaysが0または未指定のもの
          const isToday = !sawDmMove && r.judgment !== '休眠' && r.judgment !== '保管' && !(r.waitDays && r.waitDays > 0)
          if (isToday && r.nextStep) {
            extra.todayTask = { action: r.nextStep, addedAt: todayStr() }
          }
          if (!sawDmMove && r.temperature !== undefined) {
            extra.temperature = r.temperature
          }
        }
        return {
          ...p,
          ...extra,
          touches: (p.touches || []).map(t => {
            const r = pResults.find(res => res.touchId === t.id)
            if (!r) return t
            return {
              ...t,
              reactionJudgment: r.judgment,
              reactionNextStep: r.nextStep,
              reactionWarning: r.warning,
              reactionReplyA: r.replyA,
              reactionReplyB: r.replyB,
            }
          }),
        }
      }),
    }))
    setBatchS1ApplyState('applied')
    setBatchS1Output('')
    const summaryMsg = `一括処理完了：${total}件中${results.length}件成功 / ${failed}件失敗`
    if (failed > 0) {
      const detail = missing.slice(0, 3).map(item => item.pipelineItem.accountName).filter(Boolean)
      const detailMsg = detail.length > 0 ? `（失敗：${detail.join(' / ')}${missing.length > 3 ? ' / 他あり' : ''}）` : ''
      setBatchS1Error(summaryMsg + detailMsg)
    }
    toast.show(summaryMsg)
    setTimeout(() => { setBatchS1ApplyState('idle'); setBatchS1Open(false) }, 1500)
  }

  function handleTempRetryCopy(batchIdx: number) {
    if (!prompts.S1_ACTION_BATCH) { toast.show('プロンプトを読み込み中です', 2000); return }
    const batch = tempRetryBatches[batchIdx]
    if (!batch || batch.length === 0) return
    const prompt = buildBatchS1ActionPrompt(batch, prompts.S1_ACTION_BATCH)
    copyText(prompt).then(() => {
      setTempRetryCopyStates(prev => ({ ...prev, [batchIdx]: 'copied' }))
      setTimeout(() => setTempRetryCopyStates(prev => ({ ...prev, [batchIdx]: 'idle' })), 2500)
    }).catch(() => toast.show('コピーに失敗しました', 2000))
  }

  function handleTempRetryApply(batchIdx: number) {
    setTempRetryError(null)
    const output = (tempRetryOutputs[batchIdx] ?? '').trim()
    if (!output) { setTempRetryError('AI出力を貼り付けてください'); return }
    const batch = tempRetryBatches[batchIdx]
    const results = parseBatchS1ActionOutput(output, batch)
    if (results.length === 0) {
      setTempRetryError('AI出力の形式が認識できませんでした。===S1_RESULT_START=== を含む出力を貼り付けてください。')
      return
    }
    const byPipeline: Record<string, typeof results> = {}
    for (const r of results) {
      if (!byPipeline[r.pipelineId]) byPipeline[r.pipelineId] = []
      byPipeline[r.pipelineId].push(r)
    }
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => {
        const pResults = byPipeline[p.id]
        if (!pResults || pResults.length === 0) return p
        const temp = pResults.find(r => r.temperature !== undefined)?.temperature
        if (temp === undefined) return p
        return { ...p, temperature: temp }
      }),
    }))
    setTempRetryApplied(prev => ({ ...prev, [batchIdx]: true }))
    setTempRetryOutputs(prev => ({ ...prev, [batchIdx]: '' }))
    toast.show(`バッチ${batchIdx + 1} 取り込み完了：${results.length}件に温度を設定しました`)
    // 全バッチ完了したらモーダルを閉じる
    const nextPending = tempRetryBatches.findIndex((_, i) => i !== batchIdx && !tempRetryApplied[i])
    if (nextPending === -1) {
      setTimeout(() => {
        setTempRetryOpen(false)
        setTempRetryBatch(0)
        setTempRetryOutputs({})
        setTempRetryApplied({})
      }, 1500)
    } else {
      setTempRetryBatch(nextPending)
    }
  }

  function handleBulkTouchSubmit() {
    if (!bulkPostText.trim()) { toast.show('投稿テキストを入力してください', 2000); return }
    if (bulkSelectedIds.size === 0) { toast.show('対象アカウントを選択してください', 2000); return }
    const now = bulkDate || todayStr()
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => {
        if (!bulkSelectedIds.has(p.id)) return p
        const newTouch: Touch = {
          id: uid(), postId: shortPostId(), date: now,
          targetPostText: bulkPostText.trim(), targetPostType: bulkPostType,
          targetValidity: '未評価', aiSuggestedText: '', actualSentText: '',
          editReason: '', messageValidity: '未判定', status: 'awaiting_reaction',
          reactionType: '未記録', reactionNote: '',
        }
        return { ...p, touches: [...(p.touches || []), newTouch], lastContactDate: now }
      }),
    }))
    toast.show(`${bulkSelectedIds.size}件にタッチを記録しました`, 2500)
    setBulkTouchOpen(false)
    setBulkPostText('')
    setBulkSelectedIds(new Set())
  }

  function handleInlineReaction(pipelineId: string, touchId: string, reaction: TouchReaction) {
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => {
        if (p.id !== pipelineId) return p
        return {
          ...p,
          touches: (p.touches || []).map(t =>
            t.id === touchId ? { ...t, reactionType: reaction, status: 'reacted' as const } : t
          ),
          last_reaction: reaction === '無反応' ? 'none' : reaction === 'いいね返り' ? 'heart' : 'temp20',
          last_reaction_at: new Date().toISOString(),
        }
      }),
    }))
    toast.show(`反応を記録しました：${reaction}`, 1800)
  }

  function handleParseBatchJudg() {
    setBatchJudgError(null)
    const results = parseBatchJudgmentOutput(batchJudgOutput)
    if (results.length === 0) {
      setBatchJudgError('AI出力の形式が認識できませんでした。===RESULT_START=== から ===RESULT_END=== まで含めて貼り付けてください。')
      return
    }
    const total = unverifiedTouches.length
    const failed = Math.max(0, total - results.length)
    const now = new Date().toISOString()
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => {
        const touches = p.touches || []
        const updated = touches.map(t => {
          const pid = t.postId || t.id.slice(0, 8)
          const result = results.find(r => r.postId === pid)
          if (!result) return t
          return {
            ...t,
            messageValidity: result.judgment,
            judgmentReason: result.judgmentReason,
            improvementSuggestion: result.improvementSuggestion,
            improvedText: result.improvedText,
            judgedAt: now,
          }
        })
        return updated.some((t, i) => t !== touches[i]) ? { ...p, touches: updated } : p
      }),
    }))
    setBatchJudgSuccess(true)
    setTimeout(() => {
      setBatchJudgOpen(false)
      setBatchJudgSuccess(false)
      setBatchJudgOutput('')
    }, 1500)
    toast.show(`一括処理完了：${total}件中${results.length}件成功 / ${failed}件失敗`)
  }

  function handleClearTodayTask(pipelineId: string) {
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => p.id === pipelineId ? { ...p, todayTask: undefined } : p),
    }))
  }

  // ① 本日やること計算
  const now48hAgo = new Date(tickNow.getTime() - 48 * 60 * 60 * 1000)
  const now24hAgo = new Date(tickNow.getTime() - 24 * 60 * 60 * 1000)

  function awaitingCountdown(touchDate: string): string {
    const deadline = new Date(touchDate).getTime() + 48 * 60 * 60 * 1000
    const remaining = deadline - tickNow.getTime()
    if (remaining <= 0) return '期限切れ'
    const h = Math.floor(remaining / (60 * 60 * 1000))
    const m = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
    return `残り${h}時間${m}分`
  }

  const todayTasks = active.filter(p => {
    // 24h以上経過（残り24h以下）の反応待ちがあれば追加
    const awaitingUrgent = (p.touches || []).some(t => isAwaitingReactionTouch(t) && new Date(t.date) <= now24hAgo)
    const recontactDue = p.recontact_date && new Date(p.recontact_date) <= tickNow
    const isNew = (p.touches || []).length === 0
    const todayTaskActive = !!p.todayTask && !isContactedToday(p)
    const recontactActive = !!recontactDue && !isContactedToday(p)
    return awaitingUrgent || recontactActive || isNew || todayTaskActive
  })

  // 未判定一括コピー対象: active かつ次アクション未決定
  // (タッチなし OR 最終タッチが reacted で recontact_date 未設定)
  const needsNextAction = active.filter(p => {
    const touches = p.touches || []
    if (touches.length === 0) return true
    const lastTouch = [...touches].reverse()[0]
    return lastTouch.status === 'reacted' && !p.recontact_date
  })

  // 温度未設定の過去S1案件一覧（温度再判定バッチ対象）
  const tempRetryItems: BatchS1ActionItem[] = (() => {
    const items: BatchS1ActionItem[] = []
    let idx = 1
    for (const p of data.pipeline) {
      if (p.temperature != null) continue
      const touches = p.touches || []
      if (touches.length === 0) continue
      // 最新のタッチを選択（日付降順）
      const latestTouch = [...touches].sort((a, b) => b.date.localeCompare(a.date))[0]
      items.push({ index: idx++, pipelineId: p.id, touchId: latestTouch.id, pipelineItem: p, touch: latestTouch })
    }
    return items
  })()

  const TEMP_RETRY_BATCH_SIZE = 10
  const tempRetryBatches: BatchS1ActionItem[][] = (() => {
    const batches: BatchS1ActionItem[][] = []
    for (let i = 0; i < tempRetryItems.length; i += TEMP_RETRY_BATCH_SIZE) {
      batches.push(tempRetryItems.slice(i, i + TEMP_RETRY_BATCH_SIZE).map((item, j) => ({
        ...item,
        index: j + 1, // バッチ内での連番にリセット
      })))
    }
    return batches
  })()

  // S1行動判定が未完了のタッチ一覧（一括バッチ対象）
  const pendingS1Touches: BatchS1ActionItem[] = (() => {
    const items: BatchS1ActionItem[] = []
    let idx = 1
    for (const p of data.pipeline) {
      if (!p.isOpen) continue
      for (const t of (p.touches || [])) {
        if (
          !isAwaitingReactionTouch(t) &&
          t.reactionReplyMode !== 'like_only' &&
          (!t.threadEntry || t.threadEntry === 's1_story_reply' || t.threadEntry === 'inbound') &&
          !t.reactionJudgment
        ) {
          items.push({ index: idx++, pipelineId: p.id, touchId: t.id, pipelineItem: p, touch: t })
        }
      }
    }
    return items
  })()

  return (
    <div className="flex flex-col gap-4 overflow-x-hidden" style={{ animation: 'fadeIn .2s ease-out' }}>

      {/* ── ① 本日やること ────────────────────────────────────── */}
      {todayTasks.length > 0 && (
        <div className="border border-indigo-200 bg-indigo-50 rounded-xl overflow-hidden">
          <div
            className="flex items-center justify-between px-4 py-2.5 cursor-pointer"
            onClick={() => setTodayOpen(v => !v)}
          >
            <div className="flex items-center gap-2">
              <i className="fa-solid fa-sun text-amber-500" />
              <span className="font-bold text-sm text-indigo-800">本日やること</span>
              <span className="badge bg-indigo-200 text-indigo-800">{todayTasks.length}件</span>
            </div>
            <i className={`fa-solid fa-chevron-down text-indigo-400 text-xs transition-transform ${todayOpen ? 'rotate-180' : ''}`} />
          </div>
          {todayOpen && (
            <div className="border-t border-indigo-200 divide-y divide-indigo-100">
              {todayTasks.map(p => {
                const awaitingTouch = (p.touches || []).find(t => isAwaitingReactionTouch(t) && new Date(t.date) <= now24hAgo)
                const isOverdue = awaitingTouch ? new Date(awaitingTouch.date) <= now48hAgo : false
                const countdown = awaitingTouch ? awaitingCountdown(awaitingTouch.date) : ''
                const recontactDue = p.recontact_date && new Date(p.recontact_date) <= tickNow
                const isNew = (p.touches || []).length === 0
                const hasJudgmentTask = !!p.todayTask && !isContactedToday(p) && !awaitingTouch && !recontactDue && !isNew
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 px-4 py-2.5 hover:bg-indigo-100 cursor-pointer transition ${hasJudgmentTask ? 'border-l-2 border-orange-400' : ''} ${awaitingTouch && !isOverdue ? 'border-l-2 border-amber-400' : ''} ${isOverdue ? 'border-l-2 border-rose-400' : ''}`}
                    onClick={() => setDrawerItemId(p.id)}
                  >
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <p className="font-semibold text-sm text-indigo-900 truncate">{p.accountName}</p>
                      <p className="text-[11px] text-indigo-600 flex flex-wrap gap-x-2 gap-y-0.5">
                        {isNew && <span className="font-bold text-emerald-600"><i className="fa-solid fa-star mr-1" />初回接触</span>}
                        {awaitingTouch && isOverdue && (
                          <span className="text-rose-600 font-bold"><i className="fa-solid fa-clock mr-1" />期限切れ — 無反応記録を</span>
                        )}
                        {awaitingTouch && !isOverdue && (
                          <span className="text-amber-600 font-semibold"><i className="fa-solid fa-hourglass-half mr-1" />{countdown}</span>
                        )}
                        {recontactDue && !isNew && !isContactedToday(p) && <span><i className="fa-solid fa-calendar-check mr-1" />再接触日</span>}
                        {p.todayTask && !isContactedToday(p) && <span className="text-orange-600 font-semibold"><i className="fa-solid fa-bolt mr-1" />{p.todayTask.action}</span>}
                      </p>
                    </div>
                    {awaitingTouch && (
                      <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        {(['いいね返り', 'テキスト返信', '無反応'] as TouchReaction[]).map(r => (
                          <button
                            key={r}
                            className="text-[10px] font-bold py-1 px-2 rounded-lg border border-indigo-300 bg-white hover:bg-indigo-600 hover:text-white hover:border-indigo-600 text-indigo-600 transition"
                            onClick={() => handleInlineReaction(p.id, awaitingTouch.id, r)}
                          >
                            {r === 'いいね返り' ? '❤️' : r === 'テキスト返信' ? '💬' : '✕無反応'}
                          </button>
                        ))}
                      </div>
                    )}
                    {p.todayTask && !isContactedToday(p) && (
                      <button
                        className="text-[10px] font-bold py-1 px-2.5 rounded-lg border border-orange-300 bg-white hover:bg-orange-500 hover:text-white hover:border-orange-500 text-orange-600 transition shrink-0"
                        onClick={e => { e.stopPropagation(); handleClearTodayTask(p.id) }}
                        title="アクション完了としてリストから除去"
                      >
                        <i className="fa-solid fa-check mr-1" />完了
                      </button>
                    )}
                    <i className="fa-solid fa-chevron-right text-indigo-300 text-xs shrink-0" />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Analysis Notifications ────────────────────────────── */}
      {notifications.length > 0 && (
        <div className="flex flex-col gap-2">
          {[...notifications].sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1)).map(notif => (
            <div
              key={notif.type}
              className={`border rounded-xl p-3 flex flex-col gap-2 text-xs ${
                notif.severity === 'critical'
                  ? 'bg-red-50 border-red-200'
                  : notif.type === 'os_accuracy_alert'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-violet-50 border-violet-200'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-base shrink-0">{notif.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`font-bold ${
                    notif.severity === 'critical' ? 'text-red-700'
                    : notif.type === 'os_accuracy_alert' ? 'text-amber-700'
                    : 'text-violet-700'
                  }`}>{notif.label}</p>
                  <p className={`mt-0.5 ${
                    notif.severity === 'critical' ? 'text-red-600'
                    : notif.type === 'os_accuracy_alert' ? 'text-amber-700'
                    : 'text-violet-600'
                  }`}>{notif.message}</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                {notif.severity !== 'critical' && (
                  <button className="btn-sec text-[11px] py-1 px-3" onClick={() => handleDismiss(notif.type)}>あとで</button>
                )}
                <button
                  className={`text-[11px] py-1 px-3 rounded-lg font-semibold ${
                    notif.severity === 'critical' ? 'bg-red-600 text-white hover:bg-red-700'
                    : notif.type === 'os_accuracy_alert' ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'bg-violet-600 text-white hover:bg-violet-700'
                  } transition`}
                  onClick={() => handleOpenModal(notif)}
                >
                  {notif.severity === 'critical' ? '確認する →' : '確認する →'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-900">
        <span className="font-bold"><i className="fa-solid fa-chart-gantt mr-1" />OS②案件管理：</span>
        タッチを追加→反応を記録→S1ループ管理。テキスト返信のみOS②判定を実行。
      </div>

      {warnItems.length > 0 && (
        <div className="flex flex-col gap-2">
          {warnItems.map(p => (
            <div
              key={p.id}
              className="border rounded-xl p-3 text-xs flex items-center gap-2 cursor-pointer bg-rose-50 border-rose-200 text-rose-800"
              onClick={() => handleWarnItemClick(p.id)}
            >
              <i className="fa-solid fa-triangle-exclamation" />
              <span className="font-bold">{p.accountName}</span>：30日ルール発動 — 強制クローズまたは再接触
            </div>
          ))}
        </div>
      )}

      {/* ── Batch Judgment Panel ─────────────────────────────────── */}
      {unverifiedTouches.length > 0 && (
        <div className="border border-violet-200 bg-violet-50 rounded-xl p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <i className="fa-solid fa-clipboard-check text-violet-500 shrink-0" />
              <span className="font-semibold text-violet-800 shrink-0">未検証タッチ {unverifiedTouches.length}件</span>
              <span className="text-violet-600 truncate hidden sm:block">送信済み・文面未判定</span>
            </div>
            <button
              className="btn-sec text-[11px] py-1 px-3 text-violet-700 border-violet-300 shrink-0"
              onClick={() => { setBatchJudgOpen(v => !v); setBatchJudgError(null); setBatchJudgSuccess(false); setBatchJudgInputShown(false); setBatchJudgOutput('') }}
            >
              {batchJudgOpen ? '閉じる' : 'バッチ判定'}
            </button>
          </div>

          {batchJudgOpen && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="bg-white border border-violet-100 rounded-lg p-2 flex flex-col gap-1">
                {unverifiedTouches.map(({ touch, pipelineItem }) => (
                  <div key={touch.id} className="flex items-center gap-2 text-[11px] py-0.5">
                    <span className="font-mono text-[10px] text-violet-400 shrink-0 w-16 truncate">{touch.postId || touch.id.slice(0, 8)}</span>
                    <span className="font-medium text-slate-700 shrink-0">{pipelineItem.accountName}</span>
                    <span className="text-slate-400 truncate">{touch.actualSentText?.slice(0, 30)}…</span>
                  </div>
                ))}
              </div>

              <button
                className={`btn-sec text-xs py-2 justify-center ${batchJudgCopyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : 'text-violet-700 border-violet-300'}`}
                onClick={handleCopyBatchJudgPrompt}
              >
                <i className={`fa-solid ${batchJudgCopyState === 'copied' ? 'fa-check' : 'fa-copy'} mr-1`} />
                {batchJudgCopyState === 'copied' ? '✓ コピーしました' : `${unverifiedTouches.length}件まとめて判定プロンプトをコピー`}
              </button>

              {(batchJudgInputShown || batchJudgOutput) && (
                <>
                  <p className="text-[10px] text-slate-400">↓ AIに貼り付けて実行 → 出力をここに貼る</p>
                  <textarea
                    rows={4}
                    className="input-base cs text-xs resize-y"
                    placeholder="AIの判定出力をここに貼り付け（===RESULT_START=== から ===RESULT_END=== まで）"
                    value={batchJudgOutput}
                    onChange={e => { setBatchJudgOutput(e.target.value); setBatchJudgError(null) }}
                  />
                  <button
                    className="btn-primary text-xs py-2 justify-center"
                    style={{ background: '#4f46e5' }}
                    onClick={handleParseBatchJudg}
                  >
                    <i className="fa-solid fa-bolt mr-1" />判定を取り込む
                  </button>
                </>
              )}

              {batchJudgError && (
                <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{batchJudgError}</p>
              )}
              {batchJudgSuccess && (
                <p className="text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">✓ 判定を保存しました</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ⑨ Filter + ② バルクタッチ + analysis manual trigger */}
      <div className="flex flex-col gap-2">
        {/* 検索窓 */}
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]" />
          <input
            className="input-base text-xs py-1.5 pl-7 pr-7 w-full"
            placeholder="アカウント名 / ID で検索"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500" onClick={() => setSearchQuery('')}>
              <i className="fa-solid fa-xmark text-[11px]" />
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* トラックフィルタ */}
          <select className="input-base text-xs py-1.5" style={{ maxWidth: 120 }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">全て ({active.length})</option>
            <option value="elite">★優先案件 ({active.filter(p => isStrongOpportunity(p)).length})</option>
            <option value="FT">FT ({active.filter(p => p.track === 'FT').length})</option>
            <option value="NT">NT ({active.filter(p => p.track === 'NT').length})</option>
            <option value="UT">UT ({active.filter(p => p.track === 'UT').length})</option>
            <option value="warn">警告 ({warnItems.length})</option>
            <option value="awaiting">反応待ち ({active.filter(p => (p.touches||[]).some(t=>isAwaitingReactionTouch(t))).length})</option>
          </select>
          {/* stateフィルタ */}
          <select className="input-base text-xs py-1.5" style={{ maxWidth: 110 }} value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
            <option value="all">全state</option>
            <option value="active">active</option>
            <option value="waiting">waiting</option>
            <option value="meeting_scheduled">面談待ち</option>
            <option value="sleeping">sleeping</option>
            <option value="archived">archived</option>
          </select>
          {/* チャネルフィルタ */}
          <select className="input-base text-xs py-1.5" style={{ maxWidth: 110 }} value={channelFilter} onChange={e => setChannelFilter(e.target.value)}>
            <option value="all">全CH</option>
            <option value="twitter">X</option>
            <option value="instagram">IG</option>
            <option value="threads">TH</option>
          </select>
          <input
            className="input-base text-xs py-1.5 font-mono"
            style={{ maxWidth: 150 }}
            value={myXHandle}
            onChange={e => {
              const next = e.target.value.replace(/^@/, '').trim()
              saveData(prev => ({ ...prev, settings: { ...(prev.settings || {}), myXHandle: next || undefined } }))
            }}
            placeholder="自分のX ID"
            title="X検索URLの自動生成に使用します"
          />
          <select className="input-base text-xs py-1.5" style={{ maxWidth: 120 }} value={temperatureFilter} onChange={e => setTemperatureFilter(e.target.value as TemperatureFilter)}>
            <option value="all">全温度</option>
            <option value="high">高温 60+</option>
            <option value="mid">中温 30-59</option>
            <option value="low">低温 0-29</option>
            <option value="unset">未設定</option>
          </select>
          <select className="input-base text-xs py-1.5" style={{ maxWidth: 140 }} value={temperatureSort} onChange={e => setTemperatureSort(e.target.value as TemperatureSort)}>
            <option value="default">既定順</option>
            <option value="desc">温度 高い順</option>
            <option value="asc">温度 低い順</option>
          </select>
          {(filter !== 'all' || stateFilter !== 'all' || channelFilter !== 'all' || temperatureFilter !== 'all' || temperatureSort !== 'default') && (
            <button className="text-[11px] text-slate-400 hover:text-slate-600 px-1.5 py-1" onClick={() => { setFilter('all'); setStateFilter('all'); setChannelFilter('all'); setTemperatureFilter('all'); setTemperatureSort('default'); setSearchQuery('') }}>
              <i className="fa-solid fa-xmark mr-0.5" />リセット
            </button>
          )}
          <div className="ml-auto flex gap-1 shrink-0">
            {/* 連続処理モード */}
            {active.length > 0 && (
              <button
                className={`text-[11px] py-1.5 px-2 rounded-lg border font-bold transition ${continuousMode ? 'bg-indigo-600 text-white border-indigo-600' : 'btn-sec text-indigo-600 border-indigo-300'}`}
                onClick={() => continuousMode ? (setContinuousMode(false), setDrawerItemId(null)) : startContinuousMode()}
                title="連続処理モード：案件を1件ずつ順番に処理"
              >
                <i className="fa-solid fa-forward-step" /><span className="hidden sm:inline ml-1">{continuousMode ? '連続処理中' : '連続処理'}</span>
              </button>
            )}
            {/* ③ 未判定一括コピー */}
            {needsNextAction.length > 0 && (
              <button
                className="btn-sec text-[11px] py-1.5 px-2 text-emerald-700 border-emerald-300"
                onClick={() => setNextActionBatchOpen(true)}
                title="次アクション未決定の全件を順番にタッチ生成プロンプトコピー"
              >
                <i className="fa-solid fa-copy text-emerald-500" />
                <span className="hidden sm:inline ml-1">未判定{needsNextAction.length}件コピー</span>
                <span className="sm:hidden ml-1">{needsNextAction.length}</span>
              </button>
            )}
            {/* ② バルクタッチ */}
            <button className="btn-sec text-[11px] py-1.5 px-2 text-indigo-600 border-indigo-300" onClick={() => setBulkTouchOpen(true)} title="複数案件に同じタッチを一括記録">
              <i className="fa-solid fa-layer-group text-indigo-500" /><span className="hidden sm:inline ml-1">バルク記録</span>
            </button>
            {pendingS1Touches.length > 0 && (
              <button
                className="btn-sec text-[11px] py-1.5 px-2 text-sky-700 border-sky-300"
                onClick={() => setBatchS1Open(true)}
                title="S1行動判定プロンプトを一括コピー・取り込み"
              >
                <i className="fa-solid fa-bolt text-sky-500" />
                <span className="hidden sm:inline ml-1">行動判定{pendingS1Touches.length}件</span>
                <span className="sm:hidden ml-1">{pendingS1Touches.length}</span>
              </button>
            )}
            {tempRetryItems.length > 0 && (
              <button
                className="btn-sec text-[11px] py-1.5 px-2 text-orange-700 border-orange-300"
                onClick={() => { setTempRetryOpen(true); setTempRetryBatch(0) }}
                title="温度未設定の過去S1案件を10件ずつ再判定して温度を補完する"
              >
                <i className="fa-solid fa-fire text-orange-500" />
                <span className="hidden sm:inline ml-1">温度再判定{tempRetryItems.length}件</span>
                <span className="sm:hidden ml-1">{tempRetryItems.length}</span>
              </button>
            )}
            <button className="btn-sec text-[11px] py-1.5 px-2" onClick={exportAllMD} title="全件MD出力">
              <i className="fa-solid fa-file-arrow-down text-slate-400" /><span className="hidden sm:inline ml-1">MD出力</span>
            </button>
            <button className="btn-sec text-[11px] py-1.5 px-2" onClick={() => openManualAnalysis('case_pattern')} title="失注パターン分析">
              <i className="fa-solid fa-chart-bar text-violet-500" /><span className="hidden sm:inline ml-1">失注分析</span>
            </button>
            <button className="btn-sec text-[11px] py-1.5 px-2" onClick={() => openManualAnalysis('touch_trend')} title="文面傾向分析">
              <i className="fa-solid fa-pen-nib text-indigo-500" /><span className="hidden sm:inline ml-1">文面分析</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Kanban Board ─────────────────────────────────────────── */}
      {active.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-slate-300 gap-2">
          <i className="fa-solid fa-chart-gantt text-4xl" />
          <p className="text-sm font-medium">案件がありません</p>
        </div>
      ) : (
        <>
          <div className="hidden sm:flex gap-3 overflow-x-auto -mx-4 px-4 pb-3 snap-x snap-mandatory">
            {KANBAN_COLS.map(col => (
              <KanbanColumn
                key={col.key}
                label={col.label}
                colorClass={col.colorClass}
                items={getColItems(col.key)}
                activeId={drawerItemId}
                onCardClick={id => setDrawerItemId(id)}
                onInlineReaction={handleInlineReaction}
                getPriorityMeta={getPriorityMeta}
              />
            ))}
          </div>
          <div className="sm:hidden -mx-4 px-4 pb-2 overflow-x-auto overflow-y-visible snap-x snap-proximity">
            <div className="flex flex-nowrap gap-3 min-w-max">
              {KANBAN_COLS.map(col => {
                const items = getColItems(col.key)
                if (items.length === 0) return null
                return (
                  <div
                    key={col.key}
                    className="w-[86vw] max-w-[86vw] shrink-0 snap-start rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <p className={`text-[12px] font-bold flex-1 ${col.colorClass}`}>{col.label}</p>
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium">{items.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {items.map(p => {
                        const latestTouch = (p.touches || []).slice(-1)[0]
                        const isAwaiting = latestTouch ? isAwaitingReactionTouch(latestTouch) : false
                        const recontactDays = p.recontact_date
                          ? Math.ceil((new Date(`${p.recontact_date}T00:00:00`).getTime() - new Date(`${todayStr()}T00:00:00`).getTime()) / 86400000)
                          : null
                        const os2Label = latestTouch?.os2Judgment || p.judgment
                        return (
                          <button
                            key={p.id}
                            type="button"
                            className="card w-full px-4 py-3 flex items-center gap-3 text-left cursor-pointer active:bg-slate-50"
                            onClick={() => setDrawerItemId(p.id)}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm text-slate-800 truncate">{p.accountName}</p>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {p.currentStep} · {p.track} · {channelLabel(p.channel)}
                              </p>
                              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                {isAwaiting && (
                                  <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">反応待ち</span>
                                )}
                                {p.temperature != null && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${tempBadgeStyle(p.temperature)}`}>温度 {p.temperature}</span>
                                )}
                                {recontactDays != null && (
                                  <span className={`text-[9px] ${recontactDays < 0 ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
                                    {recontactDays < 0 ? `${Math.abs(recontactDays)}日超過` : recontactDays === 0 ? '本日再接触' : `あと${recontactDays}日`}
                                  </span>
                                )}
                                {os2Label && <span className="text-[9px] text-slate-500 truncate max-w-[150px]">{os2Label}</span>}
                              </div>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${stateBadgeStyle(p.state)}`}>
                              {stateLabel(p.state)}
                            </span>
                            <i className="fa-solid fa-chevron-right text-slate-300 text-xs shrink-0" />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Slide-over Drawer ────────────────────────────────────── */}
      {drawerItemId && (() => {
        const drawerItem = active.find(p => p.id === drawerItemId)
        if (!drawerItem) return null
        return (
          <div className="fixed inset-0 z-50" style={{ animation: 'fadeIn .15s ease-out' }}>
            <div
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
              onClick={() => setDrawerItemId(null)}
            />
            <div
              ref={drawerRef}
              className="absolute top-0 right-0 bottom-0 bg-white shadow-2xl flex flex-col w-full sm:w-[50%] sm:min-w-[320px] sm:max-w-[90vw]"
              style={{
                width: drawerWidth ? `${drawerWidth}px` : undefined,
                animation: 'slideInRight .2s ease-out',
              }}
            >
              {/* Resize handle */}
              <div
                className="hidden sm:block absolute top-0 left-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-indigo-300 transition-colors"
                onMouseDown={handleDrawerResizeStart}
              />
              <div className="shrink-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-2">
                <button
                  className="text-slate-400 hover:text-slate-700 p-1 rounded transition min-h-[36px] min-w-[36px] flex items-center justify-center"
                  onClick={() => { setContinuousMode(false); setDrawerItemId(null) }}
                >
                  <i className="fa-solid fa-xmark text-sm" />
                </button>
                <p className="font-bold text-slate-800 flex-1 truncate text-sm">{drawerItem.accountName}</p>
                {(() => {
                  const pUrl = buildProfileUrl(drawerItem.url, drawerItem.channel)
                  const latestPostUrl = [...(drawerItem.touches || [])].reverse().find(t => t.postUrl)?.postUrl
                  return (
                    <>
                      {pUrl && (
                        <a href={pUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 btn-sec text-xs py-1 px-2" title="プロフィールを開く">
                          <i className="fa-solid fa-user text-indigo-500" />
                        </a>
                      )}
                      {latestPostUrl && (
                        <a href={latestPostUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 btn-sec text-xs py-1 px-2" title="最新投稿を開く">
                          <i className="fa-solid fa-newspaper text-amber-500" />
                        </a>
                      )}
                    </>
                  )
                })()}
                {continuousMode && (() => {
                  const cList = sortVisibleItems(filterActive(active))
                  const cIdx = cList.findIndex(p => p.id === drawerItemId)
                  return (
                    <>
                      <span className="text-[11px] font-bold text-indigo-600 shrink-0 bg-indigo-50 px-2 py-0.5 rounded-full">
                        {cIdx + 1} / {cList.length}件
                      </span>
                      <button
                        className="btn-sec text-xs py-1 px-2 shrink-0"
                        disabled={cIdx <= 0}
                        onClick={() => { const prev = cList[cIdx - 1]; if (prev) setDrawerItemId(prev.id) }}
                        title="前の案件"
                      >
                        <i className="fa-solid fa-chevron-left" />
                      </button>
                      <button
                        className="btn-sec text-xs py-1 px-2 shrink-0"
                        disabled={cIdx >= cList.length - 1}
                        onClick={advanceContinuous}
                        title="次の案件"
                      >
                        <i className="fa-solid fa-chevron-right" />
                      </button>
                    </>
                  )
                })()}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${stateBadgeStyle(drawerItem.state)}`}>{stateLabel(drawerItem.state)}</span>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full shrink-0">{drawerItem.currentStep}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                <CaseCard
                  item={drawerItem}
                  expanded={true}
                  onToggle={() => {}}
                  data={data}
                  saveData={saveData}
                  prompts={prompts}
                  role={role}
                  toast={toast}
                  confirm={confirm}
                  onGoToTab3={onGoToTab3}
                  onOperationDone={continuousMode ? advanceContinuous : undefined}
                  myXHandle={myXHandle}
                  onCloseCase={(item, result) => {
                    if (continuousMode) {
                      const list = sortVisibleItems(filterActive(active))
                      const idx = list.findIndex(p => p.id === item.id)
                      const next = list[idx + 1]
                      if (next) {
                        setDrawerItemId(next.id)
                      } else {
                        setContinuousMode(false)
                        setDrawerItemId(null)
                        toast.show('すべての案件を処理しました')
                      }
                    } else {
                      setDrawerItemId(null)
                    }
                    onCloseCase(item, result)
                  }}
                  onReturnToOS0={(item) => {
                    setDrawerItemId(null)
                    onReturnToOS0(item)
                  }}
                  onExportMd={handleExportCaseMd}
                />
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── ③ 未判定一括コピーモーダル ──────────────────────── */}
      {nextActionBatchOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 flex items-center gap-2 bg-emerald-50 border-b border-emerald-100">
              <i className="fa-solid fa-copy text-emerald-600" />
              <p className="font-bold text-sm text-emerald-800 flex-1">未判定一括コピー（{needsNextAction.length}件）</p>
              <button className="text-slate-400 hover:text-slate-700 p-1" onClick={() => setNextActionBatchOpen(false)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <p className="text-[11px] text-slate-500 px-4 pt-3 pb-1">
              次アクション未決定の案件一覧です。各件の「コピー」を押してAIに貼り付け、タッチ生成を実行してください。
            </p>
            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {needsNextAction.map((p, idx) => {
                const lastContactDate = getLastContactDate(p)
                const isNew = !lastContactDate
                const lastTouch = [...(p.touches || [])].reverse()[0]
                const displayContactDate = lastTouch?.date || lastContactDate
                const copyState = nextActionCopyStates[p.id] || 'idle'
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className="text-xs font-mono text-slate-300 shrink-0 w-6 text-right">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-800 truncate">{p.accountName}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {isNew
                          ? <span className="text-emerald-600 font-bold"><i className="fa-solid fa-star mr-0.5" />初回接触</span>
                          : <span><i className="fa-solid fa-rotate mr-0.5" />接触済み・次アクション未決定（{displayContactDate?.slice(0, 10)}）</span>
                        }
                        <span className="ml-2">{p.currentStep} / {p.track}</span>
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        className="btn-sec text-xs py-1.5 px-2.5"
                        onClick={() => setDrawerItemId(p.id)}
                      >
                        <i className="fa-solid fa-arrow-up-right-from-square text-xs" />開く
                      </button>
                      <button
                        className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition ${copyState === 'copied' ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'}`}
                        onClick={async () => {
                          try {
                            const prompt = await buildTouchPrompt(p, p.touches || [])
                            await copyText(prompt)
                            setNextActionCopyStates(s => ({ ...s, [p.id]: 'copied' }))
                            setTimeout(() => setNextActionCopyStates(s => ({ ...s, [p.id]: 'idle' })), 2500)
                          } catch {
                            toast.show('コピーに失敗しました', 2000)
                          }
                        }}
                      >
                        <i className={`fa-solid ${copyState === 'copied' ? 'fa-check' : 'fa-copy'} mr-1`} />
                        {copyState === 'copied' ? 'コピー済' : 'コピー'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="p-3 border-t border-slate-100 bg-slate-50 text-right">
              <button className="btn-sec text-xs py-2 px-4" onClick={() => setNextActionBatchOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* ── S1行動判定 一括バッチモーダル ──────────────── */}
      {batchS1Open && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 flex items-center gap-2 bg-sky-50 border-b border-sky-100">
              <i className="fa-solid fa-bolt text-sky-600" />
              <p className="font-bold text-sm text-sky-800 flex-1">行動判定 一括処理（{pendingS1Touches.length}件）</p>
              <button className="text-slate-400 hover:text-slate-700 p-1" onClick={() => { setBatchS1Open(false); setBatchS1Output(''); setBatchS1Error(null) }}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 flex flex-col gap-0">
              {/* STEP 1 */}
              <div className="px-4 pt-4 pb-3">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">STEP 1 — プロンプトをコピーしてAIに渡す</p>
                <button
                  className={`w-full py-2.5 text-sm font-bold rounded-xl border transition flex items-center justify-center gap-2 ${
                    batchS1CopyState === 'copied'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-sky-600 border-sky-600 text-white hover:bg-sky-700'
                  }`}
                  onClick={handleBatchS1Copy}
                >
                  <i className={`fa-solid ${batchS1CopyState === 'copied' ? 'fa-check' : 'fa-copy'}`} />
                  {batchS1CopyState === 'copied'
                    ? `✓ ${pendingS1Touches.length}件まとめてコピーしました`
                    : `まとめてコピー（${pendingS1Touches.length}件）`
                  }
                </button>
              </div>

              {/* STEP 2 */}
              <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">STEP 2 — AI出力を貼り付けて取り込む</p>
                <textarea
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-sky-300 bg-slate-50"
                  rows={5}
                  placeholder={"===S1_RESULT_START=== 1 ===\n判定: ...\n===S1_RESULT_END=== 1 ===\n\n===S1_RESULT_START=== 2 ===\n..."}
                  value={batchS1Output}
                  onChange={e => { setBatchS1Output(e.target.value); setBatchS1Error(null) }}
                />
                {batchS1Error && (
                  <p className="text-[11px] text-rose-600 mt-1.5 bg-rose-50 rounded-lg px-3 py-2">{batchS1Error}</p>
                )}
                <button
                  className={`mt-2 w-full py-2.5 text-sm font-bold rounded-xl border transition flex items-center justify-center gap-2 ${
                    batchS1ApplyState === 'applied'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                  onClick={handleBatchS1Apply}
                  disabled={batchS1ApplyState === 'applied'}
                >
                  <i className={`fa-solid ${batchS1ApplyState === 'applied' ? 'fa-check' : 'fa-file-import'}`} />
                  {batchS1ApplyState === 'applied' ? '取り込み完了' : '判定を取り込む'}
                </button>
              </div>

              {/* 対象一覧 */}
              <div className="border-t border-slate-100">
                <p className="text-[11px] text-slate-400 px-4 py-2 font-medium">対象タッチ（{pendingS1Touches.length}件）</p>
                <div className="divide-y divide-slate-50">
                  {pendingS1Touches.map(item => (
                    <div key={`${item.pipelineId}-${item.touchId}`} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-[11px] font-bold text-slate-400 w-5 shrink-0">{item.index}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs text-slate-800 truncate">{item.pipelineItem.accountName}</p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {item.touch.targetPostType || '投稿種別不明'}
                          {item.touch.reactionNote
                            ? <span className="ml-1 text-violet-500">・返信あり</span>
                            : <span className="ml-1"> — {reactionDisplay(item.touch.reactionType)}</span>
                          }
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-3 border-t border-slate-100 bg-slate-50 text-right">
              <button className="btn-sec text-xs py-2 px-4" onClick={() => { setBatchS1Open(false); setBatchS1Output(''); setBatchS1Error(null) }}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 温度再判定モーダル ─────────────────────────────────── */}
      {tempRetryOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            {/* ヘッダー */}
            <div className="p-4 flex items-center gap-2 bg-orange-50 border-b border-orange-100">
              <i className="fa-solid fa-fire text-orange-500" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-orange-800">温度再判定（{tempRetryItems.length}件 / {tempRetryBatches.length}バッチ）</p>
                <p className="text-[10px] text-orange-600 mt-0.5">温度未設定の過去案件に温度を補完します。state・再接触日は変更しません。</p>
              </div>
              <button className="text-slate-400 hover:text-slate-700 p-1" onClick={() => { setTempRetryOpen(false); setTempRetryBatch(0); setTempRetryOutputs({}); setTempRetryApplied({}); setTempRetryError(null) }}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            {/* バッチナビ */}
            {tempRetryBatches.length > 1 && (
              <div className="flex gap-1 px-4 pt-3 flex-wrap">
                {tempRetryBatches.map((batch, i) => (
                  <button
                    key={i}
                    className={`text-[11px] px-2.5 py-1 rounded-full border font-bold transition ${
                      tempRetryApplied[i]
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : i === tempRetryBatch
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-orange-300'
                    }`}
                    onClick={() => { setTempRetryBatch(i); setTempRetryError(null) }}
                  >
                    {tempRetryApplied[i] ? <i className="fa-solid fa-check mr-1" /> : null}
                    バッチ{i + 1}（{batch.length}件）
                  </button>
                ))}
              </div>
            )}

            <div className="p-4 overflow-y-auto flex flex-col gap-3 flex-1">
              {tempRetryBatches.length > 0 ? (() => {
                const batchIdx = tempRetryBatch
                const batch = tempRetryBatches[batchIdx]
                const copyState = tempRetryCopyStates[batchIdx] ?? 'idle'
                const isApplied = tempRetryApplied[batchIdx] ?? false

                return (
                  <>
                    {/* 対象一覧 */}
                    <div className="border border-slate-100 rounded-xl overflow-hidden">
                      <p className="text-[11px] text-slate-400 px-3 py-2 font-medium bg-slate-50 border-b border-slate-100">
                        バッチ{batchIdx + 1} の対象（{batch.length}件）
                      </p>
                      <div className="divide-y divide-slate-50 max-h-32 overflow-y-auto">
                        {batch.map(item => (
                          <div key={item.pipelineId} className="flex items-center gap-2 px-3 py-1.5">
                            <span className="text-[10px] font-bold text-slate-400 w-4 shrink-0">{item.index}</span>
                            <span className="text-[11px] text-slate-700 font-medium truncate flex-1">{item.pipelineItem.accountName}</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${trackBadgeClass(item.pipelineItem.track)}`}>{item.pipelineItem.track}</span>
                            <span className="text-[9px] text-slate-400 shrink-0">{item.touch.date.slice(0, 10)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* STEP1: プロンプトコピー */}
                    <div>
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">STEP 1 — プロンプトをコピーしてAIで実行</p>
                      <button
                        className={`w-full py-2.5 rounded-xl border font-bold text-sm transition flex items-center justify-center gap-2 ${
                          copyState === 'copied'
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                            : 'bg-orange-500 border-orange-500 text-white hover:bg-orange-600'
                        }`}
                        onClick={() => handleTempRetryCopy(batchIdx)}
                      >
                        <i className={`fa-solid ${copyState === 'copied' ? 'fa-check' : 'fa-copy'}`} />
                        {copyState === 'copied'
                          ? `✓ バッチ${batchIdx + 1}（${batch.length}件）コピーしました`
                          : `バッチ${batchIdx + 1}をコピー（${batch.length}件）`
                        }
                      </button>
                    </div>

                    {/* STEP2: AI出力貼り付け */}
                    {!isApplied ? (
                      <div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">STEP 2 — AI出力を貼り付けて取り込む</p>
                        <textarea
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 bg-slate-50"
                          rows={5}
                          placeholder={"===S1_RESULT_START=== 1 ===\n判定: ...\nDM_SCORE: 営業期待値20点＋関係温度10点＋...\n===S1_RESULT_END=== 1 ==="}
                          value={tempRetryOutputs[batchIdx] ?? ''}
                          onChange={e => { setTempRetryOutputs(prev => ({ ...prev, [batchIdx]: e.target.value })); setTempRetryError(null) }}
                        />
                        {tempRetryError && (
                          <p className="text-[11px] text-rose-600 mt-1.5">{tempRetryError}</p>
                        )}
                        <button
                          className="mt-2 w-full py-2.5 rounded-xl border font-bold text-sm bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700 transition flex items-center justify-center gap-2"
                          onClick={() => handleTempRetryApply(batchIdx)}
                        >
                          <i className="fa-solid fa-fire-flame-curved" />
                          温度を取り込む（バッチ{batchIdx + 1}）
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3 border border-emerald-200">
                        <i className="fa-solid fa-circle-check text-lg" />
                        <span className="text-sm font-bold">バッチ{batchIdx + 1} 完了</span>
                      </div>
                    )}
                  </>
                )
              })() : (
                <p className="text-sm text-slate-400 text-center py-8">温度未設定の案件がありません</p>
              )}
            </div>

            <div className="p-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <p className="text-[11px] text-slate-400">
                完了: {Object.values(tempRetryApplied).filter(Boolean).length} / {tempRetryBatches.length} バッチ
              </p>
              <button className="btn-sec text-xs py-2 px-4" onClick={() => { setTempRetryOpen(false); setTempRetryBatch(0); setTempRetryOutputs({}); setTempRetryApplied({}); setTempRetryError(null) }}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ② バルクタッチ記録モーダル ───────────────────────── */}
      {bulkTouchOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 flex items-center gap-2 bg-indigo-50 border-b border-indigo-100">
              <i className="fa-solid fa-layer-group text-indigo-600" />
              <p className="font-bold text-sm text-indigo-800 flex-1">バルクタッチ記録</p>
              <button className="text-slate-400 hover:text-slate-700 p-1" onClick={() => { setBulkTouchOpen(false); setBulkPostText(''); setBulkSelectedIds(new Set()) }}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex flex-col gap-4 flex-1">
              <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                <i className="fa-solid fa-circle-info mr-1 text-slate-400" />
                同じ投稿に複数アカウントへ接触したとき、まとめてタッチ記録できます。
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700">接触した投稿の要約 <span className="text-rose-500">*</span></label>
                <textarea rows={3} className="input-base text-sm resize-none" placeholder="投稿内容の要約を入力" value={bulkPostText} onChange={e => setBulkPostText(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700">投稿種別</label>
                  <select className="input-base text-sm" value={bulkPostType} onChange={e => setBulkPostType(e.target.value as TouchPostType)}>
                    {POST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700">接触日</label>
                  <input type="date" className="input-base text-sm" value={bulkDate} onChange={e => setBulkDate(e.target.value)} />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">対象アカウント</label>
                  <button
                    className="text-[11px] text-indigo-500 hover:text-indigo-700"
                    onClick={() => {
                      const allIds = new Set(active.filter(p => p.isOpen).map(p => p.id))
                      setBulkSelectedIds(bulkSelectedIds.size === allIds.size ? new Set() : allIds)
                    }}
                  >全選択 / 解除</button>
                </div>
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {active.filter(p => p.isOpen).map(p => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkSelectedIds.has(p.id)}
                        onChange={e => {
                          const next = new Set(bulkSelectedIds)
                          if (e.target.checked) next.add(p.id); else next.delete(p.id)
                          setBulkSelectedIds(next)
                        }}
                        className="accent-indigo-600"
                      />
                      <span className="text-sm font-medium text-slate-800 flex-1">{p.accountName}</span>
                      <span className="text-[10px] text-slate-400">{p.track} · {p.currentStep}</span>
                    </label>
                  ))}
                </div>
                {bulkSelectedIds.size > 0 && (
                  <p className="text-[11px] text-indigo-600">{bulkSelectedIds.size}件を選択中</p>
                )}
              </div>
            </div>

            <div className="bg-slate-50 px-4 py-3 flex justify-end gap-2">
              <button className="btn-sec text-xs py-2 px-4" onClick={() => { setBulkTouchOpen(false); setBulkPostText(''); setBulkSelectedIds(new Set()) }}>キャンセル</button>
              <button className="btn-primary text-xs py-2 px-4" onClick={handleBulkTouchSubmit}>
                <i className="fa-solid fa-check mr-1" />{bulkSelectedIds.size}件にタッチ記録
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Analysis Modal ────────────────────────────────────── */}
      {modalNotif && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className={`p-4 flex items-center gap-2 ${
              modalNotif.severity === 'critical' ? 'bg-red-50'
              : modalNotif.type === 'os_accuracy_alert' ? 'bg-amber-50'
              : 'bg-violet-50'
            }`}>
              <span className="text-lg">{modalNotif.icon}</span>
              <p className={`font-bold text-sm flex-1 ${
                modalNotif.severity === 'critical' ? 'text-red-700'
                : modalNotif.type === 'os_accuracy_alert' ? 'text-amber-700'
                : 'text-violet-700'
              }`}>{modalNotif.label}</p>
              <button className="text-slate-400 hover:text-slate-700 p-1" onClick={() => { setModalNotif(null); setEmergencyDetail(null) }}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex flex-col gap-3 flex-1">
              {/* Emergency alert: show list only */}
              {modalNotif.type === 'emergency_alert' && emergencyDetail && (
                <>
                  <p className="text-xs text-red-600 font-semibold">直近10タッチの対象妥当性：</p>
                  <pre className="text-[11px] text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap leading-relaxed border border-slate-200">{emergencyDetail}</pre>
                  <p className="text-[11px] text-slate-500">✕が3件以上あります。Rinパターンを確認してください。</p>
                  <button
                    className="btn-danger text-xs py-2.5 justify-center"
                    onClick={handleEmergencyConfirm}
                  >
                    確認済みにする
                  </button>
                </>
              )}

              {/* case_pattern / touch_trend / os_accuracy_alert: 分析フロー */}
              {modalNotif.type !== 'emergency_alert' && (
                <>
                  {modalNotif.type === 'os_accuracy_alert' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                      <p className="font-bold text-amber-700 mb-0.5">⚠️ OS精度アラートが発生しています</p>
                      <p>このプロンプトを分析AIに貼り付け、「疑義対象OS」欄に注目してください。出力されたOSファイル名をもとに、該当OSのMDファイルを提示してルール見直しの意見を求めてください。</p>
                    </div>
                  )}
                  <div className="flex flex-col gap-1 text-xs text-slate-500">
                    <span>対象件数：{modalNotif.count}件</span>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-bold text-slate-700">① プロンプトをコピーして外部AIで実行</p>
                    <button
                      className={`btn-sec text-xs py-2.5 justify-center ${modalCopyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                      onClick={handleModalCopyPrompt}
                    >
                      <i className={`fa-solid ${modalCopyState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
                      {modalCopyState === 'copied' ? '✓ コピーしました' : 'プロンプトをコピー'}
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-bold text-slate-700">② AI出力を貼り付け</p>
                    <textarea
                      rows={4}
                      className="input-base cs text-xs resize-y"
                      placeholder={`===CASE_ANALYSIS_START=== または ===TOUCH_ANALYSIS_START=== から貼り付けてください`}
                      value={modalOutput}
                      onChange={e => { setModalOutput(e.target.value); setModalParseError(null) }}
                    />
                    {modalParseError && (
                      <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{modalParseError}</p>
                    )}
                    {modalParseSuccess && (
                      <p className="text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">✓ 保存しました</p>
                    )}
                    <button
                      className="btn-primary text-xs py-2.5 justify-center"
                      style={{ background: '#4f46e5' }}
                      onClick={handleModalImport}
                    >
                      <i className="fa-solid fa-bolt mr-1" />結果を取り込む
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="bg-slate-50 px-4 py-3 flex justify-end">
              <button className="btn-sec text-xs py-2 px-4" onClick={() => { setModalNotif(null); setEmergencyDetail(null) }}>キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MD Preview Modal ──────────────────────────────────── */}
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
  onCloseCase: (item: PipelineItem, result: string) => void
  onReturnToOS0: (item: PipelineItem) => void
  onExportMd: (item: PipelineItem) => void
  onOperationDone?: () => void
  myXHandle?: string
}

function CaseCard({ item, expanded, onToggle, data: _data, saveData, prompts, role, toast, confirm, onGoToTab3, onCloseCase, onReturnToOS0, onExportMd, onOperationDone, myXHandle }: CardProps) {
  const { os2Pending, markCompleted, setGeminiPrompt, connected: extConnected } = useReceive()
  const [addingTouch, setAddingTouch] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [meetingUiOpen, setMeetingUiOpen] = useState(false)
  const [meetingDateInput, setMeetingDateInput] = useState('')
  const [meetingUrlInput, setMeetingUrlInput] = useState('')
  const [meetingNoteInput, setMeetingNoteInput] = useState('')
  const addFormRef = useRef<HTMLDivElement>(null)

  // AI generation (touch prompt)
  const [aiOutput, setAiOutput] = useState('')
  const [suggestionA, setSuggestionA] = useState('')
  const [suggestionB, setSuggestionB] = useState('')
  const [pJudgmentA, setPJudgmentA] = useState('')
  const [pJudgmentB, setPJudgmentB] = useState('')
  const [copyBtnState, setCopyBtnState] = useState<'idle' | 'copied'>('idle')
  const [suggACopyState, setSuggACopyState] = useState<'idle' | 'copied'>('idle')
  const [suggBCopyState, setSuggBCopyState] = useState<'idle' | 'copied'>('idle')
  const [autoFillError, setAutoFillError] = useState<string | null>(null)
  const [autoFillWarning, setAutoFillWarning] = useState<string | null>(null)

  // touch add form
  const [tTouchMode, setTTouchMode] = useState<'rep' | 'story' | 'dm' | 'inbound'>('rep')
  const [tInboundChannel, setTInboundChannel] = useState<'リプ' | 'DM'>('DM')
  const [tPostText, setTPostText] = useState('')
  const [tPostRawText, setTPostRawText] = useState('')
  const [tPostType, setTPostType] = useState<TouchPostType>('通常投稿')
  const [tValidity, setTValidity] = useState<TouchValidity>('未評価')
  const [tAiText, setTAiText] = useState('')
  const [tSentText, setTSentText] = useState('')
  const [tEditReason, setTEditReason] = useState('')
  const [tPostDateTime, setTPostDateTime] = useState<string | undefined>(undefined)
  const [tLikes, setTLikes] = useState('')
  const [tComments, setTComments] = useState('')
  const [tRetweets, setTRetweets] = useState('')
  const [tSaves, setTSaves] = useState('')
  const [tImpressions, setTImpressions] = useState('')
  const [tPostUrl, setTPostUrl] = useState('')
  const [tCommentUrl, setTCommentUrl] = useState('')
  const [geminiCopyState, setGeminiCopyState] = useState<'idle' | 'copied'>('idle')
  const [os2Applied, setOs2Applied] = useState(false)

  // close
  const [closeResult, setCloseResult] = useState('断り')

  const touches = item.touches || []
  const s1Count = touches.length
  const likeReturnCount = touches.filter(t => hasReaction(t.reactionType, 'いいね返り')).length
  const followReturned = touches.some(t => hasReaction(t.reactionType, 'フォロー返し'))
  const lastTouchedAt = touches.length > 0
    ? touches.reduce((l, t) => t.date > l ? t.date : l, touches[0].date)
    : item.lastContactDate || null
  const days = daysSince(lastTouchedAt || undefined)
  const totalDays = daysSince(item.startDate)
  const daysUntilRecontact = item.recontact_date
    ? Math.round((new Date(item.recontact_date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
    : null

  const latestOs2Touch = [...touches].reverse().find(t => t.os2Judgment)
  const displayJudgment = latestOs2Touch?.os2Judgment || item.judgment
  const displayNextAction = latestOs2Touch?.os2NextAction || item.nextAction
  const displayReplyA = latestOs2Touch?.os2ReplyA || item.replyA
  const displayReplyB = latestOs2Touch?.os2ReplyB || item.replyB

  // 案件が変わったら os2Applied をリセット
  useEffect(() => { setOs2Applied(false) }, [item.id])

  // 拡張機能から選択されたツイートURLをフォームに自動入力
  useEffect(() => {
    if (os2Applied || !addingTouch || os2Pending.length === 0) return
    const handle = normalizeHandle(item.url)
    const match = os2Pending.find(qi =>
      normalizeHandle((qi.payload as OS2TouchPayload).account.handle) === handle
    )
    if (!match) return
    const payload = match.payload as OS2TouchPayload
    setTPostUrl(payload.postUrl)
    if (payload.postText) setTPostText(payload.postText.slice(0, 100))
    setOs2Applied(true)
    markCompleted(match.id).catch(() => {})
    toast.show('拡張機能からツイートURLを自動入力しました', 3000)
  }, [os2Pending, item.id, item.url, addingTouch, os2Applied, markCompleted, toast])

  function resetForm() {
    setAiOutput(''); setSuggestionA(''); setSuggestionB(''); setPJudgmentA(''); setPJudgmentB('')
    setTPostText(''); setTPostRawText(''); setTPostType('通常投稿'); setTValidity('未評価')
    setTAiText(''); setTSentText(''); setTEditReason('')
    setAutoFillError(null); setAutoFillWarning(null)
    setSuggACopyState('idle'); setSuggBCopyState('idle')
    setTPostDateTime(undefined)
    setTPostUrl('')
    setTCommentUrl('')
    setTLikes(''); setTComments(''); setTRetweets(''); setTSaves(''); setTImpressions('')
    setTInboundChannel('DM')
    setTTouchMode('rep')
  }

  function startAddTouch() {
    setAddingTouch(true)
    setTimeout(() => addFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  async function handleCopyPrompt() {
    setAutoFillError(null)
    try {
      let prompt: string
      if (tTouchMode === 'dm') {
        if (!prompts.PHENOMENON_FUTURE) { setAutoFillError('現象未来プロンプトの読み込みに失敗しました。'); return }
        const dummyTouch: Touch = {
          id: '', date: new Date().toISOString(),
          targetPostText: '', targetPostType: '通常投稿', targetValidity: '未評価',
          aiSuggestedText: '', actualSentText: '', editReason: '',
          messageValidity: '未判定', reactionType: '未記録', reactionNote: '',
          threadEntry: 's3_direct', conversationTurns: [],
        }
        prompt = buildPhenomenonFuturePrompt(item, dummyTouch, prompts.PHENOMENON_FUTURE)
      } else {
        prompt = await buildTouchPrompt(item, touches)
      }
      await copyText(prompt)
      setCopyBtnState('copied')
      setTimeout(() => setCopyBtnState('idle'), 2000)
    } catch {
      setAutoFillError('プロンプトのコピーに失敗しました。')
    }
  }

  async function handleCopyAndOpenGemini() {
    setAutoFillError(null)
    try {
      const prompt = await buildTouchPrompt(item, touches)
      await copyText(prompt)
      if (extConnected) await setGeminiPrompt(prompt).catch(() => {})
      setGeminiCopyState('copied')
      setTimeout(() => setGeminiCopyState('idle'), 2500)
      window.open('https://gemini.google.com/', '_blank')
    } catch {
      setAutoFillError('プロンプトのコピーに失敗しました。')
    }
  }

  function handleAutoFill() {
    setAutoFillError(null)
    setAutoFillWarning(null)
    if (tTouchMode === 'dm') {
      const parsed = parsePhenomenonFutureOutput(aiOutput)
      if (!parsed) {
        setAutoFillError('AI出力の形式が認識できませんでした。===MSG_START=== から ===MSG_END=== までを含めて貼り付けてください。')
        return
      }
      setSuggestionA(parsed.suggestedA)
      setSuggestionB(parsed.suggestedB)
      setTAiText(`A: ${parsed.suggestedA}\nB: ${parsed.suggestedB}`)
      return
    }
    const parsed = parseTouchOutput(aiOutput)
    if (!parsed) {
      setAutoFillError('AI出力の形式が認識できませんでした。===TOUCH_START=== から ===TOUCH_END=== までを含めて貼り付けてください。')
      return
    }
    setTPostText(parsed.targetPostText)
    setTPostRawText(parsed.targetPostRawText)
    setTPostDateTime(parsed.postDateTime || undefined)
    if (parsed.engagementStats) {
      const es = parsed.engagementStats
      setTLikes(es.match(/いいね(\d+)/)?.[1] || '')
      setTComments(es.match(/コメント(\d+)/)?.[1] || '')
      setTRetweets(es.match(/RT(\d+)/)?.[1] || '')
      setTSaves(es.match(/保存(\d+)/)?.[1] || '')
      setTImpressions(es.match(/表示(\d+)/)?.[1] || '')
    }
    setTPostType(parsed.targetPostType as TouchPostType)
    setTValidity(parsed.targetValidity as TouchValidity)
    setTAiText(`A: ${parsed.suggestedTextA}\nB: ${parsed.suggestedTextB}`)
    setSuggestionA(parsed.suggestedTextA)
    setSuggestionB(parsed.suggestedTextB)
    setPJudgmentA(parsed.provisionalJudgmentA)
    setPJudgmentB(parsed.provisionalJudgmentB)
    if (parsed.gateJudgment.includes('✕') || parsed.gateJudgment.includes('対象切替')) {
      setAutoFillWarning('⚠️ ゲート判定「対象外」。営業意図での接触は見送り、別投稿を待つことを推奨します。')
    }
  }

  function handleAddTouch() {
    if (!tSentText.trim()) {
      toast.show(tTouchMode === 'inbound' ? '相手から来た内容は必須です' : '実際に送った文章は必須です', 2000)
      return
    }
    const now = new Date().toISOString()
    let touch: Touch
    let pipelineUpdates: Partial<PipelineItem> = {}

    if (tTouchMode === 'inbound') {
      touch = {
        id: uid(), date: now,
        targetPostText: tInboundChannel === 'DM' ? '（インバウンドDM）' : '（インバウンド返信）',
        targetPostType: 'その他', targetValidity: '◯',
        aiSuggestedText: tAiText, actualSentText: '', editReason: tEditReason,
        messageValidity: '未評価',
        commentUrl: tCommentUrl.trim() || undefined,
        status: 'reacted',
        reactionType: 'テキスト返信',
        reactionNote: tSentText.trim(),
        reactionReplyMode: 'text',
        touchMode: 'conversation',
        threadEntry: 'inbound',
        threadStatus: 'active',
        conversationTurns: [{
          id: uid(), role: '相手', text: tSentText.trim(),
          timestamp: now, channel: tInboundChannel, sentStatus: 'sent',
        } as ConversationTurn],
        dmExchangeCount: tInboundChannel === 'DM' ? 1 : 0,
        repExchangeCount: tInboundChannel === 'リプ' ? 1 : 0,
      }
      pipelineUpdates = { currentStep: 'S2' as Step, state: 'active' as const }
    } else if (tTouchMode === 'dm') {
      touch = {
        id: uid(), date: now,
        targetPostText: '（DM）', targetPostType: 'その他', targetValidity: '未評価',
        aiSuggestedText: tAiText, actualSentText: tSentText, editReason: tEditReason,
        messageValidity: '未判定',
        commentUrl: tCommentUrl.trim() || undefined,
        status: 'awaiting_reaction',
        reactionType: '未記録',
        reactionNote: '',
        touchMode: 'conversation',
        threadEntry: 's3_direct',
        threadStatus: 'active',
        conversationTurns: [{
          id: uid(), role: '自分', text: tSentText,
          timestamp: now, channel: 'DM', sentStatus: 'sent', sentAt: now,
        } as ConversationTurn],
        dmExchangeCount: 0,
        repExchangeCount: 0,
      }
      pipelineUpdates = { currentStep: 'S3' as Step }
    } else if (tTouchMode === 'story') {
      touch = {
        id: uid(), date: now,
        targetPostText: tPostText || '（ストーリー返信）',
        targetPostRawText: tPostRawText || undefined,
        targetPostType: 'ストーリー',
        targetValidity: '◯',
        aiSuggestedText: tAiText, actualSentText: tSentText, editReason: tEditReason,
        messageValidity: '未判定',
        postId: shortPostId(),
        postUrl: tPostUrl.trim() || undefined,
        commentUrl: tCommentUrl.trim() || undefined,
        status: 'awaiting_reaction',
        reactionType: '未記録',
        reactionNote: '',
        threadEntry: 's1_story_reply',
      }
      pipelineUpdates = { currentStep: 'S3' as Step }
    } else {
      touch = {
        id: uid(), date: now,
        targetPostText: tPostText, targetPostRawText: tPostRawText || undefined,
        targetPostType: tPostType, targetValidity: tValidity,
        aiSuggestedText: tAiText, actualSentText: tSentText, editReason: tEditReason,
        messageValidity: '未判定',
        postId: shortPostId(),
        postUrl: tPostUrl.trim() || undefined,
        commentUrl: tCommentUrl.trim() || undefined,
        status: 'awaiting_reaction',
        reactionType: '未記録',
        reactionNote: '',
      }
    }

    const shouldStock = tTouchMode !== 'dm' && tTouchMode !== 'inbound' && (tPostRawText.trim() || tPostText.trim())
    const newResearch: OtherPostResearch | null = shouldStock ? {
      id: uid(), createdAt: now, updatedAt: now,
      sourceType: 'os2_touch',
      sourceText: tPostRawText.trim() || tPostText || '（本文なし）',
      summary: tPostText || tPostRawText.slice(0, 60) || '（要約なし）',
      postedAt: tPostDateTime || undefined,
      metrics: {
        likes: tLikes ? Number(tLikes) : undefined,
        replies: tComments ? Number(tComments) : undefined,
        reposts: tRetweets ? Number(tRetweets) : undefined,
        saves: tSaves ? Number(tSaves) : undefined,
        impressions: tImpressions ? Number(tImpressions) : undefined,
      },
      status: 'stocked',
    } : null

    const shouldClearTodayTask = !pipelineUpdates.todayTask && !pipelineUpdates.recontact_date && (
      !!item.todayTask || (item.recontact_date != null && item.recontact_date <= todayStr())
    )
    if (shouldClearTodayTask) {
      pipelineUpdates = { ...pipelineUpdates, todayTask: undefined, recontact_date: undefined }
    }

    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => p.id === item.id
        ? { ...p, ...pipelineUpdates, touches: [...(p.touches || []), touch], lastContactDate: todayStr() }
        : p
      ),
      ...(newResearch ? { otherPostResearches: [...(prev.otherPostResearches || []), newResearch] } : {}),
    }))
    resetForm()
    setAddingTouch(false)
    const msg = tTouchMode === 'inbound'
      ? 'インバウンドを記録しました（S2で続き対応できます）'
      : tTouchMode === 'dm'
      ? 'DM送信を記録しました（S3へ移動）'
      : tTouchMode === 'story'
        ? 'ストーリー返信を記録しました（S3へ移動）'
        : 'タッチを記録しました（反応待ち）'
    toast.show(msg)
    if (onOperationDone) setTimeout(onOperationDone, 900)
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

  function handleReactionSaved(touchId: string, touchUpdates: Partial<Touch>, pipelineUpdates: Partial<PipelineItem>) {
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

  function handleAddNewTouch(touch: Touch, pipelineUpdates?: Partial<PipelineItem>) {
    const nextPipelineUpdates: Partial<PipelineItem> = { ...(pipelineUpdates || {}) }
    const shouldClearTodayTask = !nextPipelineUpdates.todayTask && !nextPipelineUpdates.recontact_date && (
      !!item.todayTask || (item.recontact_date != null && item.recontact_date <= todayStr())
    )
    if (shouldClearTodayTask) {
      nextPipelineUpdates.todayTask = undefined
      nextPipelineUpdates.recontact_date = undefined
    }
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => p.id === item.id
        ? { ...p, ...nextPipelineUpdates, touches: [...(p.touches || []), touch], lastContactDate: todayStr() }
        : p
      ),
    }))
    toast.show(touch.threadEntry === 's3_direct' ? 'DM送信を記録しました' : 'タッチを追加しました（反応待ち）')
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
        const pFinal = prev.pipeline.find(p => p.id === item.id)!
        const closedEntry = {
          id: uid(), pipelineId: item.id, createdAt: new Date().toISOString(),
          accountName: pFinal.accountName, track: pFinal.track,
          hypothesis: pFinal.hypothesis, startDate: pFinal.startDate,
          closeDate, result: closeResult, ruleFired: false,
        }
        return {
          ...prev,
          pipeline: prev.pipeline.filter(p => p.id !== item.id),
          closed: [...prev.closed, closedEntry],
        }
      })
      toast.show(`「${item.accountName}」をクローズしました（${closeResult}）`)
      setTimeout(() => onCloseCase(item, closeResult), 300)
    })
  }

  function handleCloseCaseFromTouch(result: string) {
    const closeDate = todayStr()
    saveData(prev => {
      const pFinal = prev.pipeline.find(p => p.id === item.id)!
      const closedEntry = {
        id: uid(), pipelineId: item.id, createdAt: new Date().toISOString(),
        accountName: pFinal.accountName, track: pFinal.track,
        hypothesis: pFinal.hypothesis, startDate: pFinal.startDate,
        closeDate, result, ruleFired: false,
      }
      return {
        ...prev,
        pipeline: prev.pipeline.filter(p => p.id !== item.id),
        closed: [...prev.closed, closedEntry],
      }
    })
    toast.show(`「${item.accountName}」をクローズしました（${result}）`)
    setTimeout(() => onCloseCase(item, result), 300)
  }

  const profileUrl = buildProfileUrl(item.url, item.channel)
  const lastTouchedDisplay = lastTouchedAt
    ? new Date(lastTouchedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '/')
    : null

  return (
    <div id={`case-card-${item.id}`} className="card overflow-hidden">
      {/* ── collapsed header ─────────────────── */}
      <div className="p-4 cursor-pointer select-none active:bg-slate-50" onClick={onToggle}>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${trackBadgeClass(item.track)}`}>{item.track}</span>
          <p className="font-semibold text-sm text-slate-800 flex-1 min-w-0 truncate">{item.accountName}</p>
          {/* チャネルバッジ */}
          <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">{channelLabel(item.channel)}</span>
          {/* 温度バッジ（0より大きい場合のみ） */}
          {(item.temperature ?? 0) > 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${tempBadgeStyle(item.temperature ?? 0)}`}>温{item.temperature}</span>
          )}
          {/* 状態バッジ */}
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${stateBadgeStyle(item.state)}`}>{stateLabel(item.state)}</span>
          {/* 案件優先バッジ */}
          {item.prioritySegment && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${isUTAGEPriority(item) ? 'bg-violet-100 text-violet-700' : item.opportunityFit === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {isUTAGEPriority(item) ? 'UTAGE優先' : `適合度${getOpportunityFitLabel(item.opportunityFit)}`}
            </span>
          )}
          {/* 優先案件保護中バッジ */}
          {isStrongOpportunity(item) && (item.state === 'sleeping' || item.state === 'archived') && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-orange-100 text-orange-700">🛡保護中</span>
          )}
          {totalDays >= 30 && <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded shrink-0">30日超</span>}
          {item.inbound_signal && <span className="text-[10px] font-bold bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded shrink-0">{item.inbound_signal.type}</span>}
          <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0">接触{(item.touches || []).length}回</span>
          {profileUrl && (
            <a
              href={profileUrl}
              target="_blank"
              rel="noreferrer"
              className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-indigo-500 shrink-0"
              onClick={e => e.stopPropagation()}
            >
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px]" />
            </a>
          )}
          <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-slate-300 text-xs shrink-0`} />
        </div>
        {/* 再接触日（waiting / sleeping / archived） */}
        {daysUntilRecontact !== null && (item.state === 'waiting' || item.state === 'sleeping' || item.state === 'archived') && (
          <p className={`text-[11px] font-semibold mt-1 ${daysUntilRecontact < 0 ? 'text-rose-600' : item.state === 'archived' ? 'text-purple-600' : 'text-amber-600'}`}>
            <i className="fa-solid fa-clock-rotate-left mr-1 text-[10px]" />
            {daysUntilRecontact < 0 ? `再接触 ${Math.abs(daysUntilRecontact)}日超過` : `再接触まであと${daysUntilRecontact}日`}
          </p>
        )}
        {/* 面談日カウントダウン（meeting_scheduled） */}
        {item.state === 'meeting_scheduled' && item.meetingDate && (() => {
          const d = Math.round((new Date(item.meetingDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
          return (
            <p className={`text-[11px] font-semibold mt-1 ${d < 0 ? 'text-rose-600' : 'text-sky-600'}`}>
              <i className="fa-solid fa-calendar-check mr-1 text-[10px]" />
              {d < 0 ? `面談 ${Math.abs(d)}日前（要フォロー）` : d === 0 ? '本日面談' : `面談まであと${d}日`}
            </p>
          )
        })()}
        {item.hypothesis && <p className="text-xs text-slate-500 mt-1 truncate">{item.hypothesis}</p>}
        {(displayJudgment || displayNextAction) && (
          <div className="flex items-center gap-2 mt-1.5 text-xs">
            {displayJudgment && (
              <span className={`font-bold shrink-0 text-[11px] ${judgmentColor(displayJudgment)}`}>{displayJudgment}</span>
            )}
            {displayNextAction && (
              <span className="text-indigo-600 truncate"><i className="fa-solid fa-arrow-right text-indigo-300 text-[10px] mr-1" />{displayNextAction}</span>
            )}
          </div>
        )}
        {displayReplyA && (
          <div className="flex items-center gap-1 mt-1 text-[11px] text-violet-600 bg-violet-50 rounded-lg px-2 py-1" onClick={e => e.stopPropagation()}>
            <span className="font-bold shrink-0 text-violet-500">案A</span>
            <span className="truncate flex-1">{displayReplyA}</span>
            <button
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-violet-100 transition"
              onClick={e => { e.stopPropagation(); copyText(displayReplyA, () => toast.show('案Aをコピーしました'), { openGemini: false }) }}
              title="コピー"
            >
              <i className="fa-regular fa-copy text-[10px]" />
            </button>
          </div>
        )}
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
          <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 bg-slate-50 border-b border-slate-100">
            <StepsBar currentStep={item.currentStep} />
            <div className="ml-auto flex items-center gap-1">
              {/* トラック変更 */}
              {role === 'admin' && (
                <select
                  className="input-base text-[10px] py-1 px-2"
                  style={{ maxWidth: 60 }}
                  value={item.track}
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    saveData(prev => ({
                      ...prev,
                      pipeline: prev.pipeline.map(p =>
                        p.id === item.id ? { ...p, track: e.target.value as import('../../types').Track } : p
                      ),
                    }))
                    toast.show('トラックを変更しました')
                  }}
                >
                  <option value="FT">FT</option>
                  <option value="NT">NT</option>
                  <option value="UT">UT</option>
                  <option value="SKIP">SKIP</option>
                </select>
              )}
              {/* チャネル変更 */}
              {role === 'admin' && (
                <select
                  className="input-base text-[10px] py-1 px-2"
                  style={{ maxWidth: 64 }}
                  value={item.channel}
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    saveData(prev => ({
                      ...prev,
                      pipeline: prev.pipeline.map(p =>
                        p.id === item.id ? { ...p, channel: e.target.value as import('../../types').Channel } : p
                      ),
                    }))
                    toast.show('チャネルを変更しました')
                  }}
                >
                  <option value="twitter">X</option>
                  <option value="instagram">IG</option>
                  <option value="threads">TH</option>
                  <option value="dm">DM</option>
                </select>
              )}
              {profileUrl && (
                <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="btn-sec text-[11px] py-1 px-2" title="プロフィールを開く">
                  <i className="fa-solid fa-user text-indigo-500 mr-0.5" /><span className="hidden sm:inline">プロフィール</span>
                </a>
              )}
              {(() => {
                const latestPostUrl = [...touches].reverse().find(t => t.postUrl)?.postUrl
                return latestPostUrl ? (
                  <a href={latestPostUrl} target="_blank" rel="noopener noreferrer" className="btn-sec text-[11px] py-1 px-2" title="最新投稿を開く">
                    <i className="fa-solid fa-newspaper text-amber-500 mr-0.5" /><span className="hidden sm:inline">最新投稿</span>
                  </a>
                ) : null
              })()}
              <button className="btn-sec text-[11px] py-1 px-2" onClick={() => onExportMd(item)} title="MDでエクスポート">
                <i className="fa-solid fa-file-lines text-violet-500" />
              </button>
              {role === 'admin' && (
                <button className="btn-danger text-[11px] py-1 px-2" onClick={handleDelete}>
                  <i className="fa-solid fa-trash" />
                </button>
              )}
            </div>
            {/* 面談セット / 解除 */}
            {role === 'admin' && (
              item.state === 'meeting_scheduled' ? (
                <button
                  className="text-[10px] px-2 py-1 rounded bg-sky-100 text-sky-700 hover:bg-sky-200 transition shrink-0"
                  onClick={e => {
                    e.stopPropagation()
                    saveData(prev => ({
                      ...prev,
                      pipeline: prev.pipeline.map(p =>
                        p.id === item.id ? { ...p, state: 'active' as const } : p
                      ),
                    }))
                    toast.show('面談待ちを解除しました')
                  }}
                >
                  <i className="fa-solid fa-calendar-xmark mr-1" />面談解除
                </button>
              ) : (
                <button
                  className="text-[10px] px-2 py-1 rounded bg-sky-50 text-sky-600 hover:bg-sky-100 transition shrink-0"
                  onClick={e => {
                    e.stopPropagation()
                    setMeetingDateInput(item.meetingDate || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10))
                    setMeetingUrlInput(item.meetingUrl || '')
                    setMeetingNoteInput(item.meetingNote || '')
                    setMeetingUiOpen(v => !v)
                  }}
                >
                  <i className="fa-solid fa-calendar-check mr-1" />面談セット
                </button>
              )
            )}
          </div>

          {/* 面談設定フォーム */}
          {meetingUiOpen && item.state !== 'meeting_scheduled' && role === 'admin' && (
            <div className="px-4 py-3 bg-sky-50 border-b border-sky-100 flex flex-col gap-2">
              <p className="text-[10px] font-bold text-sky-700">面談日を設定して「面談待ち」にする</p>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-500 shrink-0 w-10">面談日</label>
                <input type="date" className="input-base text-xs py-1 flex-1" value={meetingDateInput} onChange={e => setMeetingDateInput(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-500 shrink-0 w-10">URL</label>
                <input type="text" className="input-base text-xs py-1 flex-1" placeholder="Zoomリンク等（任意）" value={meetingUrlInput} onChange={e => setMeetingUrlInput(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-500 shrink-0 w-10">メモ</label>
                <input type="text" className="input-base text-xs py-1 flex-1" placeholder="面談メモ（任意）" value={meetingNoteInput} onChange={e => setMeetingNoteInput(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button className="btn-sec text-xs py-1.5 flex-1" onClick={() => setMeetingUiOpen(false)}>キャンセル</button>
                <button
                  className="btn-primary text-xs py-1.5 flex-1 justify-center"
                  style={{ background: '#0284c7' }}
                  disabled={!meetingDateInput}
                  onClick={() => {
                    saveData(prev => ({
                      ...prev,
                      pipeline: prev.pipeline.map(p =>
                        p.id === item.id
                          ? { ...p, state: 'meeting_scheduled' as const, meetingDate: meetingDateInput, meetingUrl: meetingUrlInput || undefined, meetingNote: meetingNoteInput || undefined }
                          : p
                      ),
                    }))
                    setMeetingUiOpen(false)
                    toast.show(`面談日を ${meetingDateInput} に設定しました`)
                  }}
                >
                  <i className="fa-solid fa-calendar-check mr-1" />面談待ちにする
                </button>
              </div>
            </div>
          )}

          {/* URL入力（未設定 or 手動編集） */}
          {role === 'admin' && (!item.url || editingUrl) && (
            <div className="mx-4 mt-3 flex items-center gap-2">
              <input
                className="input-base text-xs flex-1 py-1.5"
                placeholder="@username または https://... を入力"
                value={editingUrl ? urlInput : (item.url || '')}
                onChange={e => { setEditingUrl(true); setUrlInput(e.target.value) }}
                onFocus={() => { if (!editingUrl) { setEditingUrl(true); setUrlInput(item.url || '') } }}
              />
              <button
                className="btn-primary text-xs py-1.5 px-3 shrink-0"
                onClick={() => {
                  const v = urlInput.trim()
                  if (!v) return
                  saveData(prev => ({ ...prev, pipeline: prev.pipeline.map(p => p.id === item.id ? { ...p, url: v } : p) }))
                  setEditingUrl(false)
                  toast.show('URLを保存しました')
                }}
              >
                保存
              </button>
              {editingUrl && <button className="btn-sec text-xs py-1.5 px-2 shrink-0" onClick={() => setEditingUrl(false)}>✕</button>}
            </div>
          )}
          {role === 'admin' && item.url && !editingUrl && (
            <div className="mx-4 mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="truncate flex-1 font-mono">{item.url}</span>
              <button className="shrink-0 hover:text-indigo-500 px-1" onClick={() => { setEditingUrl(true); setUrlInput(item.url || '') }} title="URLを編集">
                <i className="fa-solid fa-pen text-[10px]" />
              </button>
            </div>
          )}

          {/* 案件情報（仮説フルテキスト・観測事実・判定根拠） */}
          <div className="mx-4 mt-3 bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex-1">案件情報</p>
            </div>

            {/* 仮説フルテキスト（常時表示） */}
            {item.hypothesis && (
              <div>
                <p className="text-[10px] text-slate-400 mb-0.5">事前仮説</p>
                <p className="text-slate-700 text-[11px] leading-relaxed whitespace-pre-wrap">{item.hypothesis}</p>
              </div>
            )}

            <div className="flex flex-col gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                <div className="bg-white/70 rounded-lg p-2">
                  <p className="text-slate-400 text-[10px]">営業対象判定</p>
                  <p className="font-bold text-slate-800">{getOpportunityStatusLabel(item.opportunityStatus)}</p>
                </div>
                <div className="bg-white/70 rounded-lg p-2">
                  <p className="text-slate-400 text-[10px]">優先セグメント</p>
                  <p className={`font-bold ${isUTAGEPriority(item) ? 'text-violet-700' : 'text-slate-800'}`}>{getPrioritySegmentLabel(item.prioritySegment)}</p>
                </div>
                <div className="bg-white/70 rounded-lg p-2">
                  <p className="text-slate-400 text-[10px]">案件適合度</p>
                  <p className={`font-bold ${item.opportunityFit === 'high' ? 'text-emerald-700' : item.opportunityFit === 'medium' ? 'text-amber-700' : 'text-slate-800'}`}>{getOpportunityFitLabel(item.opportunityFit)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-amber-700">観測事実</p>
                {item.opportunityBreakdown && <span className="text-[10px] text-slate-500">AIの観測候補あり</span>}
              </div>
              {OPPORTUNITY_FACT_ITEMS.map(entry => (
                <label key={entry.key} className={`flex items-center gap-2 ${role === 'admin' ? 'cursor-pointer' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={role !== 'admin'}
                    checked={!!item.opportunityFacts?.[entry.key]}
                    onChange={event => {
                      const facts = {
                        ...(item.opportunityFacts || {}),
                        [entry.key]: event.target.checked,
                      }
                      saveData(prev => ({
                        ...prev,
                        pipeline: prev.pipeline.map(p => p.id === item.id
                          ? { ...p, opportunityFacts: facts }
                          : p),
                        targets: item.targetId
                          ? prev.targets.map(t => t.id === item.targetId
                              ? { ...t, opportunityFacts: facts }
                              : t)
                          : prev.targets,
                      }))
                    }}
                  />
                  <span className="text-[11px] text-slate-700">{entry.label}</span>
                </label>
              ))}
              {item.opportunityStatusReason && <p className="text-[10px] text-slate-600">対象判定理由: {item.opportunityStatusReason}</p>}
              {item.prioritySegmentReason && <p className="text-[10px] text-slate-600">セグメント理由: {item.prioritySegmentReason}</p>}
              {item.opportunityFitReason && <p className="text-[10px] text-slate-600">判定メモ: {item.opportunityFitReason}</p>}
              {item.opportunityBreakdown && (
                <details>
                  <summary className="text-[10px] text-slate-500 cursor-pointer">AIの観測候補（参考）</summary>
                  <pre className="mt-1 text-[10px] text-slate-600 whitespace-pre-wrap">{item.opportunityBreakdown}</pre>
                </details>
              )}
            </div>

            {item.opportunityBreakdown && (
              <div>
                <button
                  className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1 transition"
                  onClick={() => setShowBreakdown(v => !v)}
                >
                  <i className={`fa-solid fa-chevron-${showBreakdown ? 'up' : 'down'} text-[9px]`} />
                  内訳を{showBreakdown ? '閉じる' : '見る'}
                </button>
                {showBreakdown && (
                  <pre className="mt-1 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-lg p-2 border border-slate-100">
                    {item.opportunityBreakdown}
                  </pre>
                )}
              </div>
            )}
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
                  <button className="shrink-0 btn-sec text-[10px] py-0.5 px-1.5" onClick={() => copyText(displayReplyA, () => toast.show('案Aをコピーしました'), { openGemini: false })}>
                    <i className="fa-regular fa-copy" />
                  </button>
                </div>
              )}
              {displayReplyB && (
                <div className="flex items-start gap-1">
                  <span className="text-indigo-500 font-bold shrink-0 text-[11px]">案B</span>
                  <p className="text-indigo-600 flex-1 text-[11px] leading-relaxed">{displayReplyB}</p>
                  <button className="shrink-0 btn-sec text-[10px] py-0.5 px-1.5" onClick={() => copyText(displayReplyB, () => toast.show('案Bをコピーしました'), { openGemini: false })}>
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
                    myXHandle={myXHandle}
                    prompts={prompts}
                    role={role}
                    confirm={confirm}
                    toast={toast}
                    onDelete={() => handleDeleteTouch(touch.id)}
                    onReactionSaved={handleReactionSaved}
                    onGoToTab3={onGoToTab3}
                    onAddNewTouch={handleAddNewTouch}
                    onCloseCaseAuto={handleCloseCaseFromTouch}
                  />
                ))}
              </div>
            )}
          </div>

          {/* add touch */}
          {!addingTouch ? (
            <div className="px-4 pb-4 flex flex-col gap-2">
              <button
                className="w-full py-3 text-sm font-semibold text-indigo-600 border-2 border-dashed border-indigo-200 rounded-xl hover:bg-indigo-50 transition min-h-[44px]"
                onClick={startAddTouch}
              >
                <i className="fa-solid fa-plus mr-1" />タッチを追加
              </button>
            </div>
          ) : (
            <div ref={addFormRef} className="mx-4 mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-4">
              {/* タイトル + 3択トグル */}
              <div className="flex items-center gap-3">
                <p className="font-bold text-sm text-slate-800 flex-1">タッチを追加</p>
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 flex-wrap">
                  <button
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${tTouchMode === 'rep' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => { resetForm(); setTTouchMode('rep') }}
                  >公開リプ/コメント</button>
                  <button
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${tTouchMode === 'story' ? 'bg-pink-500 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => { resetForm(); setTTouchMode('story') }}
                  >ストーリー返信</button>
                  <button
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${tTouchMode === 'dm' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => { resetForm(); setTTouchMode('dm') }}
                  >通常DM</button>
                  <button
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${tTouchMode === 'inbound' ? 'bg-teal-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => { resetForm(); setTTouchMode('inbound') }}
                  >インバウンド</button>
                </div>
              </div>

              {/* ① AI generation section */}
              {tTouchMode !== 'inbound' ? (
              <div className={`bg-white border rounded-xl p-3 flex flex-col gap-2 ${tTouchMode === 'dm' ? 'border-violet-200' : tTouchMode === 'story' ? 'border-pink-100' : 'border-indigo-100'}`}>
                <p className="text-xs font-bold text-indigo-700">① AIで生成</p>
                <button
                  className={`btn-sec text-xs py-2 justify-center ${copyBtnState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                  onClick={handleCopyPrompt}
                >
                  <i className={`fa-solid ${copyBtnState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
                  {copyBtnState === 'copied' ? '✓ コピーしました' : tTouchMode === 'dm' ? 'OS_現象未来プロンプトをコピー' : 'プロンプトをコピー'}
                </button>
                {tTouchMode !== 'dm' && (
                  <button
                    className={`btn-sec text-xs py-2 justify-center ${
                      geminiCopyState === 'copied'
                        ? 'text-emerald-600 border-emerald-300 bg-emerald-50'
                        : 'text-indigo-700 border-indigo-300 bg-indigo-50 hover:bg-indigo-100'
                    }`}
                    onClick={handleCopyAndOpenGemini}
                  >
                    <i className={`fa-solid ${geminiCopyState === 'copied' ? 'fa-check' : 'fa-paper-plane'} mr-1`} />
                    {geminiCopyState === 'copied' ? '✓ Geminiを開きました' : 'コピー＆Geminiへ送る'}
                  </button>
                )}
                <p className="text-[10px] text-slate-400 text-center">
                  {tTouchMode === 'dm' ? '↓ ChatGPT等に貼り付けて実行' : '↓ 「Geminiへ送る」で自動入力 → スクショを追加して実行'}
                </p>

                <p className="text-xs font-bold text-indigo-700 mt-1">② AI出力を貼り付け</p>
                <textarea
                  rows={3}
                  className="input-base cs text-xs resize-y"
                  placeholder={tTouchMode === 'dm' ? "AI出力をここに貼り付け（===MSG_START=== から ===MSG_END=== まで）" : "AIの出力をここに貼り付け（===TOUCH_START=== から ===TOUCH_END=== まで）"}
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
              ) : (
              <div className="bg-white border border-teal-100 rounded-xl p-3 flex flex-col gap-2">
                <p className="text-xs font-bold text-teal-700">相手から来た反応を手動で記録</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  OS⓪に戻さず、この場で相手の返信内容を会話の1ターン目として登録します。登録後はS2の行動判定導線で続き対応できます。
                </p>
              </div>
              )}

              {/* suggestion A/B with 仮判定 badges */}
              {(suggestionA || suggestionB) && (
                <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 flex flex-col gap-2">
                  <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wide">AI提案（「使う」でフォーム入力＋クリップボードにコピー）</p>
                  {suggestionA && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-start gap-2">
                        <span className="text-violet-600 font-bold text-xs shrink-0">A</span>
                        <p className="text-violet-700 text-xs flex-1 leading-relaxed">{suggestionA}</p>
                        <button
                          className={`shrink-0 btn-sec text-[10px] py-1 px-2 ${suggACopyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                          onClick={async () => {
                            setTSentText(suggestionA)
                            try { await copyText(suggestionA, undefined, { openGemini: false }); setSuggACopyState('copied'); setTimeout(() => setSuggACopyState('idle'), 1500) } catch {}
                          }}
                        >{suggACopyState === 'copied' ? '✓ コピー' : '使う'}</button>
                      </div>
                      {pJudgmentA && (() => { const b = provisionalBadgeText(pJudgmentA); return b ? <p className={`text-[10px] ml-4 ${b.cls} font-medium`}>{b.text}</p> : null })()}
                    </div>
                  )}
                  {suggestionB && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-start gap-2">
                        <span className="text-indigo-500 font-bold text-xs shrink-0">B</span>
                        <p className="text-indigo-600 text-xs flex-1 leading-relaxed">{suggestionB}</p>
                        <button
                          className={`shrink-0 btn-sec text-[10px] py-1 px-2 ${suggBCopyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                          onClick={async () => {
                            setTSentText(suggestionB)
                            try { await copyText(suggestionB, undefined, { openGemini: false }); setSuggBCopyState('copied'); setTimeout(() => setSuggBCopyState('idle'), 1500) } catch {}
                          }}
                        >{suggBCopyState === 'copied' ? '✓ コピー' : '使う'}</button>
                      </div>
                      {pJudgmentB && (() => { const b = provisionalBadgeText(pJudgmentB); return b ? <p className={`text-[10px] ml-4 ${b.cls} font-medium`}>{b.text}</p> : null })()}
                    </div>
                  )}
                </div>
              )}

              <div className="h-px bg-slate-200" />

              {/* form fields */}
              <div className="flex flex-col gap-3">
                {/* 投稿関連フィールド（公開リプ・ストーリー返信モードのみ） */}
                {tTouchMode !== 'dm' && tTouchMode !== 'inbound' && (
                  <>
                    {tTouchMode === 'rep' && (
                      <>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">接触した投稿（要約・識別用）</label>
                          <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="相手の投稿を1行で要約" value={tPostText} onChange={e => setTPostText(e.target.value)} />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500 flex items-center gap-1.5">
                            投稿URL（任意）
                            {os2Applied && tPostUrl && (
                              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full">
                                <i className="fa-solid fa-puzzle-piece mr-0.5" />拡張機能から取得
                              </span>
                            )}
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="url"
                              className="input-base text-xs py-1.5 font-mono flex-1"
                              placeholder="https://x.com/..."
                              value={tPostUrl}
                              onChange={e => setTPostUrl(e.target.value)}
                            />
                            {tPostUrl.trim() && (
                              <a href={tPostUrl.trim()} target="_blank" rel="noopener noreferrer" className="shrink-0 btn-sec text-xs py-1.5 px-2" title="開く">
                                <i className="fa-solid fa-arrow-up-right-from-square text-indigo-500" />
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">
                            コメントURL（任意）
                            <span className="ml-1 text-slate-400">← 送信後、自分のコメントの共有リンクを貼る</span>
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="url"
                              className="input-base text-xs py-1.5 font-mono flex-1"
                              placeholder="https://x.com/..."
                              value={tCommentUrl}
                              onChange={e => setTCommentUrl(e.target.value)}
                            />
                            {tCommentUrl.trim() && (
                              <a href={tCommentUrl.trim()} target="_blank" rel="noopener noreferrer" className="shrink-0 btn-sec text-xs py-1.5 px-2" title="開く">
                                <i className="fa-solid fa-arrow-up-right-from-square text-indigo-500" />
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-slate-700">投稿原文（相手の文をそのまま）<span className="font-normal text-slate-400 ml-1">← 自動入力で設定されます</span></label>
                          <textarea rows={4} className="input-base cs text-xs resize-y" placeholder="「自動入力」で設定されます。手動で貼り付けることも可能です。" value={tPostRawText} onChange={e => setTPostRawText(e.target.value)} />
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
                          <label className="text-xs text-slate-500">エンゲージメント（OS④分析用・いいね＋RT必須）</label>
                          <div className="grid grid-cols-5 gap-1.5">
                            {([
                              { label: 'いいね', value: tLikes, set: setTLikes },
                              { label: 'コメント', value: tComments, set: setTComments },
                              { label: 'RT', value: tRetweets, set: setTRetweets },
                              { label: '保存', value: tSaves, set: setTSaves },
                              { label: '表示回数', value: tImpressions, set: setTImpressions },
                            ] as const).map(({ label, value, set }) => (
                              <div key={label} className="flex flex-col gap-0.5">
                                <span className="text-[10px] text-slate-400 text-center">{label}</span>
                                <input
                                  type="number"
                                  min="0"
                                  className="input-base text-xs text-center py-1 px-1"
                                  placeholder="0"
                                  value={value}
                                  onChange={e => set(e.target.value)}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">AIの提案文（任意）</label>
                  <textarea rows={3} className="input-base cs text-xs resize-y" placeholder={tTouchMode === 'dm' ? 'AIが提案したDM文' : tTouchMode === 'inbound' ? '補足メモがあれば入力' : 'AIが提案した文章'} value={tAiText} onChange={e => setTAiText(e.target.value)} />
                </div>

                {tTouchMode === 'inbound' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">受信チャネル</label>
                    <div className="flex gap-1.5">
                      <Chip label="DM" selected={tInboundChannel === 'DM'} onClick={() => setTInboundChannel('DM')} />
                      <Chip label="リプ" selected={tInboundChannel === 'リプ'} onClick={() => setTInboundChannel('リプ')} />
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-700">{tTouchMode === 'dm' ? '実際に送ったDM文' : tTouchMode === 'story' ? '実際に送ったストーリー返信文' : tTouchMode === 'inbound' ? '相手から来た内容' : '実際に送った文章'} <span className="text-rose-500">*</span></label>
                  <textarea rows={3} className="input-base cs text-xs resize-y" placeholder={tTouchMode === 'dm' ? '実際に送ったDMの文章' : tTouchMode === 'story' ? '相手のストーリーへの返信として送った文章' : tTouchMode === 'inbound' ? '相手から届いた返信・DMの内容をそのまま入力' : '実際に送ったコメント・DM文'} value={tSentText} onChange={e => setTSentText(e.target.value)} />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">変えた理由（任意）</label>
                  <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="AIの提案から変更した理由" value={tEditReason} onChange={e => setTEditReason(e.target.value)} />
                </div>

              </div>

              <div className="flex gap-2 mt-1">
                <button className="btn-sec text-xs py-2.5 px-4 flex-1" onClick={() => { resetForm(); setAddingTouch(false) }}>キャンセル</button>
                <button className="btn-primary text-xs py-2.5 px-4 flex-1 justify-center" style={{ background: '#4f46e5' }} onClick={handleAddTouch}>
                  <i className={`fa-solid ${tTouchMode === 'inbound' ? 'fa-download' : 'fa-paper-plane'}`} />{tTouchMode === 'inbound' ? 'インバウンドとして記録' : '送信完了として記録'}
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
              <div className="px-4 pb-4 flex flex-col gap-2">
                <div className="flex gap-2">
                  <select className="input-base text-xs py-2 flex-1" value={closeResult} onChange={e => setCloseResult(e.target.value)}>
                    {CLOSE_RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button className="btn-danger text-xs px-4 min-h-[44px]" onClick={handleClose}>
                    <i className="fa-solid fa-flag-checkered mr-1" />クローズ
                  </button>
                </div>
                <button
                  className="btn-sec text-xs w-full min-h-[40px]"
                  onClick={() => confirm.show('OS⓪に戻す', `「${item.accountName}」をパイプラインから除去してOS⓪（一次選別）に戻しますか？`, () => onReturnToOS0(item))}
                >
                  <i className="fa-solid fa-rotate-left mr-1" />OS⓪に戻す（OS①未実施のため）
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
  myXHandle?: string
  prompts: Prompts
  role: Role
  confirm: ConfirmAPI
  toast: ToastAPI
  onDelete: () => void
  onReactionSaved: (touchId: string, touchUpdates: Partial<Touch>, pipelineUpdates: Partial<PipelineItem>) => void
  onGoToTab3: () => void
  onAddNewTouch: (touch: Touch, pipelineUpdates?: Partial<PipelineItem>) => void
  onCloseCaseAuto: (result: string) => void
}

function TouchItem({ touch, pipelineItem, myXHandle, prompts, role, confirm, toast, onDelete, onReactionSaved, onGoToTab3, onAddNewTouch, onCloseCaseAuto }: TouchItemProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [editingLinks, setEditingLinks] = useState(false)
  const [postUrlInput, setPostUrlInput] = useState(touch.postUrl || '')
  const [commentUrlInput, setCommentUrlInput] = useState(touch.commentUrl || '')
  const [recordingReaction, setRecordingReaction] = useState(false)
  const [selectedReaction, setSelectedReaction] = useState<TouchReaction[]>([])
  const [reactionNote, setReactionNote] = useState('')
  // reaction edit state
  const [editingReaction, setEditingReaction] = useState(false)
  const [editReactionType, setEditReactionType] = useState<TouchReaction[]>([])
  const [editReactionNote, setEditReactionNote] = useState('')
  // thread state
  const [replyText, setReplyText] = useState('')
  const [initChannel, setInitChannel] = useState<'リプ' | 'DM'>('リプ')
  const [msgOutput, setMsgOutput] = useState('')
  const [msgParsed, setMsgParsed] = useState<PhenomenonFutureResult | null>(null)
  const [msgCopyState, setMsgCopyState] = useState<'idle' | 'copied'>('idle')
  const [os2CpOutput, setOs2CpOutput] = useState('')
  const [os2CpParsed, setOs2CpParsed] = useState<OS2CheckpointResult | null>(null)
  const [os2CpCopyState, setOs2CpCopyState] = useState<'idle' | 'copied'>('idle')
  const [showOs2Cp, setShowOs2Cp] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftEditReason, setDraftEditReason] = useState('')
  const [draftChannel, setDraftChannel] = useState<'リプ' | 'DM'>('リプ')
  const [addingReply, setAddingReply] = useState(false)
  const [newReplyText, setNewReplyText] = useState('')
  const [newReplyChannel, setNewReplyChannel] = useState<'リプ' | 'DM'>('リプ')
  // S1行動判定
  const [s1ActionOutput, setS1ActionOutput] = useState('')
  const [s1ActionParsed, setS1ActionParsed] = useState<S1ActionResult | null>(null)
  const [s1ActionCopyState, setS1ActionCopyState] = useState<'idle' | 'copied'>('idle')
  const [s1ActionInputOpen, setS1ActionInputOpen] = useState(false)
  const [s1ActionError, setS1ActionError] = useState<string | null>(null)
  const [s1ReplyACopyState, setS1ReplyACopyState] = useState<'idle' | 'copied'>('idle')
  const [s1ReplyBCopyState, setS1ReplyBCopyState] = useState<'idle' | 'copied'>('idle')
  const [s1ActualSentText, setS1ActualSentText] = useState('')
  const [s1EditReasonForRecord, setS1EditReasonForRecord] = useState('')
  // DM文面判定
  const [dmJudgTurnId, setDmJudgTurnId] = useState<string | null>(null)
  const [dmJudgOutput, setDmJudgOutput] = useState('')
  const [dmJudgCopyState, setDmJudgCopyState] = useState<'idle' | 'copied'>('idle')
  const [dmJudgError, setDmJudgError] = useState<string | null>(null)
  // OS①タッチ文面再判定（保存済みタッチへの再判定）
  const [touchJudgOpen, setTouchJudgOpen] = useState(false)
  const [touchJudgOutput, setTouchJudgOutput] = useState('')
  const [touchJudgCopyState, setTouchJudgCopyState] = useState<'idle' | 'copied'>('idle')
  const [touchJudgError, setTouchJudgError] = useState<string | null>(null)
  const [touchJudgModelName, setTouchJudgModelName] = useState('')

  const isAwaiting = isAwaitingReactionTouch(touch)
  const isMsgLikeOnly = !!msgParsed && (
    msgParsed.reactionPattern === 'いいねのみ' ||
    /いいねだけ|いいねのみ/.test([msgParsed.suggestedA, msgParsed.suggestedB, msgParsed.nextAction].join(' '))
  )

  const s1JudgmentResult = s1ActionParsed || (touch.reactionJudgment ? {
    judgment: touch.reactionJudgment,
    nextStep: touch.reactionNextStep || '',
    warning: touch.reactionWarning || '',
    reason: '',
    replyMode: touch.reactionReplyMode,
    replyA: touch.reactionReplyA,
    replyB: touch.reactionReplyB,
  } as S1ActionResult : null)

  const newLikeStreak = (pipelineItem.likeReturnStreak || 0) + 1
  const newNoReactionStreak = (pipelineItem.noReactionStreak || 0) + 1
  const touchesWithFollow = (pipelineItem.touches || []).some(t => hasReaction(t.reactionType, 'フォロー返し')) || selectedReaction.includes('フォロー返し')

  function s1CapJudgment(): string {
    if (newLikeStreak < 3) return `正常（新規投稿待ち → 別の具体点でS1再生成）`
    if (touchesWithFollow) return `正常（チャネル格上げ）`
    return `休眠`
  }
  function noReactionJudgment(): string {
    if (newNoReactionStreak === 1) return `正常（次の新規投稿を待つ）`
    return `休眠（無反応${newNoReactionStreak}連続。追いS1はしない）`
  }

  function handleStartReaction() {
    setRecordingReaction(true)
    setInitChannel(pipelineItem.currentStep === 'S1' ? 'リプ' : 'DM')
  }

  function handleSaveReaction() {
    if (selectedReaction.length === 0) return

    const touchUpdates: Partial<Touch> = {
      status: 'reacted',
      reactionType: selectedReaction,
      reactionNote,
    }
    const pipelineUpdates: Partial<PipelineItem> = {}

    if (selectedReaction.includes('テキスト返信')) {
      const replyTurn: ConversationTurn = {
        id: uid(), role: '相手', text: replyText,
        timestamp: new Date().toISOString(), channel: initChannel, sentStatus: 'sent',
      }
      if (touch.conversationTurns && touch.conversationTurns.length > 0) {
        // 継続モード：既存のターンに追加
        touchUpdates.conversationTurns = [...touch.conversationTurns, replyTurn]
        touchUpdates.repExchangeCount = initChannel === 'リプ' ? (touch.repExchangeCount || 0) + 1 : touch.repExchangeCount
        touchUpdates.dmExchangeCount = initChannel === 'DM' ? (touch.dmExchangeCount || 0) + 1 : touch.dmExchangeCount
      } else {
        // 初回：最初から会話ターンを作成
        const selfTurn: ConversationTurn = {
          id: uid(), role: '自分', text: touch.actualSentText,
          timestamp: touch.date, channel: initChannel, sentStatus: 'sent', sentAt: touch.date,
        }
        touchUpdates.conversationTurns = [selfTurn, replyTurn]
        touchUpdates.repExchangeCount = initChannel === 'リプ' ? 1 : 0
        touchUpdates.dmExchangeCount = initChannel === 'DM' ? 1 : 0
      }
      touchUpdates.threadStatus = 'active'
      touchUpdates.reactionNote = replyText
      pipelineUpdates.likeReturnStreak = 0
      pipelineUpdates.noReactionStreak = 0
    } else if (selectedReaction.some(r => ['いいね返り', 'フォロー返し', 'スタンプ・絵文字'].includes(r))) {
      touchUpdates.os2Judgment = s1CapJudgment()
      pipelineUpdates.likeReturnStreak = newLikeStreak
      pipelineUpdates.noReactionStreak = 0
      pipelineUpdates.last_reaction = 'heart'
      pipelineUpdates.last_reaction_at = new Date().toISOString()
    } else if (selectedReaction.includes('無反応')) {
      touchUpdates.os2Judgment = noReactionJudgment()
      pipelineUpdates.noReactionStreak = newNoReactionStreak
      pipelineUpdates.likeReturnStreak = 0
      pipelineUpdates.last_reaction = 'none'
      pipelineUpdates.last_reaction_at = new Date().toISOString()
    } else if (selectedReaction.includes('公開拒絶（R5）')) {
      touchUpdates.os2Judgment = 'クローズ'
      pipelineUpdates.judgment = 'クローズ'
      pipelineUpdates.last_reaction = 'negative'
      pipelineUpdates.last_reaction_at = new Date().toISOString()
    }

    onReactionSaved(touch.id, touchUpdates, pipelineUpdates)
    setRecordingReaction(false)
    setSelectedReaction([])
    setReactionNote('')
    setMsgOutput('')
    setMsgParsed(null)
  }

  function handleOpenEditReaction() {
    const current = toReactionArr(touch.reactionType).filter(r => r !== '未記録') as TouchReaction[]
    setEditReactionType(current)
    setEditReactionNote(touch.reactionNote || '')
    setEditingReaction(true)
  }

  function handleSaveEditedReaction() {
    if (editReactionType.length === 0) return
    const touchUpdates: Partial<Touch> = {
      reactionType: editReactionType,
      reactionNote: editReactionNote,
      status: 'reacted' as const,
    }
    const pipelineUpdates: Partial<PipelineItem> = {}
    const sortedTouches = [...(pipelineItem.touches || [])].sort((a, b) => b.date.localeCompare(a.date))
    const isLatest = sortedTouches[0]?.id === touch.id
    if (isLatest) {
      if (editReactionType.some(r => ['いいね返り', 'フォロー返し', 'スタンプ・絵文字'].includes(r))) {
        pipelineUpdates.last_reaction = 'heart'
        pipelineUpdates.last_reaction_at = new Date().toISOString()
      } else if (editReactionType.includes('無反応')) {
        pipelineUpdates.last_reaction = 'none'
        pipelineUpdates.last_reaction_at = new Date().toISOString()
      } else if (editReactionType.includes('公開拒絶（R5）')) {
        pipelineUpdates.last_reaction = 'negative'
        pipelineUpdates.last_reaction_at = new Date().toISOString()
      } else if (editReactionType.includes('テキスト返信')) {
        pipelineUpdates.noReactionStreak = 0
        pipelineUpdates.likeReturnStreak = 0
      }
    }
    onReactionSaved(touch.id, touchUpdates, pipelineUpdates)
    setEditingReaction(false)
    setEditReactionType([])
    setEditReactionNote('')
  }

  function handleUndoSelfRecord() {
    const turns = touch.conversationTurns || []
    const lastTurn = turns[turns.length - 1]
    if (!lastTurn || lastTurn.role !== '自分') {
      toast.show('取り消せる自分の記録がありません', 1800)
      return
    }
    confirm.show(
      '記録取り消し',
      '最後に記録した自分の送信を取り消しますか？',
      () => {
        const updatedTurns = turns.slice(0, -1)
        const hasSelfTurn = updatedTurns.some(t => t.role === '自分')
        const nextStatus: Touch['status'] = hasSelfTurn ? 'awaiting_reaction' : 'reacted'
        onReactionSaved(touch.id, {
          conversationTurns: updatedTurns,
          status: nextStatus,
          reactionReplyMode: undefined,
          reactionJudgment: undefined,
          reactionNextStep: undefined,
          reactionWarning: undefined,
          reactionReplyA: undefined,
          reactionReplyB: undefined,
          reactionDmScore: undefined,
        }, {})
        toast.show('記録を取り消しました')
      }
    )
  }

  function handleCopyS1ActionPrompt() {
    if (!prompts.S1_ACTION) return
    const prompt = buildS1ActionPrompt(pipelineItem, touch, prompts.S1_ACTION)
    copyText(prompt, () => {
      setS1ActionCopyState('copied')
      setS1ActionInputOpen(true)
      setTimeout(() => setS1ActionCopyState('idle'), 2000)
    })
  }

  function handleParseS1Action() {
    setS1ActionError(null)
    const parsed = parseS1ActionOutput(s1ActionOutput)
    if (!parsed) {
      setS1ActionError('AI出力の形式が認識できませんでした。===S1ACTION_START=== から ===S1ACTION_END=== まで含めて貼り付けてください。')
      return
    }
    setS1ActionParsed(parsed)
    const pipelineUpdates: Partial<PipelineItem> = {}
    const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
    if (parsed.judgment === '休眠') {
      pipelineUpdates.state = 'sleeping'
      pipelineUpdates.recontact_date = addDays(parsed.waitDays ?? 30)
    } else if (parsed.judgment === '保管') {
      pipelineUpdates.state = 'archived'
      pipelineUpdates.recontact_date = addDays(parsed.waitDays ?? 180)
    } else if (parsed.judgment === 'DM移行') {
      pipelineUpdates.currentStep = 'S2' as Step
      pipelineUpdates.state = 'active'
      pipelineUpdates.recontact_date = undefined
      pipelineUpdates.todayTask = undefined
    } else if ((parsed.judgment === '次投稿再接触' || parsed.judgment === 'S1継続') && parsed.waitDays && parsed.waitDays > 0) {
      pipelineUpdates.state = 'waiting'
      pipelineUpdates.recontact_date = addDays(parsed.waitDays)
    }
    // 0日後（今日）判定: 休眠・保管以外でwaitDaysが0または未指定のもの
    const s1IsToday = parsed.judgment !== '休眠' && parsed.judgment !== '保管' && !(parsed.waitDays && parsed.waitDays > 0)
    if (s1IsToday && parsed.nextStep) {
      pipelineUpdates.todayTask = { action: parsed.nextStep, addedAt: todayStr() }
    }
    if (parsed.temperature !== undefined) {
      pipelineUpdates.temperature = parsed.temperature
    }
    onReactionSaved(touch.id, {
      reactionJudgment: parsed.judgment,
      reactionNextStep: parsed.nextStep,
      reactionWarning: parsed.warning,
      reactionReplyMode: parsed.replyMode,
      reactionReplyA: parsed.replyA,
      reactionReplyB: parsed.replyB,
      reactionDmScore: parsed.dmScore,
    }, pipelineUpdates)
    setS1ActionOutput('')
    setS1ActionInputOpen(false)
  }

  function handleRedoS1Action() {
    setS1ActionParsed(null)
    setS1ActionInputOpen(true)
    setS1ActionOutput('')
    setS1ActionError(null)
    setS1ActualSentText('')
    setS1EditReasonForRecord('')
    onReactionSaved(touch.id, {
      reactionJudgment: undefined,
      reactionNextStep: undefined,
      reactionWarning: undefined,
      reactionReplyMode: undefined,
      reactionReplyA: undefined,
      reactionReplyB: undefined,
      reactionDmScore: undefined,
    } as Partial<Touch>, {})
  }

  function handleRecordS1Reply(mode: 'text' | 'like_only' = 'text') {
    const text = mode === 'like_only' ? '❤️ いいねのみ' : s1ActualSentText.trim()
    if (!text) return
    const judgment = s1JudgmentResult?.judgment || ''
    if (mode === 'text') navigator.clipboard.writeText(text).catch(() => {})
    const now = new Date().toISOString()

    if (judgment === 'DM移行') {
      const newTouch: Touch = {
        id: uid(), date: now,
        targetPostText: '（DM）', targetPostType: 'その他', targetValidity: '未評価',
        aiSuggestedText: '', actualSentText: text, editReason: s1EditReasonForRecord || '',
        messageValidity: '未判定', status: 'reacted',
        reactionType: '未記録', reactionNote: '', reactionReplyMode: mode,
        touchMode: 'conversation', threadEntry: 's3_direct', threadStatus: mode === 'like_only' ? 'inactive' : 'active',
        conversationTurns: [{
          id: uid(), role: '自分', text,
          timestamp: now, channel: 'DM', sentStatus: mode === 'like_only' ? 'skipped' : 'sent', sentAt: now,
        } as ConversationTurn],
        dmExchangeCount: 0, repExchangeCount: 0,
      }
      onAddNewTouch(newTouch, { currentStep: 'S2' as Step, state: 'active', recontact_date: undefined, todayTask: undefined })
      setS1ActualSentText('')
      setS1EditReasonForRecord('')
      return
    }

    const continuationTurn: ConversationTurn = {
      id: uid(), role: '自分', text,
      editReason: mode === 'like_only'
        ? (s1EditReasonForRecord || '文字返信はせず、いいねのみで反応')
        : (s1EditReasonForRecord || undefined),
      timestamp: now, channel: 'リプ', sentStatus: mode === 'like_only' ? 'skipped' : 'sent', sentAt: now,
    }
    const shouldClearTodayTask = !!pipelineItem.todayTask || (pipelineItem.recontact_date != null && pipelineItem.recontact_date <= todayStr())
    setS1ActionParsed(null)
    setS1ActionInputOpen(false)
    setS1ActualSentText('')
    setS1EditReasonForRecord('')
    onReactionSaved(touch.id, {
      conversationTurns: [...(touch.conversationTurns || []), continuationTurn],
      status: mode === 'like_only' ? 'reacted' : 'awaiting_reaction',
      reactionType: '未記録',
      reactionNote: '',
      reactionReplyMode: mode,
      reactionJudgment: undefined,
      reactionNextStep: undefined,
      reactionWarning: undefined,
      reactionReplyA: undefined,
      reactionReplyB: undefined,
    }, shouldClearTodayTask ? { todayTask: undefined, recontact_date: undefined } : {})
  }

  function handleCopyDMJudgPrompt(turnId: string) {
    if (!prompts.DM_JUDGE) return
    const turns = touch.conversationTurns || []
    const turnIndex = turns.findIndex(t => t.id === turnId)
    if (turnIndex < 0) return
    const prompt = buildDMJudgmentPrompt(pipelineItem, touch, turnIndex, prompts.DM_JUDGE)
    copyText(prompt, () => {
      setDmJudgCopyState('copied')
      setDmJudgTurnId(turnId)
      setTimeout(() => setDmJudgCopyState('idle'), 2000)
    })
  }

  function handleParseDMJudg() {
    setDmJudgError(null)
    const parsed = parseDMJudgmentOutput(dmJudgOutput)
    if (!parsed) {
      setDmJudgError('AI出力の形式が認識できませんでした。===DM_JUDGMENT_START=== 〜 ===DM_JUDGMENT_END=== を含めて貼り付けてください。')
      return
    }
    if (!dmJudgTurnId) return
    const turns = touch.conversationTurns || []
    const updatedTurns = turns.map(t => t.id === dmJudgTurnId ? {
      ...t,
      dmMsgJudgment: parsed.judgment,
      dmMsgJudgmentReason: parsed.reason,
      dmMsgImprovementSuggestion: parsed.improvementSuggestion,
      dmMsgImprovedText: parsed.improvedText,
    } : t)
    onReactionSaved(touch.id, { conversationTurns: updatedTurns }, {})
    setDmJudgOutput('')
    setDmJudgTurnId(null)
  }

  async function handleCopyTouchJudgPrompt() {
    setTouchJudgError(null)
    const aiText = touch.aiSuggestedText || ''
    const aMatch = aiText.match(/A:\s*([\s\S]*?)(?=\nB:|$)/)
    const bMatch = aiText.match(/B:\s*([\s\S]*)/)
    const suggestedA = aMatch?.[1]?.trim() ?? aiText
    const suggestedB = bMatch?.[1]?.trim() ?? ''
    try {
      const prompt = await buildJudgmentPrompt({
        targetPostText: touch.targetPostText || '',
        targetPostType: touch.targetPostType || '',
        suggestedTextA: suggestedA,
        suggestedTextB: suggestedB,
        actualSentText: touch.actualSentText || '',
        editReason: touch.editReason || '',
      })
      await copyText(prompt)
      setTouchJudgCopyState('copied')
      setTimeout(() => setTouchJudgCopyState('idle'), 2000)
    } catch {
      setTouchJudgError('コピーに失敗しました')
    }
  }

  function handleParseTouchJudg() {
    setTouchJudgError(null)
    const parsed = parseJudgmentOutput(touchJudgOutput)
    if (!parsed) {
      setTouchJudgError('AI出力の形式が認識できませんでした。===JUDGMENT_START=== から ===JUDGMENT_END=== まで含めて貼り付けてください。')
      return
    }
    const isFirstJudgment = !touch.messageValidity || touch.messageValidity === '未判定' || touch.messageValidity === '未評価'
    if (isFirstJudgment) {
      onReactionSaved(touch.id, {
        messageValidity: parsed.judgment,
        judgmentReason: parsed.judgmentReason,
        editEvaluation: parsed.editEvaluation,
        editComment: parsed.editComment,
        improvementSuggestion: parsed.improvementSuggestion,
        improvedText: parsed.improvedText,
        judgedAt: new Date().toISOString(),
        mainJudgmentModel: touchJudgModelName || undefined,
      }, {})
    } else {
      const newSub: SubJudgment = {
        modelName: touchJudgModelName || 'モデル不明',
        judgment: parsed.judgment,
        judgmentReason: parsed.judgmentReason,
        improvementSuggestion: parsed.improvementSuggestion,
        improvedText: parsed.improvedText,
        judgedAt: new Date().toISOString(),
      }
      onReactionSaved(touch.id, {
        subJudgments: [...(touch.subJudgments || []), newSub],
      }, {})
    }
    setTouchJudgOutput('')
    setTouchJudgModelName('')
    setTouchJudgError(null)
  }

  async function handleCopyMsgPrompt() {
    if (!prompts.PHENOMENON_FUTURE) return
    const prompt = buildPhenomenonFuturePrompt(pipelineItem, touch, prompts.PHENOMENON_FUTURE)
    try {
      await copyText(prompt)
      setMsgCopyState('copied')
      setTimeout(() => setMsgCopyState('idle'), 2000)
    } catch {
      setMsgCopyState('idle')
    }
  }

  function handleParseMsgOutput() {
    const parsed = parsePhenomenonFutureOutput(msgOutput)
    if (!parsed) return
    setMsgParsed(parsed)
  }

  async function handleCopyOs2CpPrompt() {
    if (!prompts.OS2) return
    const prompt = buildOS2ConversationPrompt(pipelineItem, touch, prompts.OS2)
    try {
      await copyText(prompt)
      setOs2CpCopyState('copied')
      setTimeout(() => setOs2CpCopyState('idle'), 2000)
    } catch {
      setOs2CpCopyState('idle')
    }
  }

  function handleParseOs2Cp() {
    const parsed = parseOS2CheckpointOutput(os2CpOutput)
    if (!parsed) return
    setOs2CpParsed(parsed)
    const directive = parsed.stateDirective
    if (!directive) return

    const stateLabel = directive.state === 'sleeping'
      ? '休眠'
      : directive.state === 'archived'
        ? '保管'
        : 'クローズ'
    const recontactLabel = directive.recontactDate ? `（再接触日: ${directive.recontactDate}）` : ''
    confirm.show(
      'OS②状態反映',
      `判定=${stateLabel} です。state と再接触日を反映します${recontactLabel ? ` ${recontactLabel}` : ''}か？`,
      () => {
        if (directive.state === 'closed') {
          onCloseCaseAuto(parsed.judgment || 'クローズ')
          return
        }
        onReactionSaved(touch.id, {}, {
          state: directive.state,
          recontact_date: directive.recontactDate || undefined,
        })
        toast.show(
          directive.state === 'sleeping'
            ? `「${pipelineItem.accountName}」を休眠として反映しました`
            : `「${pipelineItem.accountName}」を保管として反映しました`
        )
      }
    )
  }

  function handleAddSelfTurn() {
    const resolvedText = draftText.trim() || (isMsgLikeOnly ? '❤️ いいねのみ' : '')
    if (!resolvedText) return
    const isLikeOnlyTurn = isMsgLikeOnly && !draftText.trim()
    const newTurn: ConversationTurn = {
      id: uid(),
      role: '自分',
      text: resolvedText,
      editReason: isLikeOnlyTurn ? (draftEditReason || '本文返信は送らず、いいねのみ') : (draftEditReason || undefined),
      timestamp: new Date().toISOString(),
      channel: draftChannel,
      sentStatus: isLikeOnlyTurn ? 'skipped' : 'sent',
      sentAt: new Date().toISOString(),
      ...(msgParsed ? {
        dmConversationState: msgParsed.purpose,
        dmSuggestedA: msgParsed.suggestedA,
        dmSuggestedB: msgParsed.suggestedB,
        dmNextAim: msgParsed.aim,
        dmRawOutput: msgParsed.rawOutput,
      } : {}),
      ...(os2CpParsed ? {
        os2Judgment: os2CpParsed.judgment,
        os2NextAction: os2CpParsed.nextAction,
        os2Warning: os2CpParsed.warning,
        os2RawOutput: os2CpParsed.rawOutput,
      } : {}),
    }
    const isRep = draftChannel === 'リプ'
    const updatedTurns = [...(touch.conversationTurns || []), newTurn]
    const touchUpdates: Partial<Touch> = {
      conversationTurns: updatedTurns,
      repExchangeCount: isRep ? (touch.repExchangeCount || 0) + 1 : touch.repExchangeCount,
      dmExchangeCount: !isRep ? (touch.dmExchangeCount || 0) + 1 : touch.dmExchangeCount,
      status: isLikeOnlyTurn ? 'reacted' : 'awaiting_reaction',
      ...(os2CpParsed ? {
        os2Judgment: os2CpParsed.judgment,
        os2NextAction: os2CpParsed.nextAction,
      } : {}),
    }
    const pipelineUpdates: Partial<PipelineItem> = {}
    if (os2CpParsed) {
      pipelineUpdates.judgment = os2CpParsed.judgment || null
      pipelineUpdates.nextAction = os2CpParsed.nextAction || null
      if (os2CpParsed.judgment === '休眠') {
        pipelineUpdates.state = 'sleeping'
        const d = new Date(); d.setDate(d.getDate() + 30)
        pipelineUpdates.recontact_date = d.toISOString().slice(0, 10)
      } else if (os2CpParsed.judgment === '保管') {
        pipelineUpdates.state = 'archived'
        const d = new Date(); d.setDate(d.getDate() + 180)
        pipelineUpdates.recontact_date = d.toISOString().slice(0, 10)
      } else if (os2CpParsed.judgment === 'クローズ') {
        pipelineUpdates.state = 'closed'
      } else if (os2CpParsed.judgment.startsWith('前進') || os2CpParsed.judgment === '前進') {
        pipelineUpdates.currentStep = advanceStep(pipelineItem.currentStep)
      }
      // deadline が「今日」系のテキストなら今日やることリストに追加
      const cpDeadline = os2CpParsed.deadline || ''
      if (/今日|本日|即日|当日|^0日/.test(cpDeadline) && os2CpParsed.nextAction) {
        pipelineUpdates.todayTask = { action: os2CpParsed.nextAction, addedAt: todayStr() }
      }
    }
    // OS_現象未来 の「次のアクション」から再接触日をセット
    if (msgParsed?.recontactDays != null) {
      const d = new Date()
      d.setDate(d.getDate() + msgParsed.recontactDays)
      pipelineUpdates.recontact_date = d.toISOString().slice(0, 10)
      pipelineUpdates.state = 'waiting'
    }
    // OS_現象未来 の「返信パターン判定」から temperature と last_reaction をセット
    if (msgParsed?.reactionPattern) {
      const tempMap: Record<string, number> = { '反応なし': 0, '❤️': 10, '温度20': 20, 'いいねのみ': 20, '温度50': 50, '温度80以上': 80, '否定': 0 }
      const lrMap: Record<string, 'none' | 'heart' | 'temp20' | 'temp50' | 'temp80' | 'negative'> = {
        '反応なし': 'none', '❤️': 'heart', '温度20': 'temp20', 'いいねのみ': 'temp20', '温度50': 'temp50', '温度80以上': 'temp80', '否定': 'negative',
      }
      const temp = tempMap[msgParsed.reactionPattern]
      if (temp !== undefined) pipelineUpdates.temperature = temp
      const lr = lrMap[msgParsed.reactionPattern]
      if (lr) { pipelineUpdates.last_reaction = lr; pipelineUpdates.last_reaction_at = new Date().toISOString() }
    }
    onReactionSaved(touch.id, touchUpdates, pipelineUpdates)
    setDraftText('')
    setDraftEditReason('')
    setMsgOutput('')
    setMsgParsed(null)
    setOs2CpOutput('')
    setOs2CpParsed(null)
    setShowOs2Cp(false)
    setDraftChannel(pipelineItem.currentStep === 'S1' ? 'リプ' : 'DM')
  }

  function handleAddReplyTurn() {
    if (!newReplyText.trim()) return
    const replyTurn: ConversationTurn = {
      id: uid(),
      role: '相手',
      text: newReplyText,
      timestamp: new Date().toISOString(),
      channel: newReplyChannel,
      sentStatus: 'sent',
    }
    const touchUpdates: Partial<Touch> = {
      conversationTurns: [...(touch.conversationTurns || []), replyTurn],
      status: 'awaiting_reaction',
    }
    onReactionSaved(touch.id, touchUpdates, {})
    setNewReplyText('')
    setAddingReply(false)
  }

  const dateStr = new Date(touch.date).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '/')
  const isMicroPositive = selectedReaction.some(r => ['いいね返り', 'フォロー返し', 'スタンプ・絵文字'].includes(r))
  const isNoReaction = selectedReaction.includes('無反応')
  const isR5 = selectedReaction.includes('公開拒絶（R5）')
  const isTextReply = selectedReaction.includes('テキスト返信')
  const isDMTouch = touch.targetPostText === '（DM）' || touch.touchMode === 'conversation'
  const targetHandle = normalizeHandle(pipelineItem.url)
  const xSearchUrl = !touch.commentUrl && !isDMTouch && myXHandle && targetHandle && (pipelineItem.channel === 'twitter' || !pipelineItem.channel)
    ? buildXSearchUrl(myXHandle, targetHandle, touch.actualSentText)
    : undefined

  // messageValidity display: treat '未評価' as '未判定' for backward compat
  const displayMsgValidity = (!touch.messageValidity || touch.messageValidity === '未評価') ? '未判定' : touch.messageValidity

  useEffect(() => {
    setPostUrlInput(touch.postUrl || '')
    setCommentUrlInput(touch.commentUrl || '')
  }, [touch.postUrl, touch.commentUrl])

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
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${validityBadge(displayMsgValidity)}`}>文{displayMsgValidity}</span>
          {!isAwaiting && toReactionArr(touch.reactionType).map((r, i) => (
            <span key={i} className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${reactionBadge(r)}`}>{r}</span>
          ))}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button className="text-[10px] text-slate-400 hover:text-indigo-500 px-1.5 py-0.5 rounded transition" onClick={() => setDetailOpen(v => !v)}>
              詳細{detailOpen ? '▲' : '▼'}
            </button>
            {role === 'admin' && !isAwaiting && (
              <button
                className="text-slate-300 hover:text-indigo-500 p-1 rounded transition min-h-[28px] min-w-[28px] flex items-center justify-center"
                title="反応を編集"
                onClick={handleOpenEditReaction}
              >
                <i className="fa-solid fa-pen text-[10px]" />
              </button>
            )}
            {role === 'admin' && (
              <button className="text-slate-300 hover:text-rose-500 p-1 rounded transition min-h-[28px] min-w-[28px] flex items-center justify-center" onClick={onDelete}>
                <i className="fa-solid fa-trash text-[10px]" />
              </button>
            )}
          </div>
        </div>

        {/* URL導線ボタン */}
        {!isDMTouch && (touch.postUrl || touch.commentUrl || xSearchUrl) && (
          <div className="flex gap-1 flex-wrap">
            {touch.postUrl && (
              <a
                href={touch.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-sec text-[10px] py-0.5 px-1.5"
              >
                <i className="fa-solid fa-newspaper text-amber-500 mr-0.5" />対象投稿を開く
              </a>
            )}
            {touch.commentUrl ? (
              <a
                href={touch.commentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-sec text-[10px] py-0.5 px-1.5"
              >
                <i className="fa-solid fa-comment text-indigo-400 mr-0.5" />自分のコメントを開く
              </a>
            ) : xSearchUrl ? (
              <a
                href={xSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-sec text-[10px] py-0.5 px-1.5"
              >
                <i className="fa-brands fa-x-twitter text-slate-600 mr-0.5" />自分のコメントを検索
              </a>
            ) : null}
            {role === 'admin' && (
              <button
                type="button"
                className="btn-sec text-[10px] py-0.5 px-1.5"
                onClick={() => setEditingLinks(v => !v)}
              >
                <i className="fa-solid fa-link mr-0.5 text-slate-400" />URL編集
              </button>
            )}
          </div>
        )}
        {!isDMTouch && role === 'admin' && !(touch.postUrl || touch.commentUrl || xSearchUrl) && (
          <div className="flex gap-1 flex-wrap">
            <button
              type="button"
              className="btn-sec text-[10px] py-0.5 px-1.5"
              onClick={() => setEditingLinks(v => !v)}
            >
              <i className="fa-solid fa-link mr-0.5 text-slate-400" />URLを追加
            </button>
          </div>
        )}
        {!isDMTouch && editingLinks && (
          <div className="mt-1 flex flex-col gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500">投稿URL</label>
              <input
                type="text"
                className="input-base text-xs py-1.5"
                placeholder="https://..."
                value={postUrlInput}
                onChange={e => setPostUrlInput(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500">コメントURL</label>
              <input
                type="text"
                className="input-base text-xs py-1.5"
                placeholder="https://..."
                value={commentUrlInput}
                onChange={e => setCommentUrlInput(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-sec text-xs py-1.5 flex-1"
                onClick={() => {
                  setEditingLinks(false)
                  setPostUrlInput(touch.postUrl || '')
                  setCommentUrlInput(touch.commentUrl || '')
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn-primary text-xs py-1.5 flex-1 justify-center"
                onClick={() => {
                  onReactionSaved(touch.id, {
                    postUrl: postUrlInput.trim() || undefined,
                    commentUrl: commentUrlInput.trim() || undefined,
                  }, {})
                  setEditingLinks(false)
                }}
              >
                <i className="fa-solid fa-check mr-1" />URL保存
              </button>
            </div>
          </div>
        )}

        {/* 会話フロー表示 */}
        {(() => {
          const postDisplay = touch.targetPostRawText || touch.targetPostText
          return (
            <div className="flex flex-col gap-2">
              {/* 相手の投稿（リプタッチのみ） */}
              {!isDMTouch && postDisplay && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-bold text-slate-400 tracking-widest uppercase">相手の投稿</span>
                  <div className="border-l-[3px] border-slate-200 pl-2.5">
                    <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap line-clamp-3">
                      {postDisplay}
                    </p>
                  </div>
                </div>
              )}

              {/* 矢印 */}
              {!isDMTouch && postDisplay && (
                <div className="flex items-center gap-1.5 pl-1 text-slate-300">
                  <i className="fa-solid fa-arrow-turn-down text-[9px]" />
                  <span className="text-[9px] font-medium">コメント</span>
                </div>
              )}

              {/* 自分のコメント / DM */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold text-indigo-400 tracking-widest uppercase">
                  {isDMTouch ? '自分のDM' : '自分のコメント'}
                </span>
                <div className="border-l-[3px] border-indigo-300 pl-2.5">
                  <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap line-clamp-3">{touch.actualSentText}</p>
                </div>
              </div>

              {/* 相手の返信 */}
              {touch.reactionNote && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-bold text-slate-400 tracking-widest uppercase">相手の返信</span>
                  <div className="border-l-[3px] border-slate-200 pl-2.5">
                    <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">{touch.reactionNote}</p>
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* reaction status */}
        {isAwaiting && !recordingReaction && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">⏳ 反応待ち</span>
            <button className="text-xs text-indigo-600 font-semibold hover:text-indigo-800 transition min-h-[32px] px-2" onClick={handleStartReaction}>
              反応を記録 →
            </button>
          </div>
        )}

        {/* reaction edit form */}
        {editingReaction && (
          <div className="mt-2 flex flex-col gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-amber-700"><i className="fa-solid fa-pen mr-1" />反応を編集</p>
              <button
                className="text-[10px] text-slate-400 hover:text-slate-600"
                onClick={() => { setEditingReaction(false); setEditReactionType([]); setEditReactionNote('') }}
              >キャンセル</button>
            </div>
            <p className="text-xs font-bold text-slate-700">反応の種類</p>
            <div className="flex flex-wrap gap-1.5">
              {REACTION_TYPES.map(r => (
                <Chip
                  key={r}
                  label={r}
                  selected={editReactionType.includes(r)}
                  onClick={() => setEditReactionType(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])}
                />
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">補足・返信テキスト（任意）</label>
              <textarea
                rows={3}
                className="input-base cs text-xs resize-y"
                placeholder="相手の返信テキストや補足メモ（任意）"
                value={editReactionNote}
                onChange={e => setEditReactionNote(e.target.value)}
              />
            </div>
            <button
              className="btn-primary text-xs py-2.5 justify-center"
              disabled={editReactionType.length === 0}
              style={{ background: editReactionType.length > 0 ? '#4f46e5' : undefined }}
              onClick={handleSaveEditedReaction}
            >
              <i className="fa-solid fa-check mr-1" />上書き保存
            </button>
          </div>
        )}

        {/* os2 judgment result (reacted) */}
        {!isAwaiting && touch.os2Judgment && touch.threadStatus !== 'active' && (
          <div className={`mt-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold ${hasReaction(touch.reactionType, 'テキスト返信') ? 'bg-violet-50 text-violet-700' : touch.os2Judgment.startsWith('休眠') ? 'bg-slate-50 text-slate-500' : touch.os2Judgment.startsWith('保管') ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-700'}`}>
            → {touch.os2Judgment}
          </div>
        )}

        {/* S1行動判定セクション */}
        {!isAwaiting && (!touch.threadEntry || touch.threadEntry === 's1_story_reply' || touch.threadEntry === 'inbound') && (() => {
          const saved = touch.reactionJudgment
          const result = s1ActionParsed || (saved ? {
            judgment: saved,
            nextStep: touch.reactionNextStep || '',
            warning: touch.reactionWarning || '',
            reason: '',
            replyA: touch.reactionReplyA,
            replyB: touch.reactionReplyB,
          } : null)
          const judgmentColor = (j: string) => {
            if (j === 'S1継続' || j === '公開リプ継続') return 'bg-violet-50 border-violet-200 text-violet-800'
            if (j === 'DM移行') return 'bg-indigo-50 border-indigo-200 text-indigo-800'
            if (j === '次投稿再接触') return 'bg-blue-50 border-blue-200 text-blue-800'
            if (j === '休眠') return 'bg-slate-50 border-slate-200 text-slate-600'
            if (j === '保管') return 'bg-purple-50 border-purple-200 text-purple-700'
            if (j === 'クローズ') return 'bg-rose-50 border-rose-200 text-rose-700'
            return 'bg-slate-50 border-slate-200 text-slate-700'
          }
          const hasReplies = (result?.judgment === 'S1継続' || result?.judgment === '公開リプ継続' || result?.judgment === 'DM移行') && (result?.replyA || result?.replyB || result?.replyMode === 'like_only')
          const replyModeLabel = result?.replyMode === 'like_only'
            ? '返信方法：いいねのみ'
            : result?.replyMode === 'text'
              ? '返信方法：テキスト返信'
              : result?.replyMode === 'none'
                ? '返信方法：なし'
                : ''
          const sentLabel = result?.replyMode === 'like_only' ? '実際に送った反応' : '実際に送った文章'
          const sentPlaceholder = result?.replyMode === 'like_only'
            ? 'いいねのみなら空欄のままでもOK。下の「いいねだけで記録」ボタンを使えます。'
            : '「使う」で転記、または直接入力'
          return (
            <div className="mt-1 flex flex-col gap-1.5">
              {result ? (
                <>
                  <div className={`rounded-xl border px-3 py-2 text-xs flex flex-col gap-1 ${judgmentColor(result.judgment)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold">→ {result.judgment}</p>
                      <button
                        className="text-[10px] text-slate-400 hover:text-rose-500 border border-slate-200 hover:border-rose-300 rounded px-1.5 py-0.5 transition shrink-0"
                        onClick={handleRedoS1Action}
                        title="行動判定をやり直す"
                      >やり直し入力</button>
                      {(touch.reactionReplyMode || touch.reactionJudgment || touch.reactionNextStep) && (
                        <button
                          className="text-[10px] text-slate-400 hover:text-rose-500 border border-slate-200 hover:border-rose-300 rounded px-1.5 py-0.5 transition shrink-0"
                          onClick={handleUndoSelfRecord}
                          title="最後に記録した自分の送信を取り消す"
                        >記録を取り消す</button>
                      )}
                    </div>
                    {result.nextStep && <p className="text-[11px] opacity-80">{result.nextStep}</p>}
                    {replyModeLabel && <p className="text-[11px] font-semibold opacity-80">{replyModeLabel}</p>}
                    {result.warning && result.warning !== 'なし' && (
                      <p className="text-[11px] text-rose-600 font-medium">⚠ {result.warning}</p>
                    )}
                  </div>
                  {hasReplies && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">AIの提案文（「使う」で下欄に転記）</p>
                      {result.replyA && (
                        <div className="bg-white border border-violet-200 rounded-xl px-3 py-2 flex items-start gap-2">
                          <span className="text-[10px] font-bold text-violet-500 shrink-0 mt-0.5">案A</span>
                          <p className="text-[11px] text-slate-700 flex-1 leading-relaxed whitespace-pre-wrap">{result.replyA}</p>
                          <button
                            className={`shrink-0 text-xs px-2.5 py-1 rounded-lg font-semibold transition min-h-[28px] ${s1ReplyACopyState === 'copied' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'}`}
                            onClick={() => { setS1ActualSentText(result.replyA || ''); setS1ReplyACopyState('copied'); setTimeout(() => setS1ReplyACopyState('idle'), 1500) }}
                          >
                            {s1ReplyACopyState === 'copied' ? '✓ 転記' : '使う'}
                          </button>
                        </div>
                      )}
                      {result.replyB && (
                        <div className="bg-white border border-violet-200 rounded-xl px-3 py-2 flex items-start gap-2">
                          <span className="text-[10px] font-bold text-violet-500 shrink-0 mt-0.5">案B</span>
                          <p className="text-[11px] text-slate-700 flex-1 leading-relaxed whitespace-pre-wrap">{result.replyB}</p>
                          <button
                            className={`shrink-0 text-xs px-2.5 py-1 rounded-lg font-semibold transition min-h-[28px] ${s1ReplyBCopyState === 'copied' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'}`}
                            onClick={() => { setS1ActualSentText(result.replyB || ''); setS1ReplyBCopyState('copied'); setTimeout(() => setS1ReplyBCopyState('idle'), 1500) }}
                          >
                            {s1ReplyBCopyState === 'copied' ? '✓ 転記' : '使う'}
                          </button>
                        </div>
                      )}
                      {result.replyMode === 'like_only' && !result.replyA && !result.replyB && (
                        <div className="bg-pink-50 border border-pink-100 rounded-xl px-3 py-2 text-[11px] text-pink-700">
                          文字で返さず、いいねのみで十分なケースです。
                        </div>
                      )}
                      <div className="flex flex-col gap-1.5 mt-1 pt-2 border-t border-slate-100">
                        <label className="text-xs font-semibold text-slate-700">
                          {sentLabel}
                          {result?.replyMode !== 'like_only' && <span className="text-rose-500"> *</span>}
                          {result?.replyMode === 'like_only' && <span className="text-slate-400">（任意）</span>}
                        </label>
                        <textarea
                          rows={3}
                          className="input-base cs text-xs resize-y"
                          placeholder={sentPlaceholder}
                          value={s1ActualSentText}
                          onChange={e => setS1ActualSentText(e.target.value)}
                        />
                        <label className="text-xs text-slate-500">変えた理由（任意）</label>
                        <textarea
                          rows={2}
                          className="input-base cs text-xs resize-y"
                          placeholder="AI提案から変えた場合、理由を記録"
                          value={s1EditReasonForRecord}
                          onChange={e => setS1EditReasonForRecord(e.target.value)}
                        />
                        <button
                          className="btn-primary text-xs py-2.5 justify-center"
                          disabled={!s1ActualSentText.trim()}
                          style={{ background: s1ActualSentText.trim() ? '#4f46e5' : undefined }}
                          onClick={() => handleRecordS1Reply('text')}
                        >
                          <i className="fa-solid fa-paper-plane mr-1" />送信完了として記録
                        </button>
                        <button
                          className={`btn-sec text-xs py-2.5 justify-center ${s1JudgmentResult?.replyMode === 'like_only' ? 'border-pink-300 bg-pink-50 text-pink-700' : ''}`}
                          onClick={() => handleRecordS1Reply('like_only')}
                        >
                          <i className="fa-solid fa-heart mr-1 text-pink-500" />いいねだけで記録
                        </button>
                      </div>
                    </div>
                  )}
                  {result.judgment === 'クローズ' && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex flex-col gap-2">
                      <p className="text-xs font-bold text-rose-700">この案件はクローズ対象です</p>
                      <p className="text-[11px] text-rose-600">OS③（案件検証）で会話ログを検証してください。</p>
                      <button
                        className="text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-lg px-3 py-2 transition w-full"
                        onClick={() => onCloseCaseAuto('フェードアウト')}
                      >
                        <i className="fa-solid fa-flag-checkered mr-1.5" />クローズして OS③ へ
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <button
                    className={`w-full py-2 text-xs font-semibold rounded-xl border-2 border-dashed transition ${s1ActionCopyState === 'copied' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}
                    onClick={handleCopyS1ActionPrompt}
                  >
                    <i className={`fa-solid ${s1ActionCopyState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
                    {s1ActionCopyState === 'copied' ? '✓ コピーしました' : '📋 行動判定プロンプトをコピー（次のアクションをAIに判定させる）'}
                  </button>
                  {s1ActionInputOpen && (
                    <div className="flex flex-col gap-1">
                      <textarea
                        rows={3}
                        className="input-base cs text-xs resize-y"
                        placeholder="AI出力をここに貼り付け（===S1ACTION_START=== 〜 ===S1ACTION_END===）"
                        value={s1ActionOutput}
                        onChange={e => { setS1ActionOutput(e.target.value); setS1ActionError(null) }}
                      />
                      {s1ActionError && (
                        <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1">{s1ActionError}</p>
                      )}
                      <button
                        className="btn-primary text-xs py-2 justify-center"
                        style={{ background: '#d97706' }}
                        disabled={!s1ActionOutput.trim()}
                        onClick={handleParseS1Action}
                      >
                        <i className="fa-solid fa-bolt mr-1" />判定を取り込む
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* detail accordion */}
        {detailOpen && (
          <div className="mt-1 p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex flex-col gap-2 text-xs">
            {touch.targetPostRawText && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">投稿原文（全文）</p>
                <p className="text-slate-600 whitespace-pre-wrap text-[11px] leading-relaxed">{touch.targetPostRawText}</p>
              </div>
            )}
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
            {(() => {
              const hasMain = touch.mainJudgmentModel || displayMsgValidity !== '未判定'
              const allJudgments: Array<{ modelName: string; judgment: string; judgmentReason?: string; improvementSuggestion?: string; improvedText?: string }> = []
              if (hasMain) {
                allJudgments.push({
                  modelName: touch.mainJudgmentModel || '—',
                  judgment: displayMsgValidity,
                  judgmentReason: touch.judgmentReason,
                  improvementSuggestion: touch.improvementSuggestion,
                  improvedText: touch.improvedText,
                })
              }
              if (touch.subJudgments) allJudgments.push(...touch.subJudgments)
              return allJudgments.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">各AIの判定（{allJudgments.length}件）</p>
                  {allJudgments.map((j, i) => (
                    <div key={i} className="bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500 font-medium border border-slate-200 rounded px-1.5 py-0.5">{j.modelName}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${validityBadge(j.judgment as import('../../types').TouchValidity)}`}>{j.judgment}</span>
                      </div>
                      {j.judgmentReason && <p className="text-slate-600 text-[11px]">{j.judgmentReason}</p>}
                      {j.improvementSuggestion && j.improvementSuggestion !== 'なし' && (
                        <p className="text-amber-600 text-[11px]">改善: {j.improvementSuggestion}</p>
                      )}
                      {j.improvedText && j.improvedText !== 'なし' && (
                        <p className="text-indigo-600 text-[11px]">改善案: {j.improvedText}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-400 text-[10px]">文面妥当性</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${validityBadge(displayMsgValidity)}`}>{displayMsgValidity}</span>
                </div>
              )
            })()}
            {touch.editEvaluation && (
              <div className="flex gap-2">
                <span className="text-slate-400 text-[10px] shrink-0">編集評価</span>
                <span className={`text-[10px] font-medium ${touch.editEvaluation === '適切' ? 'text-emerald-600' : touch.editEvaluation === '悪化' ? 'text-rose-600' : 'text-slate-500'}`}>{touch.editEvaluation}</span>
              </div>
            )}
            {/* OS①文面再判定（スレッドなしタッチのみ） */}
            {!touch.threadEntry && !!touch.actualSentText && (
              touchJudgOpen ? (
                <div className="flex flex-col gap-1.5 bg-white border border-violet-100 rounded-xl p-2.5 mt-0.5">
                  <button
                    className={`w-full text-xs py-1.5 px-3 rounded-lg font-semibold border transition ${touchJudgCopyState === 'copied' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-violet-300 text-violet-700 bg-white hover:bg-violet-50'}`}
                    onClick={handleCopyTouchJudgPrompt}
                  >
                    <i className={`fa-solid ${touchJudgCopyState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
                    {touchJudgCopyState === 'copied' ? '✓ コピーしました' : '文面再判定プロンプトをコピー'}
                  </button>
                  <p className="text-[10px] text-slate-400">↓ ChatGPT等に貼り付けて実行 → 出力をここに貼る</p>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-400">使用モデル（取り込むAIを選択）</label>
                    <div className="flex gap-1 flex-wrap items-center">
                      {['ChatGPT', 'Gemini', 'Claude'].map(m => (
                        <button key={m} type="button"
                          className={`text-[10px] px-2 py-0.5 rounded-md border transition ${touchJudgModelName === m ? 'border-violet-400 bg-violet-50 text-violet-700 font-semibold' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                          onClick={() => setTouchJudgModelName(m)}
                        >{m}</button>
                      ))}
                      <input
                        className="input-base cs text-[10px] py-0.5 flex-1 min-w-[70px]"
                        placeholder="その他"
                        value={['ChatGPT', 'Gemini', 'Claude'].includes(touchJudgModelName) ? '' : touchJudgModelName}
                        onChange={e => setTouchJudgModelName(e.target.value)}
                      />
                    </div>
                  </div>
                  <textarea
                    rows={2}
                    className="input-base cs text-xs resize-y"
                    placeholder="AI出力を貼り付け（===JUDGMENT_START=== 〜 ===JUDGMENT_END===）"
                    value={touchJudgOutput}
                    onChange={e => { setTouchJudgOutput(e.target.value); setTouchJudgError(null) }}
                  />
                  {touchJudgError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1">{touchJudgError}</p>}
                  <p className="text-[10px] text-slate-400">複数AIで判定する場合：取り込み後にモデルを切り替えて続けて貼り付けできます</p>
                  <div className="flex gap-1.5">
                    <button className="btn-sec text-xs py-1.5 flex-1" onClick={() => { setTouchJudgOpen(false); setTouchJudgOutput(''); setTouchJudgError(null); setTouchJudgModelName('') }}>閉じる</button>
                    <button
                      className="btn-primary text-xs py-1.5 flex-1 justify-center"
                      style={{ background: '#4f46e5' }}
                      disabled={!touchJudgOutput.trim()}
                      onClick={handleParseTouchJudg}
                    >
                      <i className="fa-solid fa-bolt mr-1" />判定を取り込む
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="text-[10px] text-slate-400 hover:text-violet-600 border border-slate-200 hover:border-violet-300 rounded-lg px-2 py-0.5 self-start transition"
                  onClick={() => setTouchJudgOpen(true)}
                >
                  {displayMsgValidity !== '未判定' ? '別モデルで追加判定' : '文章を判定する'}
                </button>
              )
            )}
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

      {/* ── thread panel (active thread) ───── */}
      {touch.threadStatus === 'active' && (() => {
        const turns = touch.conversationTurns || []
        const lastTurn = turns[turns.length - 1]
        const showOS2Section = lastTurn?.role === '相手' && !!touch.threadEntry
        const showAddReplyBtn = lastTurn?.role === '自分' && !addingReply && !!touch.threadEntry && !isLikeOnlyTouch(touch)
        const repCount = touch.repExchangeCount || 0
        const dmCount = touch.dmExchangeCount || 0

        return (
          <div className="border-t border-slate-100">
            {/* header */}
            <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
              <i className="fa-solid fa-comments text-indigo-500 text-xs" />
              <span className="text-[11px] font-bold text-indigo-700">会話スレッド</span>
              {!touch.threadEntry && repCount > 0 ? (
                <span className={`text-[10px] ml-1 font-semibold ${repCount >= 3 ? 'text-rose-500' : repCount === 2 ? 'text-amber-500' : 'text-indigo-400'}`}>
                  リプ{repCount}/3往復
                </span>
              ) : (
                <span className="text-[10px] text-indigo-400 ml-1">
                  {repCount > 0 && `リプ${repCount}往復`}
                  {repCount > 0 && dmCount > 0 && ' / '}
                  {dmCount > 0 && `DM${dmCount}往復`}
                </span>
              )}
            </div>

            {/* chat bubbles */}
            <div className="p-3 flex flex-col gap-2">
              {turns.map((turn, i) => {
                const isSelf = turn.role === '自分'
                const isLastOpponent = !isSelf && i === turns.length - 1
                const diffMs = isLastOpponent ? Date.now() - new Date(turn.timestamp).getTime() : 0
                const diffH = diffMs / (1000 * 60 * 60)
                const isR4 = diffH >= 48
                const timeLabel = isLastOpponent ? readAgoLabel(turn.timestamp) : ''

                return (
                  <div key={turn.id} className={`flex flex-col gap-0.5 ${isSelf ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                      isSelf
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                    }`}>
                      {turn.text}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                      <span>{new Date(turn.timestamp).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '/')}</span>
                      {isLastOpponent && timeLabel && (
                        <span className={isR4 ? 'text-rose-500 font-bold' : ''}>
                          ⏱ {timeLabel}
                          {isR4 && ' 🚨 R4'}
                        </span>
                      )}
                    </div>
                    {/* 変えた理由・OS²判定を自分ターンの下に表示 */}
                    {isSelf && turn.editReason && (
                      <div className="text-[10px] text-slate-400 max-w-[85%] text-right">
                        変更理由：{turn.editReason}
                      </div>
                    )}
                    {isSelf && turn.os2Judgment && (
                      <div className="text-[10px] text-indigo-500 max-w-[85%] text-right">
                        → {turn.os2Judgment}
                        {turn.os2Warning && <span className="text-rose-500 ml-1">｜NG: {turn.os2Warning}</span>}
                      </div>
                    )}
                    {/* DM文面判定 */}
                    {isSelf && !!touch.threadEntry && (
                      <div className="w-full flex flex-col gap-1 items-end">
                        {turn.dmMsgJudgment ? (
                          <>
                            <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              turn.dmMsgJudgment === '◯' ? 'bg-emerald-100 text-emerald-700' :
                              turn.dmMsgJudgment === '△' ? 'bg-amber-100 text-amber-700' :
                              'bg-rose-100 text-rose-700'
                            }`}>
                              文{turn.dmMsgJudgment}
                            </div>
                            {turn.dmMsgJudgmentReason && (
                              <p className="text-[10px] text-slate-500 max-w-[85%] text-right">{turn.dmMsgJudgmentReason}</p>
                            )}
                            {turn.dmMsgImprovedText && turn.dmMsgImprovedText !== 'なし' && (
                              <div className="max-w-[85%] bg-emerald-50 border border-emerald-100 rounded-xl px-2.5 py-2 text-[10px] text-emerald-800 text-right">
                                <p className="font-bold mb-0.5">改善案</p>
                                <p className="leading-relaxed whitespace-pre-wrap">{turn.dmMsgImprovedText}</p>
                              </div>
                            )}
                          </>
                        ) : dmJudgTurnId === turn.id ? (
                          <div className="w-full flex flex-col gap-1.5 mt-1">
                            <button
                              className={`w-full text-xs py-1.5 px-3 rounded-lg font-semibold border transition ${dmJudgCopyState === 'copied' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50'}`}
                              onClick={() => handleCopyDMJudgPrompt(turn.id)}
                            >
                              <i className={`fa-solid ${dmJudgCopyState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
                              {dmJudgCopyState === 'copied' ? '✓ コピーしました' : '📋 文面判定プロンプトをコピー'}
                            </button>
                            <textarea
                              rows={2}
                              className="input-base cs text-xs resize-y"
                              placeholder="AI出力を貼り付け（===DM_JUDGMENT_START=== 〜 ===DM_JUDGMENT_END===）"
                              value={dmJudgOutput}
                              onChange={e => { setDmJudgOutput(e.target.value); setDmJudgError(null) }}
                            />
                            {dmJudgError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1">{dmJudgError}</p>}
                            <div className="flex gap-1.5">
                              <button
                                className="btn-sec text-xs py-1.5 flex-1"
                                onClick={() => { setDmJudgTurnId(null); setDmJudgOutput(''); setDmJudgError(null) }}
                              >
                                キャンセル
                              </button>
                              <button
                                className="btn-primary text-xs py-1.5 flex-1 justify-center"
                                style={{ background: '#4f46e5' }}
                                disabled={!dmJudgOutput.trim()}
                                onClick={handleParseDMJudg}
                              >
                                <i className="fa-solid fa-bolt mr-1" />判定を取り込む
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="text-[10px] text-slate-400 hover:text-indigo-600 border border-slate-200 hover:border-indigo-300 rounded-lg px-2 py-0.5 transition"
                            onClick={() => { setDmJudgTurnId(turn.id); setDmJudgOutput(''); setDmJudgCopyState('idle'); setDmJudgError(null) }}
                          >
                            文章を判定する
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* S1スレッド：リプ往復上限の警告 */}
            {!touch.threadEntry && repCount >= 2 && (
              <div className="mx-3 mb-2">
                {repCount >= 3 ? (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex flex-col gap-2">
                    <p className="text-xs font-bold text-rose-700">🔴 リプ往復3回の上限に達しました</p>
                    <p className="text-[11px] text-rose-600">これ以上公開リプを続けると逆効果になる可能性があります。「タッチを追加」→「通常DM」でDM移行を記録してください。</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                    ⚠️ 次が最後の公開リプです（{repCount}/3）。DM移行を準備してください。
                  </p>
                )}
              </div>
            )}

            {/* OS_現象未来セクション（最終ターンが相手のとき常に表示） */}
            {showOS2Section && (
              <div className="mx-3 mb-3 flex flex-col gap-2">
                {/* 現象未来プロンプトコピー */}
                <button
                  className={`w-full py-2.5 text-sm font-bold rounded-xl border-2 transition ${
                    msgCopyState === 'copied'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                  onClick={handleCopyMsgPrompt}
                >
                  <i className={`fa-solid ${msgCopyState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1.5`} />
                  {msgCopyState === 'copied' ? '✓ コピーしました' : '📋 OS_現象未来プロンプトをコピー'}
                </button>
                <p className="text-[10px] text-slate-400 text-center">↓ Claude/ChatGPT等で実行 → 出力を貼る</p>
                <textarea
                  rows={3}
                  className="input-base cs text-xs resize-y"
                  placeholder="AI出力をここに貼り付け（===MSG_START=== 〜 ===MSG_END===）"
                  value={msgOutput}
                  onChange={e => setMsgOutput(e.target.value)}
                />
                <button
                  className="btn-primary text-xs py-2 justify-center"
                  style={{ background: '#4f46e5' }}
                  onClick={handleParseMsgOutput}
                  disabled={!msgOutput.trim()}
                >
                  <i className="fa-solid fa-bolt mr-1" />取り込む
                </button>

                {msgParsed && (
                  <div className="flex flex-col gap-2">
                    {/* 今回の目的・返信パターン判定バッジ */}
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      {msgParsed.purpose && (
                        <span className="font-bold px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-700">
                          目的：{msgParsed.purpose}
                        </span>
                      )}
                      {msgParsed.reactionPattern && (
                        <span className="font-bold px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-600">
                          {msgParsed.reactionPattern}
                        </span>
                      )}
                    </div>

                    {/* 提案文A/B */}
                    {(msgParsed.suggestedA || msgParsed.suggestedB) && (
                      <div className="flex flex-col gap-1.5">
                        {msgParsed.suggestedA && (
                          <div className="bg-violet-50 border border-violet-100 rounded-xl p-2.5 flex items-start gap-2">
                            <span className="text-[10px] font-bold text-violet-600 shrink-0 mt-0.5">A</span>
                            <p className="text-[11px] text-violet-700 flex-1 leading-relaxed">{msgParsed.suggestedA}</p>
                            <button
                              className="shrink-0 text-[10px] font-bold text-violet-600 border border-violet-300 rounded-lg px-2 py-1 hover:bg-violet-100 transition min-h-[28px]"
                              onClick={() => setDraftText(isMsgLikeOnly ? '❤️ いいねのみ' : msgParsed!.suggestedA)}
                            >{isMsgLikeOnly ? 'いいねのみ' : '使う'}</button>
                          </div>
                        )}
                        {msgParsed.suggestedB && msgParsed.suggestedB !== '（空欄）' && (
                          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-2.5 flex items-start gap-2">
                            <span className="text-[10px] font-bold text-indigo-600 shrink-0 mt-0.5">B</span>
                            <p className="text-[11px] text-indigo-700 flex-1 leading-relaxed">{msgParsed.suggestedB}</p>
                            <button
                              className="shrink-0 text-[10px] font-bold text-indigo-600 border border-indigo-300 rounded-lg px-2 py-1 hover:bg-indigo-100 transition min-h-[28px]"
                              onClick={() => setDraftText(isMsgLikeOnly ? '❤️ いいねのみ' : msgParsed!.suggestedB)}
                            >{isMsgLikeOnly ? 'いいねのみ' : '使う'}</button>
                          </div>
                        )}
                      </div>
                    )}
                    {isMsgLikeOnly && (
                      <div className="rounded-xl border border-pink-100 bg-pink-50 px-3 py-2 text-[11px] text-pink-700">
                        これは本文返信ではなく、いいねのみで進める判断です。
                      </div>
                    )}

                    {/* 今回の狙い・次のアクション */}
                    {msgParsed.aim && msgParsed.aim !== 'なし' && (
                      <p className="text-[11px] text-slate-500 px-1">
                        <span className="font-bold text-slate-600">今回の狙い：</span>{msgParsed.aim}
                      </p>
                    )}
                    {msgParsed.nextAction && (
                      <p className={`text-[11px] font-semibold px-1 ${msgParsed.recontactDays != null ? 'text-amber-600' : 'text-emerald-600'}`}>
                        <span className="font-bold">次のアクション：</span>{msgParsed.nextAction}
                        {msgParsed.recontactDays != null && (
                          <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            → 再接触日をセット
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                )}

                {/* OS²チェックポイント（推奨時または手動展開時） */}
                {showOs2Cp && (
                  <div className="border border-indigo-100 rounded-xl p-3 flex flex-col gap-2 bg-slate-50">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-indigo-700 flex-1">🔍 OS②チェックポイント</p>
                      <button
                        className="text-[10px] text-slate-400 hover:text-slate-600"
                        onClick={() => { setShowOs2Cp(false); setOs2CpOutput(''); setOs2CpParsed(null) }}
                      >閉じる</button>
                    </div>
                    <button
                      className={`btn-sec text-xs py-2 justify-center ${os2CpCopyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                      onClick={handleCopyOs2CpPrompt}
                    >
                      <i className={`fa-solid ${os2CpCopyState === 'copied' ? 'fa-check' : 'fa-copy'} mr-1 text-indigo-500`} />
                      {os2CpCopyState === 'copied' ? '✓ コピーしました' : 'OS②プロンプトをコピー'}
                    </button>
                    <textarea
                      rows={3}
                      className="input-base cs text-xs resize-y"
                      placeholder="OS②出力を貼り付け（【判定】〜【今やってはいけないこと】まで）"
                      value={os2CpOutput}
                      onChange={e => setOs2CpOutput(e.target.value)}
                    />
                    <button
                      className="btn-primary text-xs py-2 justify-center"
                      style={{ background: '#4f46e5' }}
                      onClick={handleParseOs2Cp}
                      disabled={!os2CpOutput.trim()}
                    >
                      <i className="fa-solid fa-bolt mr-1" />判定を取り込む
                    </button>
                    {os2CpParsed && (
                      <div className="bg-white border border-indigo-100 rounded-lg p-3 flex flex-col gap-1 text-xs">
                        <p className={`font-bold ${
                          os2CpParsed.judgment === '正常' ? 'text-emerald-600' :
                          os2CpParsed.judgment === 'クローズ' ? 'text-rose-600' :
                          os2CpParsed.judgment === '休眠' ? 'text-slate-500' :
                          os2CpParsed.judgment === '保管' ? 'text-purple-600' :
                          'text-amber-600'
                        }`}>判定：{os2CpParsed.judgment}</p>
                        {os2CpParsed.nextAction && <p className="text-slate-600">次アクション：{os2CpParsed.nextAction}</p>}
                        {os2CpParsed.warning && <p className="text-rose-600 text-[11px]">NG: {os2CpParsed.warning}</p>}
                      </div>
                    )}
                  </div>
                )}

                {/* 実際に送った文章 + 変えた理由 */}
                <div className="flex flex-col gap-2 mt-1 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-600 font-bold">{isMsgLikeOnly ? '実際に送った反応' : '実際に送った文章'}</label>
                    <div className="flex gap-1 ml-auto">
                      {(['リプ', 'DM'] as const).map(ch => (
                        <button
                          key={ch}
                          type="button"
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition ${draftChannel === ch ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
                          onClick={() => setDraftChannel(ch)}
                        >
                          {ch}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    className="input-base cs text-xs resize-y"
                    placeholder={isMsgLikeOnly ? 'いいねのみなら空欄でOK。下のボタンで反応として記録できます。' : '「使う」で入力、または手入力'}
                    value={draftText}
                    onChange={e => setDraftText(e.target.value)}
                  />
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-slate-500">変えた理由（任意）</label>
                    <textarea
                      rows={2}
                      className="input-base cs text-xs resize-y"
                      placeholder="AI提案から変えた場合、理由を記録"
                      value={draftEditReason}
                      onChange={e => setDraftEditReason(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn-primary text-xs py-2.5 justify-center"
                    onClick={handleAddSelfTurn}
                    disabled={isMsgLikeOnly ? false : !draftText.trim()}
                  >
                    <i className={`fa-solid ${isMsgLikeOnly ? 'fa-heart' : 'fa-paper-plane'} mr-1`} />
                    {isMsgLikeOnly ? 'いいねのみで追加' : '送信完了として追加'}
                  </button>
                </div>
              </div>
            )}

            {/* 相手の返信を追加 */}
            {showAddReplyBtn && (
              <div className="mx-3 mb-3">
                <button
                  className="w-full py-2.5 text-xs font-semibold text-indigo-600 border border-dashed border-indigo-200 rounded-xl hover:bg-indigo-50 transition"
                  onClick={() => { setAddingReply(true); setNewReplyChannel(pipelineItem.currentStep === 'S1' ? 'リプ' : 'DM') }}
                >
                  <i className="fa-solid fa-plus mr-1" />相手の返信を追加
                </button>
              </div>
            )}

            {addingReply && (
              <div className="mx-3 mb-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-500">相手の返信テキスト</label>
                  <div className="flex gap-1 ml-auto">
                    {(['リプ', 'DM'] as const).map(ch => (
                      <button
                        key={ch}
                        type="button"
                        className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition ${newReplyChannel === ch ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
                        onClick={() => setNewReplyChannel(ch)}
                      >
                        {ch}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={3}
                  className="input-base cs text-xs resize-y"
                  placeholder="相手が返信してきたテキスト"
                  value={newReplyText}
                  onChange={e => setNewReplyText(e.target.value)}
                />
                <div className="flex gap-2">
                  <button className="btn-sec text-xs py-2 flex-1" onClick={() => { setAddingReply(false); setNewReplyText('') }}>
                    キャンセル
                  </button>
                  <button
                    className="btn-primary text-xs py-2 flex-1 justify-center"
                    style={{ background: '#4f46e5' }}
                    disabled={!newReplyText.trim()}
                    onClick={handleAddReplyTurn}
                  >
                    <i className="fa-solid fa-check mr-1" />追加する
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── reaction recording flow ───────── */}
      {recordingReaction && (
        <div className="border-t border-slate-100 bg-slate-50 p-3 flex flex-col gap-3">
          {!isDMTouch && (touch.postUrl || touch.commentUrl || xSearchUrl) && (
            <div className="flex gap-1.5 flex-wrap">
              {touch.postUrl && (
                <a href={touch.postUrl} target="_blank" rel="noopener noreferrer" className="btn-sec text-[10px] py-1 px-2">
                  <i className="fa-solid fa-newspaper text-amber-500 mr-0.5" />前回の対象投稿
                </a>
              )}
              {touch.commentUrl ? (
                <a href={touch.commentUrl} target="_blank" rel="noopener noreferrer" className="btn-sec text-[10px] py-1 px-2">
                  <i className="fa-solid fa-comment text-indigo-400 mr-0.5" />前回の自分コメント
                </a>
              ) : xSearchUrl ? (
                <a href={xSearchUrl} target="_blank" rel="noopener noreferrer" className="btn-sec text-[10px] py-1 px-2">
                  <i className="fa-brands fa-x-twitter text-slate-600 mr-0.5" />Xで検索
                </a>
              ) : null}
            </div>
          )}
          <p className="text-xs font-bold text-slate-700">相手の反応</p>
          <div className="flex flex-wrap gap-1.5">
            {REACTION_TYPES.map(r => <Chip key={r} label={r} selected={selectedReaction.includes(r)} onClick={() => { setSelectedReaction(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]); setMsgParsed(null) }} />)}
          </div>

          {/* テキスト返信 → スレッド初期化 */}
          {isTextReply && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">相手の返信テキスト</label>
                <textarea
                  rows={3}
                  className="input-base cs text-xs resize-y"
                  placeholder="相手が返信してきたテキストを入力してください"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">チャンネル</label>
                <div className="flex gap-1">
                  {(['リプ', 'DM'] as const).map(ch => (
                    <button
                      key={ch}
                      type="button"
                      className={`text-[11px] px-3 py-1 rounded-full border font-medium transition ${initChannel === ch ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}
                      onClick={() => setInitChannel(ch)}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
              {!replyText.trim() && (
                <p className="text-[10px] text-slate-400">
                  {touch.conversationTurns && touch.conversationTurns.length > 0
                    ? '相手の返信テキストを入力してください（会話スレッドに追加されます）'
                    : '返信テキストを入力すると会話スレッドが開始されます'
                  }
                </p>
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
                  {selectedReaction.includes('フォロー返し') ? 'フォロー返しを記録' : `いいね連続：${newLikeStreak}回目`}
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
              <button className="btn-sec text-xs py-2.5 px-4 flex-1" onClick={() => { setRecordingReaction(false); setSelectedReaction([]); setReactionNote('') }}>
                キャンセル
              </button>
              <button
                className="btn-primary text-xs py-2.5 px-4 flex-1 justify-center"
                disabled={selectedReaction.length === 0}
                style={{ background: selectedReaction.length > 0 ? '#4f46e5' : undefined }}
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
