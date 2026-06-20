import { useState } from 'react'
import type { AppData, Prompts, ClosedDeal } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI, ConfirmAPI } from '../../App'
import { parseOS3 } from '../../utils/parser'
import { closeTypeBadgeClass, uid, todayStr } from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'

interface Props {
  data: AppData
  saveData: (updater: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
  confirm: ConfirmAPI
}

const WON_TYPE_DESC: Record<string, string> = {
  'W-A': 'W-A：顕在課題直行型 — 相手がすでに課題を認識しており、直接提案が刺さった成約',
  'W-B': 'W-B：関係構築相談化型 — 関係を深めた後、相手から相談が来て成約',
  'W-C': 'W-C：相手起点型 — 相手からの声がけ・問い合わせで成約',
  'W-D': 'W-D：その他パターンでの成約',
}

export default function Tab3({ data, saveData, prompts, role, toast, confirm }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [track, setTrack] = useState<'FT' | 'NT' | 'SKIP'>('NT')
  const [hypo, setHypo] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState(todayStr())
  const [result, setResult] = useState('断り')
  const [rule, setRule] = useState('無')
  const [convText, setConvText] = useState('')
  const [resultPaste, setResultPaste] = useState('')
  const [expandedRaw, setExpandedRaw] = useState<string | null>(null)

  function handleCopyPrompt() {
    if (!prompts.OS3) { toast.show('プロンプトを読み込み中です'); return }
    const full = prompts.OS3 + '\n' + convText
    copyText(full, () => toast.show('OS③プロンプトをコピーしました'))
  }

  function handleSubmit() {
    const text = resultPaste.trim()
    if (!name) { toast.show('アカウント名を入力してください', 2000); return }
    let parsed: Partial<ClosedDeal> = {}
    if (text) {
      parsed = parseOS3(text)
    }
    const entry: ClosedDeal = {
      id: uid(),
      createdAt: new Date().toISOString(),
      accountName: name,
      track,
      hypothesis: hypo,
      startDate,
      closeDate: endDate,
      result,
      ruleFired: rule === '有',
      rawOutput: text,
      aiOutput: text,
      ...parsed,
    }
    saveData(prev => ({ ...prev, closed: [...prev.closed, entry] }))
    setName(''); setHypo(''); setStartDate(''); setEndDate(todayStr()); setConvText(''); setResultPaste('')
    toast.show(`「${name}」の案件検証を記録しました`)
    setSelectedId(entry.id)
  }

  function handleDelete(id: string) {
    const item = data.closed.find(x => x.id === id)
    if (!item) return
    confirm.show('削除確認', `「${item.accountName}」の検証記録を削除しますか？`, () => {
      saveData(prev => ({ ...prev, closed: prev.closed.filter(x => x.id !== id) }))
      if (selectedId === id) setSelectedId(null)
      toast.show('削除しました')
    })
  }

  function handleExportTSV() {
    const headers = ['アカウント名', 'トラック', '結果', 'クローズタイプ', '仮説結果', '学習価値', '最大の学び', '接触開始', 'クローズ日']
    const rows = data.closed.map(c => [
      c.accountName, c.track, c.result, c.closeType || '',
      c.hypothesisResult || '', c.learningValue != null ? String(c.learningValue) : '-',
      c.maxLearning || '', c.startDate || '', c.closeDate || '',
    ])
    const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n')
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'os3_export.tsv'; a.click()
    URL.revokeObjectURL(url)
    toast.show('TSVをダウンロードしました')
  }

  const closed = [...data.closed].reverse()
  const selectedItem = selectedId ? data.closed.find(x => x.id === selectedId) : null

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'fadeIn .2s ease-out' }}>
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900">
        <span className="font-bold"><i className="fa-solid fa-graduation-cap mr-1" />OS③ 設計原則：</span>
        全クローズ案件を検証対象とする（受注・失注・未到達・SKIP）。OS①②は軽く動かし、ここに最も時間をかける。
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: input */}
        <section className="lg:col-span-5 flex flex-col gap-3">
          <div className="card p-5 flex flex-col gap-3">
            <p className="font-bold text-sm text-slate-800 flex items-center gap-2"><i className="fa-solid fa-vial text-emerald-500" />案件検証を追加</p>
            <div className="grid grid-cols-2 gap-2">
              <input className="input-base text-xs py-2" placeholder="アカウント名" value={name} onChange={e => setName(e.target.value)} />
              <select className="input-base text-xs py-2" value={track} onChange={e => setTrack(e.target.value as 'FT' | 'NT' | 'SKIP')}>
                <option value="FT">FT</option>
                <option value="NT">NT</option>
                <option value="SKIP">SKIP</option>
              </select>
            </div>
            <input className="input-base text-xs py-2" placeholder="事前仮説（OS①から転記）" value={hypo} onChange={e => setHypo(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1"><label className="text-xs text-slate-400">接触開始日</label><input type="date" className="input-base text-xs py-2" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
              <div className="flex flex-col gap-1"><label className="text-xs text-slate-400">クローズ日</label><input type="date" className="input-base text-xs py-2" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className="input-base text-xs py-2" value={result} onChange={e => setResult(e.target.value)}>
                {['受注', '断り', 'フェードアウト', '未読', '未到達クローズ', 'ブロック'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select className="input-base text-xs py-2" value={rule} onChange={e => setRule(e.target.value)}>
                <option value="無">7日/30日ルール：無</option>
                <option value="有">7日/30日ルール：有</option>
              </select>
            </div>
            <textarea className="input-base h-28 cs text-xs" placeholder="会話ログ全体＋OS①②のスクリーニング情報を貼り付け" value={convText} onChange={e => setConvText(e.target.value)} />
            <button className="btn-sec w-full justify-center text-xs" onClick={handleCopyPrompt}>
              <i className="fa-solid fa-copy text-emerald-500" />OS③プロンプトをコピー（外部AIで実行）
            </button>
            <textarea className="input-base h-24 cs text-xs" placeholder="AIの出力を貼り付け" value={resultPaste} onChange={e => setResultPaste(e.target.value)} />
            <button className="btn-primary w-full justify-center text-sm" style={{ background: '#059669' }} onClick={handleSubmit}>
              <i className="fa-solid fa-circle-plus" />案件検証を記録
            </button>
          </div>
        </section>

        {/* Right: list */}
        <section className="lg:col-span-7 flex flex-col gap-3">
          <div className="card flex flex-col" style={{ minHeight: 560 }}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-box-archive text-emerald-500" />クローズ済み案件
              </h3>
              <div className="flex gap-2">
                <button className="btn-sec text-xs py-1.5 px-3" onClick={handleExportTSV}><i className="fa-solid fa-copy" />TSV</button>
                {role === 'admin' && (
                  <button className="btn-danger text-xs py-1.5 px-3" onClick={() => confirm.show('全削除確認', '全案件検証記録を削除しますか？', () => { saveData(prev => ({ ...prev, closed: [] })); setSelectedId(null); toast.show('全件削除しました') })}>
                    <i className="fa-solid fa-trash" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto cs">
              {closed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-300 gap-2">
                  <i className="fa-solid fa-box-archive text-4xl" />
                  <p className="text-sm font-medium">クローズ案件がありません</p>
                </div>
              ) : (
                closed.map(c => (
                  <div
                    key={c.id}
                    className={`border-b border-slate-100 p-3 hover:bg-slate-50 cursor-pointer transition flex items-center gap-3 ${selectedId === c.id ? 'bg-emerald-50 border-l-2 border-l-emerald-500' : ''}`}
                    onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                  >
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${closeTypeBadgeClass(c.closeType)}`}>{c.closeType || '?'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-800 truncate">{c.accountName}</p>
                      <p className="text-[11px] text-slate-400 truncate">{c.maxLearning || ''}</p>
                    </div>
                    <span className={`text-xs font-semibold ${c.result === '受注' ? 'text-emerald-600' : 'text-slate-500'}`}>{c.result}</span>
                    <span className="text-[10px] text-slate-300 whitespace-nowrap">{c.learningValue != null ? c.learningValue + 'pt' : ''}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Detail */}
      {selectedItem && (
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${closeTypeBadgeClass(selectedItem.closeType)} shrink-0`}>{selectedItem.closeType || '?'}</span>
              <h3 className="font-bold text-slate-900 text-base truncate">{selectedItem.accountName}</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">{selectedItem.result}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              {role === 'admin' && (
                <button className="text-xs px-2 py-1 bg-rose-50 text-rose-500 rounded border border-rose-200 hover:bg-rose-100 transition" onClick={() => handleDelete(selectedItem.id)}>
                  <i className="fa-solid fa-trash" /> 削除
                </button>
              )}
              <button className="text-slate-400 hover:text-slate-600 p-1 ml-1" onClick={() => setSelectedId(null)}><i className="fa-solid fa-xmark text-lg" /></button>
            </div>
          </div>

          {selectedItem.result === '受注' && (
            <div className="won-banner">
              <p className="text-2xl mb-1">🎉</p>
              <p className="font-bold text-emerald-800 text-base">成約おめでとうございます！</p>
              <div className="mt-2 text-sm text-emerald-700">{WON_TYPE_DESC[selectedItem.closeType || ''] || `成約パターン：${selectedItem.closeType || '未分類'}`}</div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div className="bg-slate-50 rounded-xl p-3.5 flex flex-col gap-2.5">
              <h4 className="font-bold text-slate-600 text-[10px] uppercase tracking-wider border-b border-slate-200 pb-1">案件概要</h4>
              <div><span className="text-slate-400">トラック：</span><span className="font-bold">{selectedItem.track}</span></div>
              <div><span className="text-slate-400">事前仮説：</span><span className="text-slate-700">{selectedItem.hypothesis || '-'}</span></div>
              <div><span className="text-slate-400">仮説結果：</span><span className="font-bold">{selectedItem.hypothesisResult || '-'}</span></div>
              <div><span className="text-slate-400">学習価値：</span><span className="font-bold">{selectedItem.learningValue != null ? selectedItem.learningValue + ' / 100' : '-'}</span></div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3.5 flex flex-col gap-2.5">
              <h4 className="font-bold text-slate-600 text-[10px] uppercase tracking-wider border-b border-slate-200 pb-1">相手視点分析</h4>
              <div><span className="text-slate-400">最初の認識：</span><span className="text-slate-700">{selectedItem.roleStart || '-'}</span></div>
              <div><span className="text-slate-400">最後の認識：</span><span className="text-slate-700">{selectedItem.roleEnd || '-'}</span></div>
              <div><span className="text-slate-400">変化地点：</span><span className="text-slate-700">{selectedItem.roleChange || '-'}</span></div>
              <div><span className="text-slate-400">欲しかったもの：</span><span className="font-bold text-slate-700">{selectedItem.wanted || '-'}</span></div>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3.5 flex flex-col gap-2.5">
              <h4 className="font-bold text-emerald-700 text-[10px] uppercase tracking-wider border-b border-emerald-200 pb-1">学びと再アプローチ</h4>
              <div><span className="text-emerald-700">失注/受注理由：</span><p className="text-slate-700 mt-0.5">{selectedItem.conclusionReason || '-'}</p></div>
              <div><span className="text-emerald-700">最大の学び：</span><p className="text-slate-700 mt-0.5">{selectedItem.maxLearning || '-'}</p></div>
              <div><span className="text-emerald-700">再アプローチ：</span><span className="font-bold">{selectedItem.reapproachRating || '-'}</span></div>
            </div>
          </div>

          {/* Raw output accordion */}
          {selectedItem.rawOutput && (
            <div>
              <button
                className="text-xs text-slate-400 hover:text-indigo-500 flex items-center gap-1 transition"
                onClick={() => setExpandedRaw(expandedRaw === selectedItem.id ? null : selectedItem.id)}
              >
                <i className={`fa-solid fa-chevron-${expandedRaw === selectedItem.id ? 'up' : 'down'} text-[9px]`} />
                詳細 {expandedRaw === selectedItem.id ? '▲' : '▼'}
              </button>
              {expandedRaw === selectedItem.id && (
                <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 whitespace-pre-wrap max-h-96 overflow-y-auto cs">
                  {selectedItem.rawOutput}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
