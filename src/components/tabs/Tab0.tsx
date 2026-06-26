import { useState } from 'react'
import type { AppData, Prompts, Screening, Target, PipelineItem } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS0, parseOS0NG, parseOS1, parseOS1Instagram, parseOS1Threads } from '../../utils/parser'
import { addToExcluded, moveToTrash, normalizeHandle, buildProfileUrl, uid, todayStr } from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'

type SignalType = 'いいね' | 'フォロー' | 'ストーリー反応' | '突然DM' | 'リプ'

const SIGNAL_TEMP: Record<SignalType, number> = {
  '突然DM': 60,
  'フォロー': 40,
  'ストーリー反応': 30,
  'リプ': 30,
  'いいね': 20,
}

interface Props {
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
  onGoToTab1: () => void
  onGoToTab2: () => void
  onCreateInboundPipeline: (item: PipelineItem) => void
}

type Mode = 'twitter' | 'instagram' | 'threads'

export default function Tab0({ data, saveData, prompts, role, toast, confirm, onGoToTab1, onGoToTab2: _onGoToTab2, onCreateInboundPipeline }: Props) {  // _onGoToTab2 is used in batch submit
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('os0_mode') as Mode) || 'twitter')
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [excludedOpen, setExcludedOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  // OS①バッチ処理
  const [profileModalId, setProfileModalId] = useState<string | null>(null)
  const [profileText, setProfileText] = useState('')
  const [rtDetected, setRtDetected] = useState<string[]>([])
  const [batchResult, setBatchResult] = useState('')

  // インバウンドモーダル
  const [inboundOpen, setInboundOpen] = useState(false)
  const [ibChannel, setIbChannel] = useState<Mode>('twitter')
  const [ibName, setIbName] = useState('')
  const [ibHandle, setIbHandle] = useState('')
  const [ibSignal, setIbSignal] = useState<SignalType>('フォロー')
  const [ibDate, setIbDate] = useState(todayStr())
  const [ibMemo, setIbMemo] = useState('')

  function setModeAndSave(m: Mode) {
    setMode(m)
    localStorage.setItem('os0_mode', m)
  }

  function handleCopyPrompt() {
    const prompt = mode === 'instagram' ? prompts.OS0_IG : mode === 'threads' ? prompts.OS0_TH : prompts.OS0_X
    if (!prompt) { toast.show('プロンプトを読み込み中です'); return }
    const excluded = data.excluded || []
    const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const handles = excluded
      .filter(e => !e.addedAt || new Date(e.addedAt) > cutoff90)
      .map(e => e.handle).filter(Boolean).join('\n')
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
      const existingTargets = prev.targets || []
      const existingPipeline = prev.pipeline || []
      const items = allPassing.filter(item => {
        const h = normalizeHandle(item.handle)
        return (
          !excluded.some(e => normalizeHandle(e.handle) === h) &&
          !existingScreenings.some(s => normalizeHandle(s.handle) === h) &&
          !existingTargets.some(t => normalizeHandle(t.url) === h) &&
          !existingPipeline.some(p => normalizeHandle(p.url) === h)
        )
      })
      const skippedCount = allPassing.length - items.length
      d.screenings = [...d.screenings, ...(items as typeof d.screenings)]
      const ngsCount = ngs.length
      let msg = `${items.length}件の通過アカウントをリストに追加しました`
      if (ngsCount > 0) msg += `（NG${ngsCount}件を除外リストに保存）`
      if (skippedCount > 0) msg += `（${skippedCount}件はスキップ＝登録済み）`
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

  function resetInbound() {
    setIbName(''); setIbHandle(''); setIbSignal('フォロー'); setIbDate(todayStr()); setIbMemo('')
    setIbChannel('twitter')
  }

  function handleSaveInbound() {
    if (!ibName.trim() || !ibHandle.trim()) { toast.show('アカウント名とハンドルは必須です', 2000); return }
    const handle = ibHandle.trim().startsWith('@') ? ibHandle.trim() : '@' + ibHandle.trim()
    if (ibSignal === '突然DM') {
      const item: PipelineItem = {
        id: uid(),
        accountName: ibName.trim(),
        url: handle,
        channel: ibChannel,
        track: 'NT',
        startDate: todayStr(),
        currentStep: 'S2',
        stepHistory: [{ step: 'S2', date: todayStr() }],
        repCount: 0,
        dmCount: 0,
        lastContactDate: ibDate,
        analyses: [],
        history: [],
        sentMessages: [],
        replies: [],
        touches: [],
        isOpen: true,
        state: 'active',
        temperature: SIGNAL_TEMP[ibSignal],
        inbound_signal: { type: ibSignal, date: ibDate, memo: ibMemo.trim() || undefined },
      }
      onCreateInboundPipeline(item)
    } else {
      const screening: Screening = {
        id: uid(),
        createdAt: new Date().toISOString(),
        channel: ibChannel,
        displayName: ibName.trim(),
        handle,
        verdict: 'インバウンド',
        reason: `${ibSignal}${ibMemo.trim() ? ' — ' + ibMemo.trim() : ''}`,
        is_inbound: true,
        signal_type: ibSignal,
        signal_date: ibDate,
        signal_memo: ibMemo.trim() || undefined,
      }
      saveData(prev => ({ ...prev, screenings: [...(prev.screenings || []), screening] }))
      toast.show(`「${ibName.trim()}」をインバウンド起点としてリストに追加しました`)
    }
    setInboundOpen(false)
    resetInbound()
  }

  // ── OS①バッチ処理ヘルパー ────────────────────────────

  function detectNewHandles(text: string, ownHandle: string): string[] {
    const mentions = [...text.matchAll(/@[\w.]+/g)].map(m => normalizeHandle(m[0]))
    const ownNorm = normalizeHandle(ownHandle)
    const existing = new Set([
      ...(data.screenings || []).map(s => normalizeHandle(s.handle)),
      ...(data.targets || []).map(t => normalizeHandle(t.url)),
      ...(data.pipeline || []).map(p => normalizeHandle(p.url)),
      ...(data.excluded || []).map(e => normalizeHandle(e.handle)),
    ])
    return [...new Set(mentions)].filter(h => h && h !== ownNorm && !existing.has(h))
  }

  function handleOpenProfileModal(id: string) {
    const s = data.screenings.find(x => x.id === id)
    setProfileModalId(id)
    setProfileText(s?.rawProfileText || '')
    setRtDetected(s?.rawProfileText ? detectNewHandles(s.rawProfileText, s.handle) : [])
  }

  function handleProfileTextChange(text: string) {
    setProfileText(text)
    const s = data.screenings.find(x => x.id === profileModalId)
    setRtDetected(s ? detectNewHandles(text, s.handle) : [])
  }

  function handleSaveToQueue() {
    const id = profileModalId
    if (!id || !profileText.trim()) { toast.show('プロフィールテキストを貼り付けてください', 2000); return }
    const queuedCount = (data.screenings || []).filter(s => s.rawProfileText).length
    const isNew = !(data.screenings.find(x => x.id === id)?.rawProfileText)
    saveData(prev => ({
      ...prev,
      screenings: prev.screenings.map(s => s.id === id
        ? { ...s, rawProfileText: profileText.trim(), os1QueuedAt: new Date().toISOString() }
        : s),
    }))
    setProfileModalId(null)
    setProfileText('')
    setRtDetected([])
    const newCount = queuedCount + (isNew ? 1 : 0)
    if (newCount >= 5 && isNew) {
      toast.show(`OS①待機が${newCount}件に達しました。バッチ処理できます！`, 3500)
    } else {
      toast.show(`OS①待機に追加しました（現在${newCount}件）`, 2000)
    }
  }

  function handleRemoveFromQueue(id: string) {
    saveData(prev => ({
      ...prev,
      screenings: prev.screenings.map(s => s.id === id
        ? { ...s, rawProfileText: undefined, os1QueuedAt: undefined }
        : s),
    }))
  }

  function handleAddRtToOS0(handle: string, ch: Mode) {
    const h = handle.startsWith('@') ? handle : '@' + handle
    const s: Screening = {
      id: uid(), createdAt: new Date().toISOString(),
      channel: ch, displayName: '', handle: h,
      verdict: '引用RT/RT検出', reason: 'RT・引用RTから自動検出',
    }
    saveData(prev => ({ ...prev, screenings: [...(prev.screenings || []), s] }))
    setRtDetected(prev => prev.filter(x => x !== handle))
    toast.show(`@${handle} をOS⓪リストに追加しました`, 2000)
  }

  function handleCopyBatchPrompt() {
    const queued = (data.screenings || []).filter(s => s.rawProfileText)
    if (queued.length === 0) { toast.show('OS①待機中のアカウントがありません', 2000); return }
    const prompt = mode === 'instagram' ? prompts.OS1_IG : mode === 'threads' ? prompts.OS1_TH : prompts.OS1_X
    if (!prompt) { toast.show('プロンプトを読み込み中です', 2000); return }
    const profilesText = queued.map((s, i) =>
      `=== 対象${i + 1}：${s.displayName}（${s.handle}）===\n${s.rawProfileText || ''}`
    ).join('\n\n')
    const full = prompt
      + `\n\n---\n■ バッチ処理 ${queued.length}件：上記フォーマットで各アカウントを順番に出力してください。アカウントとアカウントの間は「【アカウント情報】」から始まる次の出力で区切られます。\n\n`
      + profilesText
    copyText(full, () => toast.show(`${queued.length}人分のOS①プロンプトをコピーしました。AIに貼り付けてください`, 3000))
  }

  function handleBatchSubmit(queued: Screening[]) {
    const text = batchResult.trim()
    if (!text) { toast.show('AIの出力を貼り付けてください', 2000); return }
    if (queued.length === 0) { toast.show('待機中のアカウントがありません', 2000); return }

    const segments = text.split(/(?=【アカウント情報】)/).filter(s => s.includes('【アカウント情報】'))
    if (segments.length === 0) {
      toast.show('AIの出力に【アカウント情報】が見つかりません。形式を確認してください', 3000)
      return
    }

    let addedCount = 0
    let pipelineCount = 0
    const processedIds = new Set<string>()

    saveData(prev => {
      const d = { ...prev, targets: [...prev.targets], pipeline: [...prev.pipeline], screenings: [...prev.screenings] }
      segments.forEach((seg, i) => {
        const screening = queued[i]
        if (!screening) return
        const ch = screening.channel as Mode
        const parsed = ch === 'instagram' ? parseOS1Instagram(seg) : ch === 'threads' ? parseOS1Threads(seg) : parseOS1(seg)
        if (!parsed.accountName && !parsed.url) return

        const targetId = uid()
        const pid = parsed.track !== 'SKIP' ? uid() : null
        const newTarget: Target = {
          ...parsed,
          id: targetId,
          createdAt: new Date().toISOString(),
          aiOutput: seg,
          rawInput: screening.rawProfileText,
          pipelineId: pid,
          channel: ch,
        } as Target
        d.targets.push(newTarget)

        if (pid) {
          d.pipeline.push({
            id: pid, targetId,
            caseId: newTarget.caseId || null,
            os1Output: seg,
            accountName: newTarget.accountName,
            url: newTarget.url,
            channel: ch,
            track: newTarget.track as 'FT' | 'NT' | 'SKIP',
            hypothesis: newTarget.hypothesis,
            startDate: newTarget.startDate || todayStr(),
            currentStep: 'S1',
            stepHistory: [{ step: 'S1', date: todayStr() }],
            repCount: 0, dmCount: 0,
            lastContactDate: todayStr(),
            analyses: [], history: [], sentMessages: [], replies: [],
            isOpen: true,
          })
          pipelineCount++
        }
        processedIds.add(screening.id)
        addedCount++
      })
      d.screenings = d.screenings.filter(s => !processedIds.has(s.id))
      return d
    })

    setBatchResult('')
    setTimeout(() => {
      toast.show(`${addedCount}件を登録（OS②に${pipelineCount}件追加）`, 3000)
      if (pipelineCount > 0) setTimeout(() => _onGoToTab2(), 1200)
    }, 0)
  }

  // ── 既存ハンドラ ───────────────────────────────────────

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
              <button
                className="btn-sec text-xs py-1.5 px-3 text-teal-700 border-teal-300"
                onClick={() => setInboundOpen(true)}
              >
                <i className="fa-solid fa-arrow-down-to-line mr-1 text-teal-500" />インバウンド起点
              </button>
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
                      {item.is_inbound && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">{item.signal_type ?? 'IB'}</span>}
                      {!item.is_inbound && isTeikei && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700">提携</span>}
                      {!item.is_inbound && isUT && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">UT</span>}
                      {!item.is_inbound && !isTeikei && !isUT && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">通過</span>}
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
                      {item.rawProfileText ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                            <i className="fa-solid fa-clock mr-0.5" />OS①待機中
                          </span>
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition shrink-0"
                            onClick={() => handleOpenProfileModal(item.id)}
                            title="プロフィール文を編集"
                          ><i className="fa-solid fa-pen text-[9px]" /></button>
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded text-slate-300 hover:text-rose-400 hover:bg-rose-50 transition shrink-0"
                            onClick={() => handleRemoveFromQueue(item.id)}
                            title="待機を解除"
                          ><i className="fa-solid fa-xmark text-[9px]" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            className="btn-sec text-xs py-1.5 px-2 shrink-0"
                            onClick={() => handleOpenProfileModal(item.id)}
                          >
                            <i className="fa-solid fa-clipboard-list text-violet-500 mr-0.5" /><span className="hidden sm:inline">OS①待機へ</span>
                          </button>
                          <button
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-violet-500 hover:bg-violet-50 transition shrink-0"
                            onClick={() => handleGoToOS1(item.id, (item.channel as Mode) || 'twitter')}
                            title="OS①に今すぐ移動（単独処理）"
                          ><i className="fa-solid fa-arrow-right text-xs" /></button>
                        </div>
                      )}
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

      {/* ── OS①バッチ処理セクション ───────────────────────── */}
      {(() => {
        const allQueued = (data.screenings || []).filter(s => s.rawProfileText)
        if (allQueued.length === 0) return null
        const channels: Mode[] = ['twitter', 'instagram', 'threads']
        const chLabel: Record<Mode, string> = { twitter: 'X', instagram: 'Instagram', threads: 'Threads' }
        const chIcon: Record<Mode, string> = { twitter: 'fa-brands fa-x-twitter', instagram: 'fa-brands fa-instagram', threads: 'fa-brands fa-threads' }
        const groups = channels.map(ch => ({ ch, items: allQueued.filter(s => s.channel === ch) })).filter(g => g.items.length > 0)

        function buildGroupPrompt(items: typeof allQueued, ch: Mode): string {
          const prompt = ch === 'instagram' ? prompts.OS1_IG : ch === 'threads' ? prompts.OS1_TH : prompts.OS1_X
          if (!prompt) return ''
          const profilesText = items.map((s, i) =>
            `=== 対象${i + 1}：${s.displayName}（${s.handle}）===\n${s.rawProfileText || ''}`
          ).join('\n\n')
          return prompt
            + `\n\n---\n■ バッチ処理 ${items.length}件：上記フォーマットで各アカウントを順番に出力してください。\n\n`
            + profilesText
        }

        return (
          <section className="flex flex-col gap-3">
            <div className="card p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <span className="font-bold text-sm text-slate-800 flex items-center gap-2">
                  <i className="fa-solid fa-layer-group text-violet-500" />OS①バッチ処理
                </span>
                <span className="badge bg-violet-100 text-violet-700">{allQueued.length}件待機中</span>
                {allQueued.length >= 5 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    <i className="fa-solid fa-bolt mr-0.5" />バッチ推奨
                  </span>
                )}
              </div>

              {groups.map(({ ch, items }) => (
                <div key={ch} className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <i className={`${chIcon[ch]} text-slate-500 text-sm`} />
                    <span className="font-bold text-sm text-slate-700">{chLabel[ch]}</span>
                    <span className="badge bg-violet-100 text-violet-700">{items.length}件</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {items.map((s, i) => (
                      <span key={s.id} className="flex items-center gap-1 bg-violet-50 border border-violet-200 rounded-lg px-2 py-0.5 text-xs">
                        <span className="text-violet-400 font-mono">#{i + 1}</span>
                        <span className="font-semibold text-violet-800">{s.displayName || s.handle}</span>
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-slate-500"><span className="font-bold text-slate-700">ステップ1：</span>バッチプロンプトをコピー</p>
                      <button
                        className="btn-sec w-full justify-center font-bold"
                        onClick={() => {
                          const full = buildGroupPrompt(items, ch)
                          if (!full) { toast.show('プロンプトを読み込み中です', 2000); return }
                          copyText(full, () => toast.show(`${chLabel[ch]} ${items.length}人分のOS①プロンプトをコピーしました`, 3000))
                        }}
                      >
                        <i className="fa-solid fa-copy text-violet-500" />{items.length}人分コピー（{chLabel[ch]}）
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-slate-500"><span className="font-bold text-slate-700">ステップ2：</span>AI出力を貼り付けて登録</p>
                      <textarea
                        className="input-base h-20 cs text-xs"
                        placeholder={`${items.length}人分の【アカウント情報】〜を貼り付け`}
                        value={batchResult}
                        onChange={e => setBatchResult(e.target.value)}
                      />
                      <button
                        className="btn-primary w-full justify-center text-sm"
                        onClick={() => handleBatchSubmit(items)}
                      >
                        <i className="fa-solid fa-circle-check" />{items.length}件を登録してOS②へ
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })()}

      {/* ── インバウンドモーダル ─────────────────────────── */}
      {inboundOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 flex items-center gap-2 bg-teal-50 border-b border-teal-100">
              <i className="fa-solid fa-arrow-down-to-line text-teal-600" />
              <p className="font-bold text-sm text-teal-800 flex-1">インバウンド起点を記録</p>
              <button className="text-slate-400 hover:text-slate-700 p-1" onClick={() => { setInboundOpen(false); resetInbound() }}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex flex-col gap-4 flex-1">
              {/* チャネル */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700">チャネル</label>
                <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5 self-start">
                  {(['twitter', 'instagram', 'threads'] as Mode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setIbChannel(m)}
                      className={`text-xs font-bold px-2.5 py-1 rounded-md transition ${ibChannel === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}
                    >
                      {m === 'twitter' ? 'X' : m === 'instagram' ? 'Instagram' : 'Threads'}
                    </button>
                  ))}
                </div>
              </div>

              {/* アカウント名 / ハンドル */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700">アカウント名</label>
                <input className="input-base text-sm" placeholder="表示名" value={ibName} onChange={e => setIbName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700">ハンドル</label>
                <input className="input-base text-sm" placeholder="@handle" value={ibHandle} onChange={e => setIbHandle(e.target.value)} />
              </div>

              {/* シグナル種別 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700">シグナル種別</label>
                <div className="flex flex-wrap gap-1.5">
                  {(['いいね', 'フォロー', 'ストーリー反応', '突然DM', 'リプ'] as SignalType[]).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setIbSignal(s)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${
                        ibSignal === s ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-teal-300'
                      }`}
                    >
                      {s}
                      {s !== '突然DM' && <span className="ml-1 opacity-60">温{SIGNAL_TEMP[s]}</span>}
                      {s === '突然DM' && <span className="ml-1 opacity-60">温{SIGNAL_TEMP[s]}・直行</span>}
                    </button>
                  ))}
                </div>
                {ibSignal === '突然DM' && (
                  <p className="text-[11px] text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2 py-1.5">
                    <i className="fa-solid fa-bolt mr-1" />OS①スクリーニングをスキップしてOS②（パイプライン）に直接追加します
                  </p>
                )}
              </div>

              {/* 検知日時 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700">検知日</label>
                <input type="date" className="input-base text-sm" value={ibDate} onChange={e => setIbDate(e.target.value)} />
              </div>

              {/* メモ */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700">メモ（任意）</label>
                <textarea rows={2} className="input-base text-sm resize-none" placeholder="どんな投稿にいいねしたか、DMの内容など" value={ibMemo} onChange={e => setIbMemo(e.target.value)} />
              </div>
            </div>

            <div className="bg-slate-50 px-4 py-3 flex justify-end gap-2">
              <button className="btn-sec text-xs py-2 px-4" onClick={() => { setInboundOpen(false); resetInbound() }}>キャンセル</button>
              <button className="btn-primary text-xs py-2 px-4" style={{ background: '#0d9488' }} onClick={handleSaveInbound}>
                <i className="fa-solid fa-check mr-1" />
                {ibSignal === '突然DM' ? 'OS②に直接追加' : 'リストに追加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── プロフィール貼り付けモーダル ───────────────────── */}
      {profileModalId && (() => {
        const target = data.screenings.find(s => s.id === profileModalId)
        if (!target) return null
        return (
          <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="p-4 flex items-center gap-2 bg-violet-50 border-b border-violet-100">
                <i className="fa-solid fa-clipboard-list text-violet-600" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-violet-800">OS①待機に追加：{target.displayName || target.handle}</p>
                  <p className="text-[11px] text-violet-500">{target.handle} · プロフィール原文と投稿をコピペしてください</p>
                </div>
                <button className="text-slate-400 hover:text-slate-700 p-1" onClick={() => { setProfileModalId(null); setProfileText(''); setRtDetected([]) }}>
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex flex-col gap-3 flex-1">
                <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                  <i className="fa-solid fa-circle-info mr-1 text-slate-400" />
                  Xのプロフィールページ全体＋投稿一覧（RT・引用RTも含む）をそのままコピペしてください。
                </div>
                <textarea
                  className="input-base h-56 cs text-xs"
                  placeholder={`${target.displayName || target.handle} のプロフィール原文・投稿・RTなどをそのまま貼り付け`}
                  value={profileText}
                  onChange={e => handleProfileTextChange(e.target.value)}
                  autoFocus
                />

                {/* RT/引用RT検出 */}
                {rtDetected.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-2">
                    <p className="text-xs font-bold text-amber-800">
                      <i className="fa-solid fa-retweet mr-1" />RT・引用RT先のアカウントを検出（{rtDetected.length}件）
                    </p>
                    <p className="text-[11px] text-amber-600">まだOS⓪リストにないアカウントです。追加しますか？</p>
                    <div className="flex flex-col gap-1">
                      {rtDetected.map(h => (
                        <div key={h} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-amber-200">
                          <span className="text-xs font-mono text-slate-700">@{h}</span>
                          <button
                            className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 transition"
                            onClick={() => handleAddRtToOS0(h, (target.channel as Mode) || 'twitter')}
                          >
                            <i className="fa-solid fa-plus mr-0.5" />OS⓪に追加
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-slate-50 px-4 py-3 flex justify-end gap-2">
                <button className="btn-sec text-xs py-2 px-4" onClick={() => { setProfileModalId(null); setProfileText(''); setRtDetected([]) }}>キャンセル</button>
                <button className="btn-primary text-xs py-2 px-4" onClick={handleSaveToQueue} disabled={!profileText.trim()}>
                  <i className="fa-solid fa-check mr-1" />OS①待機に追加
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
