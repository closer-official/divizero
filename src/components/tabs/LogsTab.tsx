import { useState } from 'react'
import type { AppData, LogEntry } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { uid } from '../../utils/helpers'

interface Props {
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
}

const POST_TYPES = ['課題ツイート', '通常投稿', '達成・嬉しい報告', '愚痴・本音', 'ネタ'] as const
const VALIDITY_OPTIONS = ['◯', '△', '✕', '未評価'] as const
const CHANNELS = ['Instagram', 'X', 'Threads'] as const

const validityBadgeClass = (v: string) => {
  if (v === '◯') return 'bg-emerald-100 text-emerald-700 border border-emerald-200'
  if (v === '△') return 'bg-amber-100 text-amber-700 border border-amber-200'
  if (v === '✕') return 'bg-rose-100 text-rose-700 border border-rose-200'
  return 'bg-slate-100 text-slate-500 border border-slate-200'
}

export default function LogsTab({ data, saveData, role, toast, confirm }: Props) {
  const [accountName, setAccountName] = useState('')
  const [handle, setHandle] = useState('')
  const [channel, setChannel] = useState<'Instagram' | 'X' | 'Threads'>('Instagram')
  const [sentText, setSentText] = useState('')
  const [aiGeneratedText, setAiGeneratedText] = useState('')
  const [editReason, setEditReason] = useState('')
  const [targetPostText, setTargetPostText] = useState('')
  const [targetPostType, setTargetPostType] = useState<LogEntry['targetPostType']>('')
  const [targetValidity, setTargetValidity] = useState<LogEntry['targetValidity']>('未評価')
  const [messageValidity, setMessageValidity] = useState<LogEntry['messageValidity']>('未評価')

  function handleSubmit() {
    if (!accountName || !sentText) { toast.show('アカウント名と送信文章は必須です', 2000); return }
    const entry: LogEntry = {
      id: uid(),
      accountName,
      handle,
      sentText,
      aiGeneratedText,
      editReason,
      sentAt: Date.now(),
      channel,
      targetPostText,
      targetPostType,
      targetValidity,
      messageValidity,
    }
    saveData(prev => ({ ...prev, logs: [...(prev.logs || []), entry] }))
    setAccountName(''); setHandle(''); setSentText(''); setAiGeneratedText(''); setEditReason(''); setTargetPostText('')
    setTargetPostType(''); setTargetValidity('未評価'); setMessageValidity('未評価')
    toast.show('送信ログを記録しました')
  }

  function handleDelete(id: string) {
    confirm.show('削除確認', 'このログを削除しますか？', () => {
      saveData(prev => ({ ...prev, logs: (prev.logs || []).filter(l => l.id !== id) }))
      toast.show('削除しました')
    })
  }

  function handleExportTSV() {
    const logs = data.logs || []
    if (logs.length === 0) { toast.show('ログがありません'); return }
    const headers = ['日時', 'アカウント名', 'ハンドル', 'チャンネル', '送信文章', 'AI生成文', '編集理由', '接触対象投稿', '投稿種別', '対象妥当性', '文面妥当性']
    const rows = logs.map(l => [
      new Date(l.sentAt).toLocaleString('ja-JP'),
      l.accountName, l.handle, l.channel,
      l.sentText, l.aiGeneratedText, l.editReason,
      l.targetPostText, l.targetPostType, l.targetValidity, l.messageValidity,
    ])
    const tsv = [headers, ...rows].map(r => r.map(v => v.replace(/\t/g, ' ')).join('\t')).join('\n')
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'sent_logs.tsv'; a.click()
    URL.revokeObjectURL(url)
    toast.show('TSVをダウンロードしました')
  }

  const logs = [...(data.logs || [])].reverse()

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'fadeIn .2s ease-out' }}>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900">
        <span className="font-bold"><i className="fa-solid fa-paper-plane mr-1" />送信完了履歴：</span>
        送信したDM・コメントの文章を記録・管理します。対象妥当性と文面妥当性を評価して改善サイクルを回してください。
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Input form */}
        <section className="lg:col-span-5 flex flex-col gap-3">
          <div className="card p-5 flex flex-col gap-3">
            <p className="font-bold text-sm text-slate-800 flex items-center gap-2"><i className="fa-solid fa-plus text-blue-500" />送信ログを追加</p>

            <div className="grid grid-cols-2 gap-2">
              <input className="input-base text-xs py-2" placeholder="アカウント名 *" value={accountName} onChange={e => setAccountName(e.target.value)} />
              <input className="input-base text-xs py-2" placeholder="ハンドル (@...)" value={handle} onChange={e => setHandle(e.target.value)} />
            </div>

            <div className="flex gap-2">
              {CHANNELS.map(ch => (
                <button
                  key={ch}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition flex-1 ${channel === ch ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                  onClick={() => setChannel(ch)}
                >
                  {ch === 'Instagram' && <i className="fa-brands fa-instagram mr-1" />}
                  {ch === 'X' && <i className="fa-brands fa-x-twitter mr-1" />}
                  {ch === 'Threads' && <i className="fa-brands fa-threads mr-1" />}
                  {ch}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">接触対象の投稿（要約または引用）</label>
              <textarea className="input-base h-14 cs text-xs" placeholder="この接触のきっかけになった投稿（任意）" value={targetPostText} onChange={e => setTargetPostText(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">投稿種別</label>
              <select className="input-base text-xs py-2" value={targetPostType} onChange={e => setTargetPostType(e.target.value as LogEntry['targetPostType'])}>
                <option value="">選択してください</option>
                {POST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">対象妥当性</label>
                <select className="input-base text-xs py-2" value={targetValidity} onChange={e => setTargetValidity(e.target.value as LogEntry['targetValidity'])}>
                  {VALIDITY_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <p className="text-[10px] text-slate-400">◯=課題/通常/達成 △=グレー ✕=愚痴/ネタへの営業</p>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">文面妥当性</label>
                <select className="input-base text-xs py-2" value={messageValidity} onChange={e => setMessageValidity(e.target.value as LogEntry['messageValidity'])}>
                  {VALIDITY_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <p className="text-[10px] text-slate-400">文章として適切だったか</p>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">元のAI生成文章</label>
              <textarea className="input-base h-20 cs text-xs" placeholder="AIが生成した文章（任意）" value={aiGeneratedText} onChange={e => setAiGeneratedText(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">実際に送った文章 *</label>
              <textarea className="input-base h-24 cs text-xs" placeholder="実際に送信した文章" value={sentText} onChange={e => setSentText(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">編集理由（任意）</label>
              <textarea className="input-base h-14 cs text-xs" placeholder="AIの文章から変更した場合の理由" value={editReason} onChange={e => setEditReason(e.target.value)} />
            </div>

            <button className="btn-primary w-full justify-center text-sm" style={{ background: '#2563eb' }} onClick={handleSubmit}>
              <i className="fa-solid fa-circle-plus" />送信ログを記録
            </button>
          </div>
        </section>

        {/* Log list */}
        <section className="lg:col-span-7 flex flex-col gap-3">
          <div className="card flex flex-col" style={{ minHeight: 560 }}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-paper-plane text-blue-500" />送信完了履歴
                <span className="badge bg-blue-100 text-blue-700">{logs.length}</span>
              </h3>
              <button className="btn-sec text-xs py-1.5 px-3" onClick={handleExportTSV}>
                <i className="fa-solid fa-file-arrow-down" />TSVエクスポート
              </button>
            </div>
            <div className="flex-1 overflow-y-auto cs">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-300 gap-2">
                  <i className="fa-solid fa-paper-plane text-4xl" />
                  <p className="text-sm font-medium">送信ログがありません</p>
                </div>
              ) : (
                logs.map(log => (
                  <LogCard key={log.id} log={log} onDelete={() => handleDelete(log.id)} role={role} />
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function LogCard({ log, onDelete, role }: { log: LogEntry; onDelete: () => void; role: Role }) {
  const [expanded, setExpanded] = useState(false)

  const chIcon = log.channel === 'Instagram' ? 'fa-brands fa-instagram text-pink-500'
    : log.channel === 'X' ? 'fa-brands fa-x-twitter' : 'fa-brands fa-threads'

  const validityBadge = (label: string, v: string) => (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${validityBadgeClass(v)}`}>
      {label}：{v}
    </span>
  )

  return (
    <div className="border-b border-slate-100 p-4 hover:bg-slate-50 transition">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <i className={chIcon} />
            <span className="font-semibold text-sm text-slate-800">{log.accountName}</span>
            {log.handle && <span className="text-[11px] text-slate-400">{log.handle}</span>}
            <span className="text-[10px] text-slate-300">{new Date(log.sentAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap mb-2">
            {log.targetPostType && <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{log.targetPostType}</span>}
            {validityBadge('対象', log.targetValidity)}
            {validityBadge('文面', log.messageValidity)}
          </div>
          {log.targetPostText && (
            <p className="text-[11px] text-slate-400 truncate mb-1">📝 {log.targetPostText}</p>
          )}
          <p className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-3">{log.sentText}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button className="text-[10px] text-slate-400 hover:text-indigo-500 px-2 py-1 rounded hover:bg-indigo-50 transition" onClick={() => setExpanded(v => !v)}>
            <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-[9px] mr-0.5`} />詳細
          </button>
          {role === 'admin' && (
            <button className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition" onClick={onDelete}>
              <i className="fa-solid fa-trash text-xs" />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-3 flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
          {log.aiGeneratedText && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">AIが生成した文章</p>
              <p className="text-slate-600 whitespace-pre-wrap">{log.aiGeneratedText}</p>
            </div>
          )}
          {log.editReason && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">編集理由</p>
              <p className="text-slate-600">{log.editReason}</p>
            </div>
          )}
          {log.targetPostText && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">接触対象の投稿</p>
              <p className="text-slate-600">{log.targetPostText}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
