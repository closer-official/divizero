import { useState, useRef, useEffect } from 'react'
import MdPreviewModal from '../MdPreviewModal'
import { buildCaseMd, caseMdFilename } from '../../utils/mdExport'
import type { AppData, Prompts, PipelineItem, Touch, Analysis, ConversationTurn, Step } from '../../types'
import type { TouchPostType, TouchValidity, TouchReaction } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS2 } from '../../utils/parser'
import { buildPhenomenonFuturePrompt, parsePhenomenonFutureOutput, type PhenomenonFutureResult } from '../../utils/phenomenonFuturePrompt'
import { buildOS2ConversationPrompt, parseOS2CheckpointOutput, type OS2CheckpointResult } from '../../utils/os2Prompt'
import { buildTouchPrompt, parseTouchOutput } from '../../utils/touchPrompt'
import { buildS1ActionPrompt, parseS1ActionOutput, type S1ActionResult } from '../../utils/s1ActionPrompt'
import { buildDMJudgmentPrompt, parseDMJudgmentOutput, type DMJudgmentResult } from '../../utils/dmJudgmentPrompt'
import { buildJudgmentPrompt, parseJudgmentOutput } from '../../utils/judgmentPrompt'
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
  trackBadgeClass, stepsBarData, daysSince,
  uid, todayStr, hasReaction, toReactionArr, reactionDisplay,
} from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'

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
  if (s === 'sleeping') return 'bg-slate-100 text-slate-500'
  if (s === 'archived') return 'bg-purple-100 text-purple-600'
  return 'bg-rose-100 text-rose-600'
}
function stateLabel(s?: string): string {
  if (!s || s === 'active') return 'active'
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
const MSG_VALIDITY_OPTS: TouchValidity[] = ['◯', '△', '✕', '未判定']
const REACTION_TYPES: TouchReaction[] = ['テキスト返信', 'いいね返り', 'フォロー返し', 'スタンプ・絵文字', '無反応', '公開拒絶（R5）']
const CLOSE_RESULTS = ['断り', 'フェードアウト', '未読', '未到達クローズ', 'ブロック', '受注']

// ── KanbanCard ─────────────────────────────────────────────────
interface KanbanCardProps {
  item: PipelineItem
  isActive: boolean
  onClick: () => void
}
function KanbanCard({ item, isActive, onClick }: KanbanCardProps) {
  const touches = item.touches || []
  const days = daysSince(item.lastContactDate || item.startDate)
  const latestOs2 = [...touches].reverse().find(t => t.os2Judgment)
  const displayJ = latestOs2?.os2Judgment || item.judgment
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
      </div>
      <p className="text-xs font-semibold text-slate-800 leading-tight line-clamp-2">{item.accountName}</p>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
        <span>{touches.length}T</span>
        {days > 0 && <span className={days >= 7 ? 'text-amber-500 font-medium' : ''}>{days}日前</span>}
      </div>
      {displayJ && <p className={`text-[10px] mt-1 font-medium truncate ${judgmentColor(displayJ)}`}>{displayJ}</p>}
      {(item.state === 'waiting' || item.state === 'sleeping' || item.state === 'archived') && item.recontact_date && (
        <p className="text-[10px] text-amber-500 mt-0.5 truncate">↻ {item.recontact_date}</p>
      )}
    </div>
  )
}

// ── KanbanColumn ───────────────────────────────────────────────
interface KanbanColumnProps {
  label: string
  colorClass: string
  items: PipelineItem[]
  activeId: string | null
  onCardClick: (id: string) => void
}
function KanbanColumn({ label, colorClass, items, activeId, onCardClick }: KanbanColumnProps) {
  return (
    <div className="flex-shrink-0 w-44 sm:w-48 flex flex-col snap-start">
      <div className="flex items-center gap-1.5 mb-2 px-0.5">
        <p className={`text-[11px] font-bold flex-1 ${colorClass}`}>{label}</p>
        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium">{items.length}</span>
      </div>
      <div className="flex flex-col gap-1.5 min-h-[60px]">
        {items.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-100 py-6 flex items-center justify-center">
            <span className="text-[10px] text-slate-300">なし</span>
          </div>
        ) : (
          items.map(item => (
            <KanbanCard key={item.id} item={item} isActive={item.id === activeId} onClick={() => onCardClick(item.id)} />
          ))
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
}

export default function Tab2({ data, saveData, prompts, role, toast, confirm, onGoToTab3, onCloseCase }: Props) {
  const [filter, setFilter] = useState('all')
  const [drawerItemId, setDrawerItemId] = useState<string | null>(null)

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

  const active = data.pipeline.filter(p => p.isOpen)
  const warnItems = active.filter(p => (p.lastContactDate && daysSince(p.lastContactDate) >= 7) || daysSince(p.startDate) >= 30)

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
  function getColItems(key: KanbanColKey): PipelineItem[] {
    let items = active.filter(p => getColKey(p) === key)
    if (filter === 'FT') items = items.filter(p => p.track === 'FT')
    else if (filter === 'NT') items = items.filter(p => p.track === 'NT')
    else if (filter === 'warn') items = items.filter(p => warnItems.some(w => w.id === p.id))
    return items.sort((a, b) => daysSince(b.lastContactDate || b.startDate) - daysSince(a.lastContactDate || a.startDate))
  }

  function handleExportCaseMd(item: PipelineItem) {
    const content = buildCaseMd(item)
    const filename = caseMdFilename(item)
    setMdPreview({ content, filename })
  }

  function exportAllMD() {
    const items = active
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
      await navigator.clipboard.writeText(prompt)
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

  return (
    <div className="flex flex-col gap-4" style={{ animation: 'fadeIn .2s ease-out' }}>

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
          {warnItems.map(p => {
            const d30 = daysSince(p.startDate) >= 30
            return (
              <div
                key={p.id}
                className={`border rounded-xl p-3 text-xs flex items-center gap-2 cursor-pointer ${d30 ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
                onClick={() => handleWarnItemClick(p.id)}
              >
                <i className="fa-solid fa-triangle-exclamation" />
                <span className="font-bold">{p.accountName}</span>：
                {d30 ? '30日ルール発動 — 強制クローズまたは再接触' : '7日ルール発動 — 再接触するかクローズ'}
              </div>
            )
          })}
        </div>
      )}

      {/* Filter + analysis manual trigger */}
      <div className="flex gap-2 flex-wrap items-center">
        <select className="input-base text-xs py-1.5" style={{ maxWidth: 110 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">全て ({active.length})</option>
          <option value="FT">FT</option>
          <option value="NT">NT</option>
          <option value="warn">警告のみ</option>
        </select>
        <div className="ml-auto flex gap-1 shrink-0">
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

      {/* ── Kanban Board ─────────────────────────────────────────── */}
      {active.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-slate-300 gap-2">
          <i className="fa-solid fa-chart-gantt text-4xl" />
          <p className="text-sm font-medium">案件がありません</p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-3 snap-x snap-mandatory">
          {KANBAN_COLS.map(col => (
            <KanbanColumn
              key={col.key}
              label={col.label}
              colorClass={col.colorClass}
              items={getColItems(col.key)}
              activeId={drawerItemId}
              onCardClick={id => setDrawerItemId(id)}
            />
          ))}
        </div>
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
              className="absolute top-0 right-0 bottom-0 w-full max-w-lg bg-white shadow-2xl flex flex-col"
              style={{ animation: 'slideInRight .2s ease-out' }}
            >
              <div className="shrink-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-2">
                <button
                  className="text-slate-400 hover:text-slate-700 p-1 rounded transition min-h-[36px] min-w-[36px] flex items-center justify-center"
                  onClick={() => setDrawerItemId(null)}
                >
                  <i className="fa-solid fa-xmark text-sm" />
                </button>
                <p className="font-bold text-slate-800 flex-1 truncate text-sm">{drawerItem.accountName}</p>
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
                  onCloseCase={(item, result) => {
                    setDrawerItemId(null)
                    onCloseCase(item, result)
                  }}
                  onExportMd={handleExportCaseMd}
                />
              </div>
            </div>
          </div>
        )
      })()}

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
  onExportMd: (item: PipelineItem) => void
}

function CaseCard({ item, expanded, onToggle, data: _data, saveData, prompts, role, toast, confirm, onGoToTab3, onCloseCase, onExportMd }: CardProps) {
  const [addingTouch, setAddingTouch] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
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
  const [tTouchMode, setTTouchMode] = useState<'rep' | 'story' | 'dm'>('rep')
  const [tPostText, setTPostText] = useState('')
  const [tPostRawText, setTPostRawText] = useState('')
  const [tPostType, setTPostType] = useState<TouchPostType>('通常投稿')
  const [tValidity, setTValidity] = useState<TouchValidity>('未評価')
  const [tAiText, setTAiText] = useState('')
  const [tSentText, setTSentText] = useState('')
  const [tEditReason, setTEditReason] = useState('')
  const [tMsgValidity, setTMsgValidity] = useState<TouchValidity>('未判定')

  // judgment (文面再判定)
  const [tJudgmentExpanded, setTJudgmentExpanded] = useState(false)
  const [tJudgmentOutput, setTJudgmentOutput] = useState('')
  const [tJudgmentCopyState, setTJudgmentCopyState] = useState<'idle' | 'copied'>('idle')
  const [tJudgmentReason, setTJudgmentReason] = useState('')
  const [tImprovementSuggestion, setTImprovementSuggestion] = useState('')
  const [tImprovedText, setTImprovedText] = useState('')
  const [tEditEvaluation, setTEditEvaluation] = useState('')
  const [tEditComment, setTEditComment] = useState('')
  const [tJudgedAt, setTJudgedAt] = useState<string | undefined>(undefined)
  const [tJudgmentError, setTJudgmentError] = useState<string | null>(null)

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

  const latestOs2Touch = [...touches].reverse().find(t => t.os2Judgment)
  const displayJudgment = latestOs2Touch?.os2Judgment || item.judgment
  const displayNextAction = latestOs2Touch?.os2NextAction || item.nextAction
  const displayReplyA = latestOs2Touch?.os2ReplyA || item.replyA
  const displayReplyB = latestOs2Touch?.os2ReplyB || item.replyB

  function resetForm() {
    setAiOutput(''); setSuggestionA(''); setSuggestionB(''); setPJudgmentA(''); setPJudgmentB('')
    setTPostText(''); setTPostRawText(''); setTPostType('通常投稿'); setTValidity('未評価')
    setTAiText(''); setTSentText(''); setTEditReason(''); setTMsgValidity('未判定')
    setTJudgmentExpanded(false); setTJudgmentOutput(''); setTJudgmentReason('')
    setTImprovementSuggestion(''); setTImprovedText(''); setTEditEvaluation(''); setTEditComment(''); setTJudgedAt(undefined)
    setTJudgmentError(null); setAutoFillError(null); setAutoFillWarning(null)
    setSuggACopyState('idle'); setSuggBCopyState('idle')
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

  async function handleCopyJudgmentPrompt() {
    setTJudgmentError(null)
    try {
      const prompt = await buildJudgmentPrompt({
        targetPostText: tPostText,
        targetPostType: tPostType,
        suggestedTextA: suggestionA || tAiText,
        suggestedTextB: suggestionB,
        actualSentText: tSentText,
        editReason: tEditReason,
      })
      await navigator.clipboard.writeText(prompt)
      setTJudgmentExpanded(true)
      setTJudgmentCopyState('copied')
      setTimeout(() => setTJudgmentCopyState('idle'), 2000)
    } catch {
      setTJudgmentError('コピーに失敗しました。')
    }
  }

  function handleParseJudgment() {
    setTJudgmentError(null)
    const parsed = parseJudgmentOutput(tJudgmentOutput)
    if (!parsed) {
      setTJudgmentError('AI出力の形式が認識できませんでした。===JUDGMENT_START=== から ===JUDGMENT_END=== まで含めて貼り付けてください。')
      return
    }
    setTMsgValidity(parsed.judgment)
    setTJudgmentReason(parsed.judgmentReason)
    setTEditEvaluation(parsed.editEvaluation)
    setTEditComment(parsed.editComment)
    setTImprovementSuggestion(parsed.improvementSuggestion)
    setTImprovedText(parsed.improvedText)
    setTJudgedAt(new Date().toISOString())
  }

  function handleAddTouch() {
    if (!tSentText.trim()) { toast.show('実際に送った文章は必須です', 2000); return }
    const now = new Date().toISOString()
    let touch: Touch
    let pipelineUpdates: Partial<PipelineItem> = {}

    if (tTouchMode === 'dm') {
      touch = {
        id: uid(), date: now,
        targetPostText: '（DM）', targetPostType: 'その他', targetValidity: '未評価',
        aiSuggestedText: tAiText, actualSentText: tSentText, editReason: tEditReason,
        messageValidity: '未判定',
        status: 'reacted',
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
        messageValidity: tMsgValidity,
        status: 'awaiting_reaction',
        reactionType: '未記録',
        reactionNote: '',
        threadEntry: 's1_story_reply',
        judgmentReason: tJudgmentReason,
        editEvaluation: tEditEvaluation,
        editComment: tEditComment,
        improvementSuggestion: tImprovementSuggestion,
        improvedText: tImprovedText,
        judgedAt: tJudgedAt,
      }
      pipelineUpdates = { currentStep: 'S3' as Step }
    } else {
      touch = {
        id: uid(), date: now,
        targetPostText: tPostText, targetPostRawText: tPostRawText || undefined,
        targetPostType: tPostType, targetValidity: tValidity,
        aiSuggestedText: tAiText, actualSentText: tSentText, editReason: tEditReason,
        messageValidity: tMsgValidity,
        status: 'awaiting_reaction',
        reactionType: '未記録',
        reactionNote: '',
        judgmentReason: tJudgmentReason,
        editEvaluation: tEditEvaluation,
        editComment: tEditComment,
        improvementSuggestion: tImprovementSuggestion,
        improvedText: tImprovedText,
        judgedAt: tJudgedAt,
      }
    }

    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => p.id === item.id
        ? { ...p, ...pipelineUpdates, touches: [...(p.touches || []), touch], lastContactDate: todayStr() }
        : p
      ),
    }))
    resetForm()
    setAddingTouch(false)
    const msg = tTouchMode === 'dm'
      ? 'DM送信を記録しました（S3へ移動）'
      : tTouchMode === 'story'
        ? 'ストーリー返信を記録しました（S3へ移動）'
        : 'タッチを記録しました（反応待ち）'
    toast.show(msg)
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
    saveData(prev => ({
      ...prev,
      pipeline: prev.pipeline.map(p => p.id === item.id
        ? { ...p, ...(pipelineUpdates || {}), touches: [...(p.touches || []), touch], lastContactDate: todayStr() }
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
      setTimeout(() => onCloseCase(item, closeResult), 300)
    })
  }

  function handleCloseCaseFromTouch(result: string) {
    const closeDate = todayStr()
    saveData(prev => {
      const d = { ...prev, pipeline: prev.pipeline.map(p => p.id === item.id ? { ...p, isOpen: false, closedAt: closeDate } : p) }
      const pFinal = d.pipeline.find(p => p.id === item.id)!
      d.closed = [...d.closed, {
        id: uid(), pipelineId: item.id, createdAt: new Date().toISOString(),
        accountName: pFinal.accountName, track: pFinal.track,
        hypothesis: pFinal.hypothesis, startDate: pFinal.startDate,
        closeDate, result, ruleFired: false,
      }]
      return d
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
          {totalDays >= 30 && <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded shrink-0">30日超</span>}
          {totalDays < 30 && days >= 7 && <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded shrink-0">7日超</span>}
          <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-slate-300 text-xs shrink-0`} />
        </div>
        {/* 再接触日（waiting / sleeping / archived） */}
        {(item.state === 'waiting' || item.state === 'sleeping' || item.state === 'archived') && item.recontact_date && (
          <p className={`text-[11px] font-semibold mt-1 ${item.state === 'archived' ? 'text-purple-600' : 'text-amber-600'}`}>
            <i className="fa-solid fa-clock-rotate-left mr-1 text-[10px]" />再接触日: {item.recontact_date}
          </p>
        )}
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
              onClick={e => { e.stopPropagation(); copyText(displayReplyA, () => toast.show('案Aをコピーしました')) }}
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
          <div className="px-4 py-2.5 flex items-center gap-2 bg-slate-50 border-b border-slate-100">
            <StepsBar currentStep={item.currentStep} />
            <div className="ml-auto flex items-center gap-1 shrink-0">
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
                <a href={profileUrl} target="_blank" rel="noreferrer" className="btn-sec text-[11px] py-1 px-2">
                  <i className="fa-solid fa-arrow-up-right-from-square" />
                </a>
              )}
              <button className="btn-sec text-[11px] py-1 px-2" onClick={() => onExportMd(item)} title="MDでエクスポート">
                <i className="fa-solid fa-file-lines text-violet-500" />
              </button>
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
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
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
                </div>
              </div>

              {/* ① AI generation section */}
              <div className={`bg-white border rounded-xl p-3 flex flex-col gap-2 ${tTouchMode === 'dm' ? 'border-violet-200' : tTouchMode === 'story' ? 'border-pink-100' : 'border-indigo-100'}`}>
                <p className="text-xs font-bold text-indigo-700">① AIで生成</p>
                <button
                  className={`btn-sec text-xs py-2 justify-center ${copyBtnState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                  onClick={handleCopyPrompt}
                >
                  <i className={`fa-solid ${copyBtnState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
                  {copyBtnState === 'copied' ? '✓ コピーしました' : tTouchMode === 'dm' ? 'OS_現象未来プロンプトをコピー' : 'プロンプトをコピー'}
                </button>
                <p className="text-[10px] text-slate-400 text-center">
                  {tTouchMode === 'dm' ? '↓ ChatGPT等に貼り付けて実行' : '↓ ChatGPT等に貼り付け＋投稿スクショを添付して実行'}
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
                            try { await navigator.clipboard.writeText(suggestionA); setSuggACopyState('copied'); setTimeout(() => setSuggACopyState('idle'), 1500) } catch {}
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
                            try { await navigator.clipboard.writeText(suggestionB); setSuggBCopyState('copied'); setTimeout(() => setSuggBCopyState('idle'), 1500) } catch {}
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
                {tTouchMode !== 'dm' && (
                  <>
                    {tTouchMode === 'rep' && (
                      <>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">接触した投稿（要約・識別用）</label>
                          <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="相手の投稿を1行で要約" value={tPostText} onChange={e => setTPostText(e.target.value)} />
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
                      </>
                    )}
                  </>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">AIの提案文（任意）</label>
                  <textarea rows={3} className="input-base cs text-xs resize-y" placeholder={tTouchMode === 'dm' ? 'AIが提案したDM文' : 'AIが提案した文章'} value={tAiText} onChange={e => setTAiText(e.target.value)} />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-700">{tTouchMode === 'dm' ? '実際に送ったDM文' : tTouchMode === 'story' ? '実際に送ったストーリー返信文' : '実際に送った文章'} <span className="text-rose-500">*</span></label>
                  <textarea rows={3} className="input-base cs text-xs resize-y" placeholder={tTouchMode === 'dm' ? '実際に送ったDMの文章' : tTouchMode === 'story' ? '相手のストーリーへの返信として送った文章' : '実際に送ったコメント・DM文'} value={tSentText} onChange={e => setTSentText(e.target.value)} />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">変えた理由（任意）</label>
                  <textarea rows={2} className="input-base cs text-xs resize-y" placeholder="AIの提案から変更した理由" value={tEditReason} onChange={e => setTEditReason(e.target.value)} />
                </div>

                {/* 文面再判定セクション（DM以外のモード） */}
                {tTouchMode !== 'dm' && (
                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      className={`btn-sec text-xs py-2 justify-center ${!tSentText.trim() ? 'opacity-40 pointer-events-none' : ''} ${tJudgmentCopyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                      disabled={!tSentText.trim()}
                      onClick={handleCopyJudgmentPrompt}
                    >
                      <i className={`fa-solid ${tJudgmentCopyState === 'copied' ? 'fa-check' : 'fa-magnifying-glass'} mr-1`} />
                      {tJudgmentCopyState === 'copied' ? '✓ コピーしました' : 'AIに文面を判定してもらう'}
                    </button>

                    {tJudgmentExpanded && (
                      <div className="flex flex-col gap-2 bg-white border border-slate-100 rounded-xl p-3">
                        <p className="text-[10px] text-slate-400">↓ ChatGPT等に貼り付けて実行 → 出力をここに貼る</p>
                        <textarea
                          rows={3}
                          className="input-base cs text-xs resize-y"
                          placeholder="AIの判定出力をここに貼り付け（===JUDGMENT_START=== から ===JUDGMENT_END=== まで）"
                          value={tJudgmentOutput}
                          onChange={e => { setTJudgmentOutput(e.target.value); setTJudgmentError(null) }}
                        />
                        <button className="btn-primary text-xs py-2 justify-center" style={{ background: '#4f46e5' }} onClick={handleParseJudgment}>
                          <i className="fa-solid fa-bolt mr-1" />判定を取り込む
                        </button>
                        {tJudgmentError && (
                          <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{tJudgmentError}</p>
                        )}
                      </div>
                    )}

                    {tJudgmentReason && (
                      <div className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 flex flex-col gap-1 text-[11px]">
                        <p className="text-slate-400">判定理由：<span className="text-slate-700 font-medium">{tJudgmentReason}</span></p>
                        {tImprovementSuggestion && tImprovementSuggestion !== 'なし' && (
                          <p className="text-amber-600">改善提案：{tImprovementSuggestion}</p>
                        )}
                        {tImprovedText && tImprovedText !== 'なし' && (
                          <p className="text-indigo-600">改善案：{tImprovedText}</p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-500">文面妥当性</label>
                      <div className="flex flex-wrap gap-1.5">
                        {MSG_VALIDITY_OPTS.map(v => <Chip key={v} label={v} selected={tMsgValidity === v} onClick={() => setTMsgValidity(v)} />)}
                      </div>
                      {tJudgedAt && <p className="text-[10px] text-emerald-600">✓ AI判定済み（手動変更も可）</p>}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-1">
                <button className="btn-sec text-xs py-2.5 px-4 flex-1" onClick={() => { resetForm(); setAddingTouch(false) }}>キャンセル</button>
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
  onAddNewTouch: (touch: Touch, pipelineUpdates?: Partial<PipelineItem>) => void
  onCloseCaseAuto: (result: string) => void
}

function TouchItem({ touch, pipelineItem, prompts, role, onDelete, onReactionSaved, onGoToTab3, onAddNewTouch, onCloseCaseAuto }: TouchItemProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [recordingReaction, setRecordingReaction] = useState(false)
  const [selectedReaction, setSelectedReaction] = useState<TouchReaction[]>([])
  const [reactionNote, setReactionNote] = useState('')
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

  const isAwaiting = touch.status === 'awaiting_reaction'

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
    if (parsed.judgment === '休眠') {
      pipelineUpdates.state = 'sleeping'
      const d = new Date(); d.setDate(d.getDate() + 30)
      pipelineUpdates.recontact_date = d.toISOString().slice(0, 10)
    } else if (parsed.judgment === '保管') {
      pipelineUpdates.state = 'archived'
      const d = new Date(); d.setDate(d.getDate() + 180)
      pipelineUpdates.recontact_date = d.toISOString().slice(0, 10)
    }
    onReactionSaved(touch.id, {
      reactionJudgment: parsed.judgment,
      reactionNextStep: parsed.nextStep,
      reactionWarning: parsed.warning,
      reactionReplyA: parsed.replyA,
      reactionReplyB: parsed.replyB,
    }, pipelineUpdates)
    setS1ActionOutput('')
    setS1ActionInputOpen(false)
  }

  function handleUseS1Reply(text: string, judgment: string, variant: 'A' | 'B') {
    navigator.clipboard.writeText(text).catch(() => {})
    if (variant === 'A') {
      setS1ReplyACopyState('copied')
      setTimeout(() => setS1ReplyACopyState('idle'), 2000)
    } else {
      setS1ReplyBCopyState('copied')
      setTimeout(() => setS1ReplyBCopyState('idle'), 2000)
    }
    const now = new Date().toISOString()

    if (judgment === 'DM移行') {
      // DM移行：新しいDMタッチを作成 & currentStep を S3 に自動進める
      const newTouch: Touch = {
        id: uid(), date: now,
        targetPostText: '（DM）', targetPostType: 'その他', targetValidity: '未評価',
        aiSuggestedText: '', actualSentText: text, editReason: '',
        messageValidity: '未判定', status: 'reacted',
        reactionType: '未記録', reactionNote: '',
        touchMode: 'conversation', threadEntry: 's3_direct', threadStatus: 'active',
        conversationTurns: [{
          id: uid(), role: '自分', text,
          timestamp: now, channel: 'DM', sentStatus: 'sent', sentAt: now,
        } as ConversationTurn],
        dmExchangeCount: 0, repExchangeCount: 0,
      }
      onAddNewTouch(newTouch, { currentStep: 'S3' as Step })
      return
    }

    // 公開リプ継続：同じタッチに継続ターンを追加（別レコードにしない）
    const continuationTurn: ConversationTurn = {
      id: uid(), role: '自分', text,
      timestamp: now, channel: 'リプ', sentStatus: 'sent', sentAt: now,
    }
    setS1ActionParsed(null)
    setS1ActionInputOpen(false)
    onReactionSaved(touch.id, {
      conversationTurns: [...(touch.conversationTurns || []), continuationTurn],
      status: 'awaiting_reaction',
      reactionType: '未記録',
      reactionNote: '',
      reactionJudgment: undefined,
      reactionNextStep: undefined,
      reactionWarning: undefined,
      reactionReplyA: undefined,
      reactionReplyB: undefined,
    }, {})
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
      await navigator.clipboard.writeText(prompt)
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
    onReactionSaved(touch.id, {
      messageValidity: parsed.judgment,
      judgmentReason: parsed.judgmentReason,
      editEvaluation: parsed.editEvaluation,
      editComment: parsed.editComment,
      improvementSuggestion: parsed.improvementSuggestion,
      improvedText: parsed.improvedText,
      judgedAt: new Date().toISOString(),
    }, {})
    setTouchJudgOpen(false)
    setTouchJudgOutput('')
  }

  async function handleCopyMsgPrompt() {
    if (!prompts.PHENOMENON_FUTURE) return
    const prompt = buildPhenomenonFuturePrompt(pipelineItem, touch, prompts.PHENOMENON_FUTURE)
    try {
      await navigator.clipboard.writeText(prompt)
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
      await navigator.clipboard.writeText(prompt)
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
  }

  function handleAddSelfTurn() {
    if (!draftText.trim()) return
    const newTurn: ConversationTurn = {
      id: uid(),
      role: '自分',
      text: draftText,
      editReason: draftEditReason || undefined,
      timestamp: new Date().toISOString(),
      channel: draftChannel,
      sentStatus: 'sent',
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
      status: 'awaiting_reaction',
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
      const tempMap: Record<string, number> = { '反応なし': 0, '❤️': 10, '温度20': 20, '温度50': 50, '温度80以上': 80, '否定': 0 }
      const lrMap: Record<string, 'none' | 'heart' | 'temp20' | 'temp50' | 'temp80' | 'negative'> = {
        '反応なし': 'none', '❤️': 'heart', '温度20': 'temp20', '温度50': 'temp50', '温度80以上': 'temp80', '否定': 'negative',
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

  // messageValidity display: treat '未評価' as '未判定' for backward compat
  const displayMsgValidity = (!touch.messageValidity || touch.messageValidity === '未評価') ? '未判定' : touch.messageValidity

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
            {role === 'admin' && (
              <button className="text-slate-300 hover:text-rose-500 p-1 rounded transition min-h-[28px] min-w-[28px] flex items-center justify-center" onClick={onDelete}>
                <i className="fa-solid fa-trash text-[10px]" />
              </button>
            )}
          </div>
        </div>

        {/* 会話フロー表示 */}
        {(() => {
          const isDMTouch = touch.targetPostText === '（DM）' || touch.touchMode === 'conversation'
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
        {isAwaiting && !recordingReaction && (touch.threadStatus !== 'active' || !touch.threadEntry) && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">⏳ 反応待ち</span>
            <button className="text-xs text-indigo-600 font-semibold hover:text-indigo-800 transition min-h-[32px] px-2" onClick={handleStartReaction}>
              反応を記録 →
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
        {!isAwaiting && (!touch.threadEntry || touch.threadEntry === 's1_story_reply') && (() => {
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
            if (j === '公開リプ継続') return 'bg-violet-50 border-violet-200 text-violet-800'
            if (j === 'DM移行') return 'bg-indigo-50 border-indigo-200 text-indigo-800'
            if (j === '次投稿再接触') return 'bg-blue-50 border-blue-200 text-blue-800'
            if (j === '休眠') return 'bg-slate-50 border-slate-200 text-slate-600'
            if (j === '保管') return 'bg-purple-50 border-purple-200 text-purple-700'
            if (j === 'クローズ') return 'bg-rose-50 border-rose-200 text-rose-700'
            return 'bg-slate-50 border-slate-200 text-slate-700'
          }
          const hasReplies = (result?.judgment === '公開リプ継続' || result?.judgment === 'DM移行') && (result?.replyA || result?.replyB)
          return (
            <div className="mt-1 flex flex-col gap-1.5">
              {result ? (
                <>
                  <div className={`rounded-xl border px-3 py-2 text-xs flex flex-col gap-1 ${judgmentColor(result.judgment)}`}>
                    <p className="font-bold">→ {result.judgment}</p>
                    {result.nextStep && <p className="text-[11px] opacity-80">{result.nextStep}</p>}
                    {result.warning && result.warning !== 'なし' && (
                      <p className="text-[11px] text-rose-600 font-medium">⚠ {result.warning}</p>
                    )}
                  </div>
                  {hasReplies && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">送る文章</p>
                      {result.replyA && (
                        <div className="bg-white border border-violet-200 rounded-xl px-3 py-2 flex flex-col gap-1.5">
                          <p className="text-[10px] font-bold text-violet-500">案A</p>
                          <p className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap">{result.replyA}</p>
                          <button
                            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition self-start ${s1ReplyACopyState === 'copied' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'}`}
                            onClick={() => handleUseS1Reply(result.replyA!, result.judgment, 'A')}
                          >
                            {s1ReplyACopyState === 'copied' ? '✓ コピー＆タッチ追加済み' : '使う（コピー＆タッチ追加）'}
                          </button>
                        </div>
                      )}
                      {result.replyB && (
                        <div className="bg-white border border-violet-200 rounded-xl px-3 py-2 flex flex-col gap-1.5">
                          <p className="text-[10px] font-bold text-violet-500">案B</p>
                          <p className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap">{result.replyB}</p>
                          <button
                            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition self-start ${s1ReplyBCopyState === 'copied' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'}`}
                            onClick={() => handleUseS1Reply(result.replyB!, result.judgment, 'B')}
                          >
                            {s1ReplyBCopyState === 'copied' ? '✓ コピー＆タッチ追加済み' : '使う（コピー＆タッチ追加）'}
                          </button>
                        </div>
                      )}
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
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-[10px]">文面妥当性</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${validityBadge(displayMsgValidity)}`}>{displayMsgValidity}</span>
            </div>
            {touch.judgmentReason && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">判定理由</p>
                <p className="text-slate-600 text-[11px]">{touch.judgmentReason}</p>
              </div>
            )}
            {touch.improvementSuggestion && touch.improvementSuggestion !== 'なし' && (
              <div>
                <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide mb-0.5">改善提案</p>
                <p className="text-amber-700 text-[11px]">{touch.improvementSuggestion}</p>
              </div>
            )}
            {touch.improvedText && touch.improvedText !== 'なし' && (
              <div>
                <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide mb-0.5">改善案</p>
                <p className="text-indigo-700 text-[11px] whitespace-pre-wrap">{touch.improvedText}</p>
              </div>
            )}
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
                  <textarea
                    rows={2}
                    className="input-base cs text-xs resize-y"
                    placeholder="AI出力を貼り付け（===JUDGMENT_START=== 〜 ===JUDGMENT_END===）"
                    value={touchJudgOutput}
                    onChange={e => { setTouchJudgOutput(e.target.value); setTouchJudgError(null) }}
                  />
                  {touchJudgError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1">{touchJudgError}</p>}
                  <div className="flex gap-1.5">
                    <button className="btn-sec text-xs py-1.5 flex-1" onClick={() => { setTouchJudgOpen(false); setTouchJudgOutput(''); setTouchJudgError(null) }}>キャンセル</button>
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
                  {displayMsgValidity !== '未判定' ? '再判定する' : '文章を判定する'}
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
        const showAddReplyBtn = lastTurn?.role === '自分' && !addingReply && !!touch.threadEntry
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
                              onClick={() => setDraftText(msgParsed!.suggestedA)}
                            >使う</button>
                          </div>
                        )}
                        {msgParsed.suggestedB && msgParsed.suggestedB !== '（空欄）' && (
                          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-2.5 flex items-start gap-2">
                            <span className="text-[10px] font-bold text-indigo-600 shrink-0 mt-0.5">B</span>
                            <p className="text-[11px] text-indigo-700 flex-1 leading-relaxed">{msgParsed.suggestedB}</p>
                            <button
                              className="shrink-0 text-[10px] font-bold text-indigo-600 border border-indigo-300 rounded-lg px-2 py-1 hover:bg-indigo-100 transition min-h-[28px]"
                              onClick={() => setDraftText(msgParsed!.suggestedB)}
                            >使う</button>
                          </div>
                        )}
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
                    <label className="text-[11px] text-slate-600 font-bold">実際に送った文章</label>
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
                    placeholder="「使う」で入力、または手入力"
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
                    disabled={!draftText.trim()}
                  >
                    <i className="fa-solid fa-paper-plane mr-1" />✈ 送信完了として追加
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
      {recordingReaction && (touch.threadStatus !== 'active' || !touch.threadEntry) && (
        <div className="border-t border-slate-100 bg-slate-50 p-3 flex flex-col gap-3">
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
