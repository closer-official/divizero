import { useState, useEffect } from 'react'
import type { AppData, Prompts, Target, Screening } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS1, parseOS1Instagram, parseOS1Threads } from '../../utils/parser'
import { addToExcluded, moveToTrash, normalizeHandle, buildProfileUrl, trackBadgeClass, uid, todayStr } from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'

interface Props {
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
  onGoToTab2: () => void
}

type Mode = 'twitter' | 'instagram' | 'threads'

const TRACK_TIPS: Record<string, string> = {
  FT: 'ファストトラック：課題シグナルあり→DM直行',
  NT: '通常トラック：リプ交流を経てDMへ',
  SKIP: '接触対象外（除外フィルター該当）'
}

type Prefill = { displayName: string; handle: string; channel: string }

export default function Tab1({ data, saveData, prompts, role, toast, confirm, onGoToTab2 }: Props) {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('os_screening_mode') as Mode) || 'twitter')
  const [resultText, setResultText] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [prefill, setPrefill] = useState<Prefill | null>(() => {
    try {
      const s = localStorage.getItem('os1_prefill')
      return s ? JSON.parse(s) : null
    } catch { return null }
  })

  useEffect(() => {
    setSelectedId(null)
  }, [page])

  function setModeAndSave(m: Mode) {
    setMode(m)
    localStorage.setItem('os_screening_mode', m)
  }

  function handleCopyPrompt() {
    let prompt: string | undefined
    if (mode === 'instagram') prompt = prompts.OS1_IG
    else if (mode === 'threads') prompt = prompts.OS1_TH
    else prompt = prompts.OS1_X
    if (!prompt) { toast.show('プロンプトを読み込み中です'); return }
    copyText(prompt, () => toast.show('分析プロンプトをコピーしました。AIにスクショと一緒に貼り付けてください'))
  }

  function handleSubmit() {
    const text = resultText.trim()
    if (!text) { toast.show('AIの出力を貼り付けてください', 2000); return }
    let parsed: Omit<Target, 'id' | 'createdAt'>
    if (mode === 'instagram') parsed = parseOS1Instagram(text) as unknown as Omit<Target, 'id' | 'createdAt'>
    else if (mode === 'threads') parsed = parseOS1Threads(text) as unknown as Omit<Target, 'id' | 'createdAt'>
    else parsed = parseOS1(text) as unknown as Omit<Target, 'id' | 'createdAt'>
    if (!parsed.accountName && !parsed.url) {
      toast.show('アカウント情報が見つかりませんでした。AIの出力形式を確認してください', 3000)
      return
    }
    const targetId = uid()
    const pid = parsed.track !== 'SKIP' ? uid() : null
    const newTarget: Target = {
      ...parsed,
      id: targetId,
      createdAt: new Date().toISOString(),
      aiOutput: text,
      pipelineId: pid,
    } as Target
    saveData(prev => {
      const d = { ...prev, targets: [...prev.targets, newTarget] }
      if (pid) {
        d.pipeline = [...prev.pipeline, {
          id: pid,
          targetId,
          caseId: newTarget.caseId || null,
          os1Output: newTarget.aiOutput || null,
          accountName: newTarget.accountName,
          url: newTarget.url,
          channel: newTarget.channel,
          track: newTarget.track as 'FT' | 'NT' | 'SKIP',
          hypothesis: newTarget.hypothesis,
          startDate: newTarget.startDate || todayStr(),
          currentStep: 'S1',
          stepHistory: [{ step: 'S1', date: todayStr() }],
          repCount: 0,
          dmCount: 0,
          lastContactDate: todayStr(),
          analyses: [],
          history: [],
          sentMessages: [],
          replies: [],
          isOpen: true,
        }]
      }
      return d
    })
    setResultText('')
    localStorage.removeItem('os1_prefill')
    setPrefill(null)
    if (pid) {
      toast.show(`「${newTarget.accountName}」をOS②に追加しました`, 2000)
      setTimeout(() => onGoToTab2(), 1000)
    } else {
      toast.show(`「${newTarget.accountName}」をOS①リストに追加しました（SKIP）`)
      setSelectedId(newTarget.id)
      setPage(0)
    }
  }

  function handleBulkToPipeline() {
    const eligible = data.targets.filter(t => t.track !== 'SKIP' && !t.pipelineId)
    if (eligible.length === 0) return
    saveData(prev => {
      const d = { ...prev, targets: [...prev.targets], pipeline: [...prev.pipeline] }
      eligible.forEach(tgt => {
        const pid = uid()
        d.targets = d.targets.map(t => t.id === tgt.id ? { ...t, pipelineId: pid } : t)
        d.pipeline.push({
          id: pid, targetId: tgt.id,
          caseId: tgt.caseId || null, os1Output: tgt.aiOutput || null,
          accountName: tgt.accountName, url: tgt.url, channel: tgt.channel,
          track: tgt.track as 'FT' | 'NT' | 'SKIP', hypothesis: tgt.hypothesis,
          startDate: tgt.startDate || todayStr(),
          currentStep: 'S1', stepHistory: [{ step: 'S1', date: todayStr() }],
          repCount: 0, dmCount: 0, lastContactDate: todayStr(),
          analyses: [], history: [], sentMessages: [], replies: [], isOpen: true,
        })
      })
      return d
    })
    toast.show(`${eligible.length}件をOS②パイプラインに一括移行します…`, 2500)
    setTimeout(() => onGoToTab2(), 2000)
  }

  function handleBackToOS0(targetId: string) {
    const tgt = data.targets.find(x => x.id === targetId)
    if (!tgt) return
    const screening: Screening = {
      id: uid(),
      createdAt: new Date().toISOString(),
      channel: tgt.channel,
      displayName: tgt.accountName,
      handle: tgt.url || tgt.accountName,
      verdict: 'OS①差し戻し',
      reason: 'OS①から差し戻し',
    }
    saveData(prev => {
      const d = {
        ...prev,
        targets: prev.targets.filter(x => x.id !== targetId),
        screenings: [...(prev.screenings || []), screening],
        pipeline: tgt.pipelineId
          ? (prev.pipeline || []).filter(p => p.id !== tgt.pipelineId)
          : prev.pipeline,
      }
      return d
    })
    setSelectedId(null)
    toast.show(`「${tgt.accountName}」をOS⓪に戻しました`)
  }

  function handleDelete(id: string) {
    const tgt = data.targets.find(x => x.id === id)
    if (!tgt) return
    saveData(prev => {
      const d = { ...prev, targets: prev.targets.filter(x => x.id !== id), excluded: [...(prev.excluded || [])], trash: [...(prev.trash || [])] }
      addToExcluded(d, tgt.url || tgt.accountName, tgt.accountName, tgt.channel, tgt.track === 'SKIP' ? 'SKIP' : '手動削除')
      const tid = moveToTrash(d, tgt as unknown as Record<string, unknown>, 'OS①')
      setTimeout(() => {
        toast.showUndo(`「${tgt.accountName}」を削除`, () => {
          saveData(prev2 => {
            const d2 = { ...prev2, trash: [...(prev2.trash || [])], targets: [...prev2.targets], excluded: [...(prev2.excluded || [])] }
            const tidx = d2.trash.findIndex(x => x._trashId === tid)
            if (tidx === -1) return d2
            const restored = { ...d2.trash[tidx] } as Record<string, unknown>
            d2.trash.splice(tidx, 1)
            delete restored._trashSource; delete restored._trashedAt; delete restored._trashId
            d2.excluded = d2.excluded.filter(e => normalizeHandle(e.handle) !== normalizeHandle(tgt.url || tgt.accountName))
            d2.targets = [...d2.targets, restored as unknown as Target]
            return d2
          })
        })
      }, 0)
      return d
    })
    if (selectedId === id) setSelectedId(null)
  }

  function handleToPipeline(targetId: string) {
    const tgt = data.targets.find(x => x.id === targetId)
    if (!tgt || tgt.pipelineId) return
    const pid = uid()
    saveData(prev => {
      const d = { ...prev, targets: prev.targets.map(t => t.id === targetId ? { ...t, pipelineId: pid } : t), pipeline: [...prev.pipeline] }
      d.pipeline.push({
        id: pid,
        targetId,
        caseId: tgt.caseId || null,
        os1Output: tgt.aiOutput || null,
        accountName: tgt.accountName,
        url: tgt.url,
        channel: tgt.channel,
        track: tgt.track as 'FT' | 'NT' | 'SKIP',
        hypothesis: tgt.hypothesis,
        startDate: tgt.startDate || todayStr(),
        currentStep: 'S1',
        stepHistory: [{ step: 'S1', date: todayStr() }],
        repCount: 0,
        dmCount: 0,
        lastContactDate: todayStr(),
        analyses: [],
        history: [],
        sentMessages: [],
        replies: [],
        isOpen: true,
      })
      return d
    })
    toast.show(`「${tgt.accountName}」をOS②パイプラインに移行します…`, 2000)
    setTimeout(() => onGoToTab2(), 1500)
  }

  const allTargets = [...data.targets].reverse()
  const total = allTargets.length
  const totalPages = Math.ceil(total / 10)
  const safePage = Math.min(page, Math.max(0, totalPages - 1))
  const pageTargets = allTargets.slice(safePage * 10, safePage * 10 + 10)
  const selectedTarget = selectedId ? data.targets.find(x => x.id === selectedId) : null

  const chBadge = (ch: string) => {
    if (ch === 'instagram') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-pink-100 text-pink-600"><i className="fa-brands fa-instagram mr-0.5" />IG</span>
    if (ch === 'threads') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700"><i className="fa-brands fa-threads mr-0.5" />TH</span>
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"><i className="fa-brands fa-x-twitter mr-0.5" />X</span>
  }

  const modeInfo = () => {
    if (mode === 'instagram') return {
      bg: 'bg-pink-50 border-pink-200 text-pink-900',
      btnBg: 'background:#fff0f6;border-color:#f9a8d4;color:#be185d',
      text: <><p className="font-bold mb-1"><i className="fa-brands fa-instagram mr-1" />プロンプトをコピーして、スクショと一緒にAI（Gemini等）に貼り付けてください</p><p className="text-pink-700">①スクショ読み取り＋スクリーニングを一発で実行します。</p></>
    }
    if (mode === 'threads') return {
      bg: 'bg-slate-50 border-slate-200 text-slate-700',
      btnBg: 'background:#f8fafc;border-color:#cbd5e1;color:#334155',
      text: <><p className="font-bold mb-1"><i className="fa-brands fa-threads mr-1" />プロンプトをコピーして、スクショと一緒にAI（Gemini等）に貼り付けてください</p><p className="text-slate-500">スクショからプロフィール・投稿・bio情報を読み取り、一発で出力されます。</p></>
    }
    return {
      bg: 'bg-violet-50 border-violet-200 text-violet-900',
      btnBg: 'background:#f5f3ff;border-color:#c4b5fd;color:#6d28d9',
      text: <><p className="font-bold mb-1"><i className="fa-brands fa-x-twitter mr-1" />プロンプトをコピーして、スクショと一緒にAI（Gemini等）に貼り付けてください</p><p className="text-violet-700">①プロフィール画面と②接触対象の投稿画面のスクショを添付するだけで出力されます。</p></>
    }
  }

  const info = modeInfo()

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'fadeIn .2s ease-out' }}>
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-xs text-violet-900">
        <span className="font-bold"><i className="fa-solid fa-stopwatch mr-1" />OS① 設計原則：</span>
        除外5条件に当たらない限り原則すべて接触。1案件60秒以内でスクリーニング完了。複雑な事前採点は廃止。
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: input panel */}
        <section className="lg:col-span-5 flex flex-col gap-3">
          <div className="card p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="font-bold text-sm text-slate-800">プロンプトをコピーしてスクショと一緒にAIへ</span>
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                {(['twitter', 'instagram', 'threads'] as Mode[]).map(m => {
                  const icons = { twitter: 'fa-brands fa-x-twitter', instagram: 'fa-brands fa-instagram', threads: 'fa-brands fa-threads' }
                  const labels = { twitter: 'Twitter', instagram: 'Instagram', threads: 'Threads' }
                  const activeColors = { twitter: 'text-violet-700', instagram: 'text-pink-600', threads: 'text-slate-800' }
                  return (
                    <button
                      key={m}
                      className={`text-xs font-bold px-2.5 py-1 rounded-md transition ${mode === m ? `bg-white ${activeColors[m]} shadow-sm` : 'text-slate-400'}`}
                      onClick={() => setModeAndSave(m)}
                    >
                      <i className={`${icons[m]} mr-1`} />{labels[m]}
                    </button>
                  )
                })}
              </div>
            </div>

            {prefill && (
              <div className="flex items-start gap-2 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 text-xs">
                <i className="fa-solid fa-arrow-right-to-bracket text-violet-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-violet-800">OS⓪から引き継ぎ：</span>
                  <span className="text-violet-700">{prefill.displayName || prefill.handle}</span>
                  {prefill.displayName && prefill.handle && (
                    <span className="text-violet-400 ml-1">@{prefill.handle}</span>
                  )}
                  <p className="text-violet-500 mt-1">
                    <i className="fa-solid fa-circle-info mr-1" />
                    OS⓪バッチ経由の場合はプロフィールテキストが含まれているので<span className="font-bold">スクショ不要</span>。AIにプロンプトのみ貼り付けてください。
                  </p>
                </div>
                <button
                  className="shrink-0 text-violet-300 hover:text-violet-500 p-1"
                  onClick={() => { localStorage.removeItem('os1_prefill'); setPrefill(null) }}
                  title="クリア"
                ><i className="fa-solid fa-xmark" /></button>
              </div>
            )}
            {!prefill && (
              <div className="text-[11px] text-slate-400 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                <i className="fa-solid fa-lightbulb mr-1 text-amber-400" />
                <span className="font-semibold">効率化TIP：</span>OS⓪の「OS①待機へ」でプロフィールを貼り付けると、スクショなしでバッチ処理できます。
              </div>
            )}

            <div className={`rounded-xl p-3 text-xs border ${info.bg}`}>{info.text}</div>

            <button
              className="w-full flex items-center justify-center gap-2 font-bold text-sm py-3 rounded-xl border transition cursor-pointer"
              style={{ ...(Object.fromEntries(info.btnBg.split(';').filter(Boolean).map(s => s.split(':').map(x => x.trim()) as [string, string]).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]))) }}
              onClick={handleCopyPrompt}
            >
              <i className="fa-solid fa-copy" />分析プロンプトをコピー（外部AIにスクショと一緒に貼り付け）
            </button>

            <div className="flex items-center gap-2 pb-2 border-b border-slate-100 mt-1">
              <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
              <span className="font-bold text-sm text-slate-800">AIの出力を貼り付けて記録</span>
            </div>
            <textarea
              className="input-base h-32 cs"
              placeholder="AIが出力した【アカウント情報】〜【初回接触案】のテキストをそのまま貼り付け"
              value={resultText}
              onChange={e => setResultText(e.target.value)}
            />
            <button className="btn-primary w-full justify-center text-sm" onClick={handleSubmit}>
              <i className="fa-solid fa-circle-plus" />スクリーニング結果を記録
            </button>
          </div>
        </section>

        {/* Right: list */}
        <section className="lg:col-span-7 flex flex-col gap-3">
          <div className="card flex flex-col" style={{ minHeight: 520 }}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-filter text-violet-500" />スクリーニング済みリスト
                <span className="badge bg-violet-100 text-violet-700">{data.targets.length}</span>
              </h3>
              {(() => {
                const eligible = data.targets.filter(t => t.track !== 'SKIP' && !t.pipelineId)
                if (eligible.length === 0) return null
                return (
                  <button
                    className="btn-primary text-xs py-1.5 px-3 shrink-0"
                    onClick={handleBulkToPipeline}
                    title={`SKIP以外の未移行${eligible.length}件をまとめてOS②へ`}
                  >
                    <i className="fa-solid fa-arrow-right mr-1" />全員OS②へ（{eligible.length}件）
                  </button>
                )
              })()}
            </div>
            <div className="flex-1 overflow-y-auto cs" id="t1-list">
              {total === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-300 gap-2">
                  <i className="fa-solid fa-filter text-4xl" />
                  <p className="text-sm font-medium">記録がありません</p>
                </div>
              ) : (
                pageTargets.map(t => (
                  <div
                    key={t.id}
                    className={`border-b border-slate-100 py-3 pl-3 pr-1 hover:bg-slate-50 cursor-pointer transition flex items-center gap-2 ${selectedId === t.id ? 'bg-violet-50 border-l-2 border-l-violet-500' : ''}`}
                    onClick={() => setSelectedId(selectedId === t.id ? null : t.id)}
                  >
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${trackBadgeClass(t.track)} tip`}
                      data-tip={TRACK_TIPS[t.track] || t.track}
                    >{t.track}</span>
                    {chBadge(t.channel)}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-800 truncate">{t.accountName || '(名前なし)'}</p>
                      <p className="text-[11px] text-slate-400 truncate">{t.hypothesis || ''}</p>
                    </div>
                    {t.pipelineId && <span className="text-[10px] text-indigo-500 font-semibold"><i className="fa-solid fa-arrow-right mr-0.5" />パイプライン済</span>}
                    <span className="text-[10px] text-slate-300 shrink-0">{new Date(t.createdAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</span>
                    <button
                      className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 active:bg-rose-100 transition"
                      onClick={e => { e.stopPropagation(); handleDelete(t.id) }}
                      aria-label="削除"
                    >
                      <i className="fa-solid fa-trash text-xs" />
                    </button>
                  </div>
                ))
              )}
            </div>
            {totalPages > 1 && (
              <div className="p-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  className="btn-sec text-xs py-1.5 px-3"
                  disabled={safePage === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                ><i className="fa-solid fa-chevron-left" /></button>
                <span className="text-xs text-slate-500">{safePage * 10 + 1}〜{Math.min(safePage * 10 + 10, total)}人目 / 全{total}人</span>
                <button
                  className="btn-sec text-xs py-1.5 px-3"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                ><i className="fa-solid fa-chevron-right" /></button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Detail panel */}
      {selectedTarget && (
        <TargetDetail
          target={selectedTarget}
          role={role}
          toast={toast}
          confirm={confirm}
          onToPipeline={() => handleToPipeline(selectedTarget.id)}
          onBackToOS0={() => handleBackToOS0(selectedTarget.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

function TargetDetail({ target: t, role, toast, confirm, onToPipeline, onBackToOS0, onClose }: {
  target: Target
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
  onToPipeline: () => void
  onBackToOS0: () => void
  onClose: () => void
}) {
  const profileUrl = buildProfileUrl(t.url, t.channel)

  const chIcon = t.channel === 'instagram' ? 'fa-brands fa-instagram text-pink-500'
    : t.channel === 'threads' ? 'fa-brands fa-threads' : 'fa-brands fa-x-twitter'

  function copy(text: string, label: string) {
    copyText(text, () => toast.show(`${label} をコピーしました`))
  }

  const msgBtn = (text: string, label: string) => text ? (
    <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap relative">
      {text}
      <div className="flex gap-1 mt-2">
        <button className="btn-sec text-xs py-1 px-2" onClick={() => copy(text, label)}>
          <i className="fa-regular fa-copy" /> コピー
        </button>
      </div>
    </div>
  ) : null

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${trackBadgeClass(t.track)} shrink-0`}>{t.track}</span>
          <i className={chIcon} />
          <h3 className="font-bold text-slate-900 text-base truncate">{t.accountName || '(名前なし)'}</h3>
          {t.caseId && <span className="text-[10px] text-slate-400 shrink-0">案件ID: {t.caseId}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {profileUrl && (
            <a href={profileUrl} target="_blank" rel="noreferrer" className="btn-sec text-xs py-1.5 px-2.5">
              <i className="fa-solid fa-arrow-up-right-from-square text-xs" />プロフィール
            </a>
          )}
          <button
            className="btn-sec text-xs py-1.5 px-2.5 text-slate-500"
            onClick={onBackToOS0}
            title="OS⓪リストに戻す"
          >
            <i className="fa-solid fa-arrow-left text-slate-400 mr-0.5" />OS⓪に戻す
          </button>
          {t.track !== 'SKIP' && (
            t.pipelineId
              ? <span className="text-[11px] text-indigo-500 font-semibold px-2"><i className="fa-solid fa-check mr-1" />OS②済</span>
              : <button className="btn-primary text-xs py-1.5 px-3" onClick={onToPipeline}>
                  <i className="fa-solid fa-arrow-right" />OS②へ移行
                </button>
          )}
          <button className="text-slate-400 hover:text-slate-600 p-1 ml-1" onClick={onClose}>
            <i className="fa-solid fa-xmark text-lg" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {[
          ['フォロワー', t.followers],
          ['業種', t.industry],
          ['推定商品', t.estimatedProduct],
          ['推定単価', t.estimatedPrice],
        ].map(([label, val]) => (
          <div key={label} className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-slate-400 text-[10px]">{label}</p>
            <p className="font-semibold text-slate-700 mt-0.5">{val || '-'}</p>
          </div>
        ))}
      </div>

      {(t.startDate || t.dmRoute || t.partnerFlag || t.nextAction) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {t.startDate && <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-slate-400 text-[10px]">接触開始日</p><p className="font-semibold text-slate-700 mt-0.5">{t.startDate}</p></div>}
          {t.dmRoute && <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-slate-400 text-[10px]">{t.channel === 'twitter' ? 'DM開放' : 'DM導線'}</p><p className="font-semibold text-slate-700 mt-0.5">{t.dmRoute}</p></div>}
          {t.partnerFlag && <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-slate-400 text-[10px]">提携候補</p><p className={`font-semibold mt-0.5 ${t.partnerFlag === '有' ? 'text-rose-600' : 'text-slate-700'}`}>{t.partnerFlag}</p></div>}
        </div>
      )}

      <div className="bg-slate-50 rounded-lg p-3 text-xs">
        <p className="text-slate-400 text-[10px] mb-1">事前仮説</p>
        <p className="text-slate-700">{t.hypothesis || '-'}</p>
      </div>

      {t.track === 'SKIP' ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
          <p className="text-amber-700 font-semibold"><i className="fa-solid fa-ban mr-1" />SKIP理由</p>
          <p className="text-amber-800 mt-1">{t.skipReason || '-'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-bold text-sm text-slate-700">▼リプ案（S1用）</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {t.contactA && (
              <div>
                <p className="text-[10px] text-violet-600 font-bold mb-1">案A（実行案）</p>
                {msgBtn(t.contactA, '案A')}
              </div>
            )}
            {t.contactB && (
              <div>
                <p className="text-[10px] text-indigo-500 font-bold mb-1">案B（予備案）</p>
                {msgBtn(t.contactB, '案B')}
              </div>
            )}
          </div>

          {(t.storyA || t.storyB || t.storyNote) && (
            <>
              <p className="font-bold text-sm text-slate-700">▼ストーリー返信案</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {t.storyA && <div><p className="text-[10px] text-pink-600 font-bold mb-1">案A</p>{msgBtn(t.storyA, 'ストーリーA')}</div>}
                {t.storyB && <div><p className="text-[10px] text-pink-400 font-bold mb-1">案B</p>{msgBtn(t.storyB, 'ストーリーB')}</div>}
                {t.storyNote && !t.storyA && <p className="text-xs text-slate-600">{t.storyNote}</p>}
              </div>
            </>
          )}

          {(t.dmA || t.dmB || t.dmNote) && (
            <>
              <p className="font-bold text-sm text-slate-700">▼初回DM案</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {t.dmA && <div><p className="text-[10px] text-violet-600 font-bold mb-1">案A</p>{msgBtn(t.dmA, 'DM案A')}</div>}
                {t.dmB && <div><p className="text-[10px] text-indigo-500 font-bold mb-1">案B</p>{msgBtn(t.dmB, 'DM案B')}</div>}
                {t.dmNote && !t.dmA && <p className="text-xs text-slate-600">{t.dmNote}</p>}
              </div>
            </>
          )}
        </div>
      )}

    </div>
  )
}
