import { useState } from 'react'
import type { AppData, Prompts, Screening } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS0, parseOS0NG } from '../../utils/parser'
import { addToExcluded, moveToTrash, normalizeHandle, buildProfileUrl, uid } from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'

interface Props {
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
  onGoToTab1: () => void
}

type Mode = 'twitter' | 'instagram' | 'threads'

export default function Tab0({ data, saveData, prompts, role, toast, confirm, onGoToTab1 }: Props) {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('os0_mode') as Mode) || 'twitter')
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [excludedOpen, setExcludedOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  function setModeAndSave(m: Mode) {
    setMode(m)
    localStorage.setItem('os0_mode', m)
  }

  function handleCopyPrompt() {
    const prompt = mode === 'instagram' ? prompts.OS0_IG : mode === 'threads' ? prompts.OS0_TH : prompts.OS0_X
    if (!prompt) { toast.show('プロンプトを読み込み中です'); return }
    const excluded = data.excluded || []
    const handles = excluded.map(e => e.handle).filter(Boolean).join('\n')
    let full: string
    const splitMarker = '\n\n【除外済みアカウント'
    const splitPoint = prompt.indexOf(splitMarker)
    if (splitPoint !== -1) {
      // v2: 入力データを除外セクションの前に挿入し、ハンドルを末尾に追記
      const beforeExcluded = prompt.slice(0, splitPoint)
      const excludedPart = prompt.slice(splitPoint)
      full = beforeExcluded + (input ? '\n' + input : '') + excludedPart + (handles ? '\n' + handles : '')
    } else {
      // 旧バージョン: セクションごと末尾に追記
      const excludedSection = handles
        ? `\n\n【除外済みアカウント（再判定不要）】\n以下のアカウントは過去に接触済み・SKIP・除外済みです。▼判定一覧に含まれていた場合は無条件で✕（除外済み）としてください：\n${handles}`
        : ''
      full = prompt + excludedSection + (input ? '\n' + input : '')
    }
    copyText(full, () => toast.show('OS⓪プロンプトをコピーしました。AIにそのまま貼り付けてください'))
  }

  function handleSubmit() {
    const text = result.trim()
    if (!text) { toast.show('AIの出力を貼り付けてください', 2000); return }
    const allPassing = parseOS0(text, mode)
    if (allPassing.length === 0) {
      toast.show('通過アカウントが見つかりませんでした。▼判定一覧の形式を確認してください', 3000)
      return
    }
    saveData(prev => {
      const d = { ...prev, screenings: [...(prev.screenings || [])], excluded: [...(prev.excluded || [])], trash: [...(prev.trash || [])] }
      const ngs = parseOS0NG(text, mode)
      ngs.forEach(ng => addToExcluded(d, ng.handle, ng.displayName, ng.channel, 'OS⓪NG', ng.skipCode))
      const excluded = d.excluded || []
      const existingScreenings = d.screenings || []
      const items = allPassing.filter(item =>
        !excluded.some(e => normalizeHandle(e.handle) === normalizeHandle(item.handle)) &&
        !existingScreenings.some(s => normalizeHandle(s.handle) === normalizeHandle(item.handle))
      )
      const skippedCount = allPassing.length - items.length
      d.screenings = [...d.screenings, ...(items as typeof d.screenings)]
      const ngsCount = ngs.length
      let msg = `${items.length}件の通過アカウントをリストに追加しました`
      if (ngsCount > 0) msg += `（NG${ngsCount}件を除外リストに保存）`
      if (skippedCount > 0) msg += `（${skippedCount}件はスキップ）`
      setTimeout(() => toast.show(msg, 3500), 0)
      return d
    })
    setInput('')
    setResult('')
  }

  function handleDelete(id: string) {
    const item = data.screenings.find(x => x.id === id)
    if (!item) return
    saveData(prev => {
      const d = { ...prev, screenings: prev.screenings.filter(x => x.id !== id), excluded: [...(prev.excluded || [])], trash: [...(prev.trash || [])] }
      addToExcluded(d, item.handle, item.displayName, item.channel, '手動削除')
      const tid = moveToTrash(d, item as unknown as Record<string, unknown>, 'OS⓪')
      setTimeout(() => {
        toast.showUndo(`「${item.displayName || item.handle}」を削除`, () => {
          saveData(prev2 => {
            const d2 = { ...prev2, trash: [...(prev2.trash || [])], screenings: [...(prev2.screenings || [])], excluded: [...(prev2.excluded || [])] }
            const tidx = d2.trash.findIndex(x => x._trashId === tid)
            if (tidx === -1) return d2
            const restored = { ...d2.trash[tidx] }
            d2.trash.splice(tidx, 1)
            delete (restored as Record<string, unknown>)._trashSource
            delete (restored as Record<string, unknown>)._trashedAt
            delete (restored as Record<string, unknown>)._trashId
            d2.excluded = d2.excluded.filter(e => normalizeHandle(e.handle) !== normalizeHandle(item.handle))
            d2.screenings = [...d2.screenings, restored as unknown as Screening]
            return d2
          })
        })
      }, 0)
      return d
    })
  }

  function handleStartEdit(id: string, currentName: string) {
    setEditingId(id)
    setEditingName(currentName)
  }

  function handleSaveName(id: string) {
    const name = editingName.trim()
    saveData(prev => ({
      ...prev,
      screenings: prev.screenings.map(s => s.id === id ? { ...s, displayName: name } : s),
    }))
    setEditingId(null)
  }

  function handleGoToOS1(id: string, channel: Mode) {
    const item = data.screenings.find(x => x.id === id)
    if (item) {
      localStorage.setItem('os1_prefill', JSON.stringify({
        displayName: item.displayName || '',
        handle: item.handle || '',
        channel,
      }))
    }
    saveData(prev => ({ ...prev, screenings: prev.screenings.filter(x => x.id !== id) }))
    localStorage.setItem('os_screening_mode', channel)
    onGoToTab1()
  }

  function handleExcludedDelete(eid: string) {
    saveData(prev => ({ ...prev, excluded: (prev.excluded || []).filter(e => e.id !== eid) }))
    toast.show('除外を解除しました')
  }

  function handleExcludedClear() {
    confirm.show('リセット確認', '除外済みリストをすべてクリアしますか？', () => {
      saveData(prev => ({ ...prev, excluded: [] }))
      toast.show('除外リストをリセットしました')
    })
  }

  const screenings = [...(data.screenings || [])].reverse()
  const excluded = [...(data.excluded || [])].reverse()

  const modeBtn = (m: Mode, label: string, icon: string, activeColor: string) => (
    <button
      className={`text-xs font-bold px-2.5 py-1 rounded-md transition ${mode === m ? `bg-white ${activeColor} shadow-sm` : 'text-slate-400'}`}
      onClick={() => setModeAndSave(m)}
    >
      <i className={`${icon} mr-1`} />{label}
    </button>
  )

  const channelBadge = (ch: string) => {
    if (ch === 'instagram') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-pink-100 text-pink-600"><i className="fa-brands fa-instagram mr-0.5" />IG</span>
    if (ch === 'threads') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700"><i className="fa-brands fa-threads mr-0.5" />TH</span>
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"><i className="fa-brands fa-x-twitter mr-0.5" />X</span>
  }

  const reasonLabel = (r: string) => {
    if (r === 'OS⓪NG') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-600">OS⓪NG</span>
    if (r === 'SKIP') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">SKIP</span>
    if (r === 'パイプライン削除') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">パイプライン削除</span>
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">手動削除</span>
  }

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'fadeIn .2s ease-out' }}>
      <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl p-3 text-xs text-fuchsia-900">
        <span className="font-bold"><i className="fa-solid fa-layer-group mr-1" />OS⓪ 設計原則：</span>
        検索一覧のbioだけで「明白なゴミ」を除去し、それ以外は全てOS①へ。迷ったら通す。深く見ないからこそ速い。
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: input */}
        <section className="lg:col-span-5 flex flex-col gap-3">
          <div className="card p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-fuchsia-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
                <span className="font-bold text-sm text-slate-800">一覧を貼り付けてプロンプトをコピー</span>
              </div>
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                {modeBtn('twitter', 'Twitter', 'fa-brands fa-x-twitter', 'text-violet-700')}
                {modeBtn('instagram', 'Instagram', 'fa-brands fa-instagram', 'text-pink-600')}
                {modeBtn('threads', 'Threads', 'fa-brands fa-threads', 'text-slate-800')}
              </div>
            </div>
            <textarea
              className="input-base h-28 cs"
              placeholder="検索タイムライン・フォロワー一覧などを丸ごとコピペ"
              value={input}
              onChange={e => setInput(e.target.value)}
            />
            <button className="btn-sec w-full justify-center" onClick={handleCopyPrompt}>
              <i className="fa-solid fa-copy text-fuchsia-500" />OS⓪プロンプトをコピー（外部AIで実行）
            </button>
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <span className="w-6 h-6 rounded-full bg-fuchsia-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
              <span className="font-bold text-sm text-slate-800">AIの出力を貼り付けてリストに追加</span>
            </div>
            <textarea
              className="input-base h-32 cs"
              placeholder="AIが出力した【一次選別】〜▼選別サマリのテキストをそのまま貼り付け"
              value={result}
              onChange={e => setResult(e.target.value)}
            />
            <button className="btn-primary w-full justify-center text-sm" onClick={handleSubmit}>
              <i className="fa-solid fa-circle-plus" />通過アカウントをリストに追加
            </button>
          </div>
        </section>

        {/* Right: list */}
        <section className="lg:col-span-7 flex flex-col gap-3">
          <div className="card flex flex-col" style={{ minHeight: 520 }}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-layer-group text-fuchsia-500" />一次選別済みリスト
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto cs">
              {screenings.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-300 gap-2">
                  <i className="fa-solid fa-layer-group text-4xl" />
                  <p className="text-sm font-medium">記録がありません</p>
                </div>
              ) : (
                screenings.map(item => {
                  const profileUrl = buildProfileUrl(item.handle, item.channel)
                  const isTeikei = item.verdict.includes('提携')
                  const isUT = item.verdict.includes('UT候補')
                  const verdictBadge = (
                    <div className="flex gap-1 shrink-0">
                      {isTeikei && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700">提携</span>}
                      {isUT && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">UT</span>}
                      {!isTeikei && !isUT && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">通過</span>}
                    </div>
                  )
                  return (
                    <div key={item.id} className="border-b border-slate-100 py-3 px-4 hover:bg-slate-50 transition flex items-center gap-2">
                      {verdictBadge}
                      {channelBadge(item.channel)}
                      <div className="flex-1 min-w-0">
                        {editingId === item.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              className="input-base text-sm py-0.5 px-2 h-7 flex-1 min-w-0"
                              value={editingName}
                              onChange={e => setEditingName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveName(item.id); if (e.key === 'Escape') setEditingId(null) }}
                              autoFocus
                            />
                            <button className="btn-primary text-xs py-0.5 px-2 h-7 shrink-0" onClick={() => handleSaveName(item.id)}>保存</button>
                            <button className="btn-sec text-xs py-0.5 px-2 h-7 shrink-0" onClick={() => setEditingId(null)}>×</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <p className="font-semibold text-sm text-slate-800 truncate">{item.displayName ? item.displayName : <span className="text-rose-400">(名前なし)</span>}</p>
                            <button
                              className="opacity-0 group-hover:opacity-100 transition w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-violet-500 hover:bg-violet-50 shrink-0"
                              onClick={() => handleStartEdit(item.id, item.displayName || '')}
                              title="名前を編集"
                            >
                              <i className="fa-solid fa-pen text-[10px]" />
                            </button>
                          </div>
                        )}
                        <p className="text-[11px] text-slate-500 truncate">{item.handle}{item.reason ? ' — ' + item.reason : ''}</p>
                      </div>
                      <a href={profileUrl} target="_blank" rel="noreferrer" className="btn-sec text-xs py-1.5 px-2.5 shrink-0">
                        <i className="fa-solid fa-arrow-up-right-from-square text-xs" />開く
                      </a>
                      <button
                        className="btn-sec text-xs py-1.5 px-2 shrink-0"
                        onClick={() => handleGoToOS1(item.id, (item.channel as Mode) || 'twitter')}
                      >
                        <i className="fa-solid fa-arrow-right text-violet-500 mr-0.5" /><span className="hidden sm:inline">OS①へ</span>
                      </button>
                      <button
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 active:bg-rose-100 transition shrink-0"
                        onClick={() => handleDelete(item.id)}
                        aria-label="削除"
                      >
                        <i className="fa-solid fa-trash text-xs" />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Excluded list */}
          <div className="card overflow-hidden">
            <div
              className="p-4 flex items-center justify-between cursor-pointer select-none"
              onClick={() => setExcludedOpen(v => !v)}
            >
              <h3 className="font-bold text-sm text-slate-700 flex items-center gap-2">
                <i className="fa-solid fa-ban text-rose-400" />除外済みリスト
                <span className="badge bg-rose-100 text-rose-600">{excluded.length}</span>
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">OS⓪プロンプトに自動反映</span>
                <i className={`fa-solid fa-chevron-down text-slate-400 text-xs transition-transform ${excludedOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
            {excludedOpen && (
              <div className="border-t border-slate-100">
                <p className="text-[11px] text-slate-400 px-4 py-2">OS⓪NG・SKIP・手動削除したアカウント。OS⓪プロンプトコピー時に自動付加され、AIが再判定しないようになります。</p>
                <div className="max-h-60 overflow-y-auto cs">
                  {excluded.length === 0 ? (
                    <div className="flex items-center justify-center h-16 text-slate-300 text-xs gap-1">
                      <i className="fa-solid fa-ban" />除外済みアカウントはありません
                    </div>
                  ) : (
                    excluded.map(e => (
                      <div key={e.id} className="border-b border-slate-100 py-2.5 px-4 flex items-center gap-2 hover:bg-slate-50 transition">
                        {reasonLabel(e.reason)}
                        {e.skipCode && <span className="text-[10px] font-mono text-rose-500">{e.skipCode}</span>}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs text-slate-700 truncate">{e.displayName || e.handle}</p>
                          <p className="text-[11px] text-slate-400">{e.handle}</p>
                        </div>
                        <button
                          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition text-xs"
                          onClick={() => handleExcludedDelete(e.id)}
                          title="除外を解除"
                        >
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {role === 'admin' && (
                  <div className="p-3 border-t border-slate-100 flex justify-end">
                    <button className="btn-danger text-xs py-1.5 px-3" onClick={handleExcludedClear}>
                      <i className="fa-solid fa-trash mr-1" />リストをリセット
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
