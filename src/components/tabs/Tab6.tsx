import { useState } from 'react'
import type { AppData, Prompts, PostStock, OtherAnalysisResult, OwnPostAnalysis } from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI } from '../../App'
import { uid, todayStr } from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'

type SubTab = 'stocks' | 'own' | 'generate'

interface Tab6Props {
  data: AppData
  saveData: (fn: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
}

// ── parsers ────────────────────────────────────────────────────

function parseOtherAnalysis(raw: string): OtherAnalysisResult | null {
  const block = raw.match(/={1,3}OTHER_ANALYSIS_START={1,3}([\s\S]*?)={1,3}OTHER_ANALYSIS_END={1,3}/)?.[1]
  if (!block) return null
  const pick = (label: string) => {
    const m = block.match(new RegExp(`${label}\\s*[:：]\\s*([\\s\\S]+?)(?=\\n[^\n]+[:：]|$)`))
    return m ? m[1].trim() : ''
  }
  const typeName = pick('型名（タグ用）') || pick('型名')
  if (!typeName) return null
  return {
    typeName,
    persona: pick('推定ペルソナ'),
    emotionHook: pick('感情のフック'),
    structure: pick('文章の構造'),
    transferable: pick('転用可能な要素'),
    rawOutput: raw,
    analyzedAt: new Date().toISOString(),
  }
}

function parseOwnAnalysis(raw: string): Omit<OwnPostAnalysis, 'id' | 'createdAt' | 'postText' | 'engagementStats' | 'rawOutput'> | null {
  const block = raw.match(/={1,3}OWN_ANALYSIS_START={1,3}([\s\S]*?)={1,3}OWN_ANALYSIS_END={1,3}/)?.[1]
  if (!block) return null
  const pick = (label: string) => {
    const m = block.match(new RegExp(`${label}\\s*[:：]\\s*([\\s\\S]+?)(?=\\n[^\n]+[:：]|$)`))
    return m ? m[1].trim() : ''
  }
  const evaluation = pick('評価')
  if (!evaluation) return null
  return {
    evaluation,
    goodPoints: pick('良かった点'),
    badPoints: pick('スベった理由'),
    readerReason: pick('読者の反応理由'),
    improvementPoint: pick('今すぐ直すべき1点'),
  }
}

function parsePostGen(raw: string): { aim: string; posts: Array<{ label: string; text: string }> } | null {
  const block = raw.match(/={1,3}POST_GEN_START={1,3}([\s\S]*?)={1,3}POST_GEN_END={1,3}/)?.[1]
  if (!block) return null
  const aimM = block.match(/狙い・テーマ\s*[:：]\s*([\s\S]+?)(?=\n案\d|$)/)
  const aim = aimM ? aimM[1].trim() : ''
  const posts: Array<{ label: string; text: string }> = []
  const re = /案(\d+)([^：:\n]*)\s*[:：]\s*([\s\S]+?)(?=\n案\d|$)/g
  let m
  while ((m = re.exec(block)) !== null) {
    const subtitle = (m[2] || '').trim().replace(/^[（(]|[）)]$/g, '')
    const label = subtitle ? `案${m[1]}（${subtitle}）` : `案${m[1]}`
    const text = m[3].trim()
    if (text) posts.push({ label, text })
  }
  if (!aim && posts.length === 0) return null
  return { aim, posts }
}

// ── sub-components ─────────────────────────────────────────────

function StockBadge({ status }: { status: PostStock['status'] }) {
  return status === 'analyzed'
    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">分析済</span>
    : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">未分析</span>
}

function EvalBadge({ val }: { val: string }) {
  const map: Record<string, string> = {
    '大成功': 'bg-emerald-100 text-emerald-700',
    '成功': 'bg-blue-100 text-blue-700',
    '平凡': 'bg-slate-100 text-slate-500',
    '失敗': 'bg-rose-100 text-rose-700',
  }
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${map[val] || 'bg-slate-100 text-slate-500'}`}>{val}</span>
}

// ── StocksSubTab ───────────────────────────────────────────────

function StocksSubTab({ data, saveData, prompts, role, toast }: Tab6Props) {
  const stocks = data.postStocks || []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'unanalyzed' | 'analyzed'>('all')
  const [analysisOutput, setAnalysisOutput] = useState('')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  // manual add
  const [addOpen, setAddOpen] = useState(false)
  const [manualPostText, setManualPostText] = useState('')
  const [manualRawText, setManualRawText] = useState('')
  const [manualDateTime, setManualDateTime] = useState('')
  const [manualEngagement, setManualEngagement] = useState('')

  const selected = stocks.find(s => s.id === selectedId) || null
  const filtered = stocks.filter(s => filterStatus === 'all' ? true : s.status === filterStatus)
    .slice().reverse()

  function buildPrompt(stock: PostStock): string {
    const tmpl = prompts.OS4_OTHER_ANALYSIS || ''
    return tmpl
      .replace('{{targetPostText}}', stock.postRawText || stock.postText)
      .replace('{{engagementData}}', [
        stock.postDateTime && `投稿日時: ${stock.postDateTime}`,
        stock.engagementStats && `エンゲージメント: ${stock.engagementStats}`,
      ].filter(Boolean).join('\n') || '（データなし）')
  }

  function handleCopyPrompt() {
    if (!selected) return
    const prompt = buildPrompt(selected)
    copyText(prompt, () => {
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    })
  }

  function handleParseAnalysis() {
    setAnalysisError(null)
    const parsed = parseOtherAnalysis(analysisOutput)
    if (!parsed) {
      setAnalysisError('AI出力の形式が認識できませんでした。===OTHER_ANALYSIS_START=== から ===OTHER_ANALYSIS_END=== まで含めて貼り付けてください。')
      return
    }
    saveData(prev => ({
      ...prev,
      postStocks: (prev.postStocks || []).map(s =>
        s.id === selectedId ? { ...s, status: 'analyzed', otherAnalysis: parsed } : s
      ),
    }))
    setAnalysisOutput('')
    toast.show('分析結果を保存しました')
  }

  function handleDeleteStock(id: string) {
    saveData(prev => ({ ...prev, postStocks: (prev.postStocks || []).filter(s => s.id !== id) }))
    if (selectedId === id) setSelectedId(null)
    toast.show('ストックを削除しました')
  }

  function handleAddManual() {
    if (!manualPostText.trim()) { toast.show('投稿テキスト（要約）は必須です', 2000); return }
    const stock: PostStock = {
      id: uid(), createdAt: new Date().toISOString(),
      sourceType: 'manual',
      accountName: '手動追加',
      channel: 'twitter',
      postText: manualPostText,
      postRawText: manualRawText || undefined,
      postDateTime: manualDateTime || undefined,
      engagementStats: manualEngagement || undefined,
      status: 'unanalyzed',
    }
    saveData(prev => ({ ...prev, postStocks: [...(prev.postStocks || []), stock] }))
    setManualPostText(''); setManualRawText(''); setManualDateTime(''); setManualEngagement('')
    setAddOpen(false)
    toast.show('ストックに追加しました')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {(['all', 'unanalyzed', 'analyzed'] as const).map(f => (
            <button key={f} className={`text-[11px] font-semibold px-3 py-1 rounded-lg transition ${filterStatus === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setFilterStatus(f)}>
              {f === 'all' ? `すべて（${stocks.length}）` : f === 'unanalyzed' ? `未分析（${stocks.filter(s => s.status === 'unanalyzed').length}）` : `分析済（${stocks.filter(s => s.status === 'analyzed').length}）`}
            </button>
          ))}
        </div>
        <button className="btn-sec text-xs py-2 ml-auto" onClick={() => setAddOpen(v => !v)}>
          <i className="fa-solid fa-plus mr-1" />手動追加
        </button>
      </div>

      {/* manual add form */}
      {addOpen && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-sm font-bold text-slate-700">投稿を手動追加</p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">投稿要約（1行）<span className="text-rose-500 ml-1">*</span></label>
            <input className="input-base text-xs" value={manualPostText} onChange={e => setManualPostText(e.target.value)} placeholder="相手の投稿を1行で要約" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">投稿原文</label>
            <textarea rows={4} className="input-base cs text-xs resize-y" value={manualRawText} onChange={e => setManualRawText(e.target.value)} placeholder="投稿本文をそのまま貼り付け" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">投稿日時</label>
              <input className="input-base text-xs" value={manualDateTime} onChange={e => setManualDateTime(e.target.value)} placeholder="例: 2026/06/21 14:00" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">エンゲージメント</label>
              <input className="input-base text-xs" value={manualEngagement} onChange={e => setManualEngagement(e.target.value)} placeholder="例: いいね150・RT20" />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-sec text-xs py-2 flex-1" onClick={() => setAddOpen(false)}>キャンセル</button>
            <button className="btn-primary text-xs py-2 flex-1 justify-center" onClick={handleAddManual}>追加</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          <i className="fa-solid fa-box-archive text-2xl mb-2 block" />
          ストックがありません。OS②でタッチを記録すると自動で蓄積されます。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(stock => (
            <div
              key={stock.id}
              className={`card p-3 cursor-pointer transition ${selectedId === stock.id ? 'ring-2 ring-indigo-400' : 'hover:shadow-md'}`}
              onClick={() => { setSelectedId(stock.id); setAnalysisOutput(''); setAnalysisError(null); setCopyState('idle') }}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StockBadge status={stock.status} />
                    <span className="text-[10px] text-slate-400">{stock.accountName}</span>
                    {stock.postDateTime && <span className="text-[10px] text-slate-400">{stock.postDateTime}</span>}
                    {stock.engagementStats && <span className="text-[10px] text-emerald-600 font-medium">{stock.engagementStats}</span>}
                  </div>
                  <p className="text-xs text-slate-700 line-clamp-2">{stock.postRawText || stock.postText}</p>
                  {stock.otherAnalysis && (
                    <p className="text-[10px] text-indigo-600 font-semibold mt-1">型: {stock.otherAnalysis.typeName}</p>
                  )}
                </div>
                {role === 'admin' && (
                  <button className="shrink-0 text-slate-300 hover:text-rose-500 transition text-sm p-1" onClick={e => { e.stopPropagation(); handleDeleteStock(stock.id) }}>
                    <i className="fa-solid fa-trash-can" />
                  </button>
                )}
              </div>

              {/* analysis panel */}
              {selectedId === stock.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
                  {stock.otherAnalysis ? (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex flex-col gap-1.5 text-xs">
                      <p className="font-bold text-indigo-700 text-[10px] uppercase tracking-wide">分析結果</p>
                      <p><span className="text-slate-400">型名</span> <span className="font-semibold text-indigo-800">{stock.otherAnalysis.typeName}</span></p>
                      <p><span className="text-slate-400">ペルソナ</span> <span className="text-slate-700">{stock.otherAnalysis.persona}</span></p>
                      <p><span className="text-slate-400">感情フック</span> <span className="text-slate-700">{stock.otherAnalysis.emotionHook}</span></p>
                      <div><span className="text-slate-400">構造</span><p className="text-slate-700 whitespace-pre-wrap mt-0.5 ml-1">{stock.otherAnalysis.structure}</p></div>
                      <p><span className="text-slate-400">転用ポイント</span> <span className="text-slate-700">{stock.otherAnalysis.transferable}</span></p>
                      <button className="btn-sec text-[10px] py-1 px-2 self-start mt-1" onClick={() => saveData(prev => ({ ...prev, postStocks: (prev.postStocks || []).map(s => s.id === stock.id ? { ...s, status: 'unanalyzed', otherAnalysis: undefined } : s) }))}>
                        分析をリセット
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <button
                        className={`btn-sec text-xs py-2 justify-center ${copyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                        onClick={handleCopyPrompt}
                      >
                        <i className={`fa-solid ${copyState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
                        {copyState === 'copied' ? '✓ コピーしました' : '他社投稿分析プロンプトをコピー'}
                      </button>
                      <p className="text-[10px] text-slate-400 text-center">↓ 外部AIに貼り付けて実行 → 出力をここに貼る</p>
                      <textarea
                        rows={4}
                        className="input-base cs text-xs resize-y"
                        placeholder="AI出力をここに貼り付け（===OTHER_ANALYSIS_START=== から ===OTHER_ANALYSIS_END=== まで）"
                        value={analysisOutput}
                        onChange={e => { setAnalysisOutput(e.target.value); setAnalysisError(null) }}
                      />
                      {analysisError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{analysisError}</p>}
                      <button
                        className="btn-primary text-xs py-2 justify-center"
                        style={{ background: '#4f46e5' }}
                        disabled={!analysisOutput.trim()}
                        onClick={handleParseAnalysis}
                      >
                        <i className="fa-solid fa-bolt mr-1" />分析結果を保存
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── OwnSubTab ──────────────────────────────────────────────────

function OwnSubTab({ data, saveData, prompts, role, toast }: Tab6Props) {
  const analyses = data.ownPostAnalyses || []
  const [formOpen, setFormOpen] = useState(false)
  const [ownPostText, setOwnPostText] = useState('')
  const [ownEngagement, setOwnEngagement] = useState('')
  const [ownAiOutput, setOwnAiOutput] = useState('')
  const [ownCopyState, setOwnCopyState] = useState<'idle' | 'copied'>('idle')
  const [ownError, setOwnError] = useState<string | null>(null)
  const [selectedAnalId, setSelectedAnalId] = useState<string | null>(null)

  function buildPrompt() {
    const tmpl = prompts.OS4_OWN_ANALYSIS || ''
    return tmpl
      .replace('{{ownPostText}}', ownPostText)
      .replace('{{engagementData}}', ownEngagement || '（データなし）')
  }

  function handleCopyPrompt() {
    if (!ownPostText.trim()) { toast.show('投稿本文を入力してください', 2000); return }
    copyText(buildPrompt(), () => {
      setOwnCopyState('copied')
      setTimeout(() => setOwnCopyState('idle'), 2000)
    })
  }

  function handleParseOwn() {
    setOwnError(null)
    const parsed = parseOwnAnalysis(ownAiOutput)
    if (!parsed) {
      setOwnError('AI出力の形式が認識できませんでした。===OWN_ANALYSIS_START=== から ===OWN_ANALYSIS_END=== まで含めて貼り付けてください。')
      return
    }
    const entry: OwnPostAnalysis = {
      id: uid(),
      createdAt: new Date().toISOString(),
      postText: ownPostText,
      engagementStats: ownEngagement,
      rawOutput: ownAiOutput,
      ...parsed,
    }
    saveData(prev => ({ ...prev, ownPostAnalyses: [...(prev.ownPostAnalyses || []), entry] }))
    setOwnPostText(''); setOwnEngagement(''); setOwnAiOutput('')
    setFormOpen(false)
    toast.show('自社投稿分析を保存しました')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button className="btn-primary text-xs py-2" onClick={() => setFormOpen(v => !v)}>
          <i className="fa-solid fa-plus mr-1" />新しい投稿を分析
        </button>
      </div>

      {formOpen && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-sm font-bold text-slate-700">自社投稿を分析</p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">自分の投稿原文<span className="text-rose-500 ml-1">*</span></label>
            <textarea rows={5} className="input-base cs text-xs resize-y" value={ownPostText} onChange={e => setOwnPostText(e.target.value)} placeholder="分析したい自分の投稿本文を貼り付け" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">エンゲージメント実績</label>
            <input className="input-base text-xs" value={ownEngagement} onChange={e => setOwnEngagement(e.target.value)} placeholder="例: いいね150・RT20・コメント5" />
          </div>

          <div className="bg-white border border-violet-100 rounded-xl p-3 flex flex-col gap-2">
            <button
              className={`btn-sec text-xs py-2 justify-center ${ownCopyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
              onClick={handleCopyPrompt}
            >
              <i className={`fa-solid ${ownCopyState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
              {ownCopyState === 'copied' ? '✓ コピーしました' : '自社投稿分析プロンプトをコピー'}
            </button>
            <p className="text-[10px] text-slate-400 text-center">↓ 外部AIに貼り付けて実行 → 出力をここに貼る</p>
            <textarea
              rows={3}
              className="input-base cs text-xs resize-y"
              placeholder="AI出力をここに貼り付け（===OWN_ANALYSIS_START=== から ===OWN_ANALYSIS_END=== まで）"
              value={ownAiOutput}
              onChange={e => { setOwnAiOutput(e.target.value); setOwnError(null) }}
            />
            {ownError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{ownError}</p>}
            <div className="flex gap-2">
              <button className="btn-sec text-xs py-2 flex-1" onClick={() => { setFormOpen(false); setOwnPostText(''); setOwnEngagement(''); setOwnAiOutput('') }}>キャンセル</button>
              <button className="btn-primary text-xs py-2 flex-1 justify-center" style={{ background: '#4f46e5' }} disabled={!ownAiOutput.trim()} onClick={handleParseOwn}>
                <i className="fa-solid fa-bolt mr-1" />分析を保存
              </button>
            </div>
          </div>
        </div>
      )}

      {analyses.length === 0 && !formOpen ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          <i className="fa-solid fa-pen-to-square text-2xl mb-2 block" />
          まだ自社投稿の分析がありません。「新しい投稿を分析」から追加してください。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {[...analyses].reverse().map(a => (
            <div
              key={a.id}
              className={`card p-3 cursor-pointer transition ${selectedAnalId === a.id ? 'ring-2 ring-violet-400' : 'hover:shadow-md'}`}
              onClick={() => setSelectedAnalId(prev => prev === a.id ? null : a.id)}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <EvalBadge val={a.evaluation} />
                    <span className="text-[10px] text-slate-400">{a.createdAt.slice(0, 10)}</span>
                    {a.engagementStats && <span className="text-[10px] text-emerald-600">{a.engagementStats}</span>}
                  </div>
                  <p className="text-xs text-slate-700 line-clamp-2">{a.postText}</p>
                </div>
                {role === 'admin' && (
                  <button className="shrink-0 text-slate-300 hover:text-rose-500 transition text-sm p-1" onClick={e => { e.stopPropagation(); saveData(prev => ({ ...prev, ownPostAnalyses: (prev.ownPostAnalyses || []).filter(x => x.id !== a.id) })); toast.show('削除しました') }}>
                    <i className="fa-solid fa-trash-can" />
                  </button>
                )}
              </div>
              {selectedAnalId === a.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-1.5 text-xs">
                  <p><span className="text-slate-400">良かった点</span> <span className="text-slate-700">{a.goodPoints}</span></p>
                  <p><span className="text-slate-400">スベった理由</span> <span className="text-rose-600">{a.badPoints}</span></p>
                  <p><span className="text-slate-400">反応理由</span> <span className="text-slate-700">{a.readerReason}</span></p>
                  <p><span className="text-slate-400">今すぐ直すべき1点</span> <span className="text-amber-700 font-semibold">{a.improvementPoint}</span></p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── GenerateSubTab ─────────────────────────────────────────────

const STD_CASES = [
  { label: '共感', role: '「これ私だ」を起こす。読者の現状を言語化する。感情：疲れ、違和感、モヤモヤ' },
  { label: '問題再定義', role: '本人が気づいていない問題を発見させる。既存努力は否定しない。読者を責めない。' },
  { label: '常識否定', role: '思い込みを壊す。ただし全否定禁止。敵を作らない。' },
  { label: '理想未来', role: '欲求を作る。「そうなりたい」を起こす。売り込まない。理想を描く。' },
  { label: '解決策＋不安除去', role: '安心感を与える。営業しない。押さない。「こんな考え方もある」くらい。' },
]

function buildPostGenPromptWithTypes(
  baseTemplate: string,
  myProfile: string,
  types: OtherAnalysisResult[],
  improvementPoint: string
): string {
  const SEP = '━━━━━━━━━━━━━━━━━━'
  const preambleEnd = baseTemplate.indexOf(`${SEP}\n【案1】`)
  const preamble = preambleEnd >= 0 ? baseTemplate.slice(0, preambleEnd) : ''
  const afterStart = baseTemplate.indexOf(`${SEP}\n【文章ルール】`)
  const afterRaw = afterStart >= 0 ? baseTemplate.slice(afterStart) : ''
  const outputIdx = afterRaw.indexOf('【出力フォーマット】')
  const commonRules = outputIdx >= 0 ? afterRaw.slice(0, outputIdx).trimEnd() : afterRaw.trimEnd()

  const caseParts: string[] = []
  const outputLines: string[] = []

  types.forEach((t, i) => {
    caseParts.push(
`${SEP}
【案${i + 1}（${t.typeName}型）】
役割：他社分析で抽出した型を、自社ターゲット向けに転用する
文章の構造：${t.structure}
感情フック：${t.emotionHook}
転用可能な要素：${t.transferable}`
    )
    outputLines.push(`案${i + 1}（${t.typeName}型）: `)
  })

  STD_CASES.slice(types.length).forEach((c, i) => {
    const num = types.length + i + 1
    caseParts.push(
`${SEP}
【案${num}（${c.label}）】
役割：${c.role}`
    )
    outputLines.push(`案${num}（${c.label}）: `)
  })

  const outputFormat = `【出力フォーマット】※記号・ラベルを変更しないこと
===POST_GEN_START===
狙い・テーマ: （今回の投稿群で狙う感情の変化や目的）
${outputLines.join('\n')}
===POST_GEN_END===`

  return [preamble.trimEnd(), caseParts.join('\n\n'), commonRules, outputFormat].join('\n\n')
    .replace('{{myProfile}}', myProfile || '（未設定）')
    .replace('{{templateName}}', types.map(t => t.typeName).join('、'))
    .replace('{{templateStructure}}', types.map(t => t.structure).join('\n---\n'))
    .replace('{{improvementPoint}}', improvementPoint || '（なし）')
}

function GenerateSubTab({ data, saveData, prompts, toast }: Tab6Props) {
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileDraft, setProfileDraft] = useState(data.myProfile || '')
  const [selectedTypes, setSelectedTypes] = useState<OtherAnalysisResult[]>([])
  const [manualTemplate, setManualTemplate] = useState('')
  const [manualStructure, setManualStructure] = useState('')
  const [selectedImprovement, setSelectedImprovement] = useState('')
  const [genCopyState, setGenCopyState] = useState<'idle' | 'copied'>('idle')
  const [genOutput, setGenOutput] = useState('')
  const [genParsed, setGenParsed] = useState<{ aim: string; posts: Array<{ label: string; text: string }> } | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [copyPostState, setCopyPostState] = useState<Record<number, boolean>>({})

  const analyzedStocks = (data.postStocks || []).filter(s => s.status === 'analyzed' && s.otherAnalysis)
  const ownAnalyses = data.ownPostAnalyses || []

  function toggleType(t: OtherAnalysisResult) {
    setSelectedTypes(prev => {
      const exists = prev.some(x => x.typeName === t.typeName)
      if (exists) return prev.filter(x => x.typeName !== t.typeName)
      if (prev.length >= 3) return prev
      return [...prev, t]
    })
  }

  function buildPrompt() {
    const tmpl = prompts.OS4_POST_GEN || ''
    if (selectedTypes.length > 0) {
      return buildPostGenPromptWithTypes(tmpl, data.myProfile || '', selectedTypes, selectedImprovement)
    }
    return tmpl
      .replace('{{myProfile}}', data.myProfile || '（未設定）')
      .replace('{{templateName}}', manualTemplate || '（未選択）')
      .replace('{{templateStructure}}', manualStructure || '（未入力）')
      .replace('{{improvementPoint}}', selectedImprovement || '（なし）')
  }

  function handleCopyGenPrompt() {
    copyText(buildPrompt(), () => {
      setGenCopyState('copied')
      setTimeout(() => setGenCopyState('idle'), 2000)
    })
  }

  function handleParseGen() {
    setGenError(null)
    const parsed = parsePostGen(genOutput)
    if (!parsed) {
      setGenError('AI出力の形式が認識できませんでした。===POST_GEN_START=== から ===POST_GEN_END=== まで含めて貼り付けてください。')
      return
    }
    setGenParsed(parsed)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* myProfile */}
      <div className="card p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-700 flex-1">自社プロフィール設定</p>
          {!editingProfile && (
            <button className="btn-sec text-xs py-1.5" onClick={() => { setProfileDraft(data.myProfile || ''); setEditingProfile(true) }}>
              <i className="fa-solid fa-pen text-xs mr-1" />編集
            </button>
          )}
        </div>
        {editingProfile ? (
          <>
            <textarea
              rows={5}
              className="input-base cs text-xs resize-y"
              value={profileDraft}
              onChange={e => setProfileDraft(e.target.value)}
              placeholder={'例：\n商品・サービス: オンラインコーチング（月額3万円）\nターゲット: 副業で月10万を目指すサラリーマン\nSNSアカウントの目的: 集客・信頼構築\n自分のキャラクター: 元IT企業サラリーマン、失敗経験を正直に話すスタイル'}
            />
            <div className="flex gap-2">
              <button className="btn-sec text-xs py-2 flex-1" onClick={() => setEditingProfile(false)}>キャンセル</button>
              <button className="btn-primary text-xs py-2 flex-1 justify-center" onClick={() => {
                saveData(prev => ({ ...prev, myProfile: profileDraft }))
                setEditingProfile(false)
                toast.show('プロフィールを保存しました')
              }}>保存</button>
            </div>
          </>
        ) : (
          data.myProfile
            ? <p className="text-xs text-slate-600 whitespace-pre-wrap">{data.myProfile}</p>
            : <p className="text-xs text-slate-400 italic">未設定です。「編集」から自社の属性・ターゲット・商品情報を入力してください。プロンプトに自動挿入されます。</p>
        )}
      </div>

      {/* 型の選択 */}
      <div className="card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-700 flex-1">使用する「型」を選択</p>
          {selectedTypes.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{selectedTypes.length}件選択中</span>
          )}
        </div>

        {analyzedStocks.length > 0 ? (
          <>
            <p className="text-[11px] text-slate-500">
              分析済みストックから最大3件チェック → 選んだ型が案1〜Nに使われ、残りは標準案に
            </p>
            <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto cs">
              {analyzedStocks.map(s => {
                const t = s.otherAnalysis!
                const isSelected = selectedTypes.some(x => x.typeName === t.typeName)
                const isDisabled = !isSelected && selectedTypes.length >= 3
                return (
                  <label
                    key={s.id}
                    className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition ${
                      isSelected ? 'bg-indigo-50 border-indigo-300' : isDisabled ? 'bg-slate-50 border-slate-100 opacity-50' : 'bg-white border-slate-200 hover:border-indigo-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={() => toggleType(t)}
                      className="mt-0.5 accent-indigo-600 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${isSelected ? 'text-indigo-800' : 'text-slate-700'}`}>{t.typeName}</p>
                      {isSelected && t.structure && (
                        <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{t.structure}</p>
                      )}
                      <p className="text-[10px] text-slate-400">{s.accountName}</p>
                    </div>
                  </label>
                )
              })}
            </div>

            {selectedTypes.length > 0 && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 text-[11px] text-emerald-800">
                <i className="fa-solid fa-wand-magic-sparkles mr-1 text-emerald-500" />
                <span className="font-semibold">型ベース生成モード：</span>
                {selectedTypes.map((t, i) => (
                  <span key={i}> 案{i+1}「{t.typeName}」</span>
                ))}
                {selectedTypes.length < 5 && (
                  <span className="text-slate-400"> ＋ 案{selectedTypes.length+1}〜5は標準案</span>
                )}
                <button className="ml-2 text-[10px] text-slate-400 hover:text-slate-600 underline" onClick={() => setSelectedTypes([])}>解除</button>
              </div>
            )}

            <p className="text-[10px] text-slate-400 text-center">型を選ばない場合は手動入力または標準5案で生成↓</p>
          </>
        ) : (
          <p className="text-xs text-slate-400">まだ分析済みストックがありません。「他社投稿ストック」タブで投稿を分析してください。</p>
        )}

        {selectedTypes.length === 0 && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">型名（任意）</label>
              <input className="input-base text-xs" value={manualTemplate} onChange={e => setManualTemplate(e.target.value)} placeholder="例:「常識の否定→実体験→新しい正解」型" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">文章の構造（任意）</label>
              <textarea rows={3} className="input-base cs text-xs resize-y" value={manualStructure} onChange={e => setManualStructure(e.target.value)} placeholder="骨組みを箇条書きで（未入力なら標準5案で生成）" />
            </div>
          </>
        )}
      </div>

      {/* 改善点（任意） */}
      {ownAnalyses.length > 0 && (
        <div className="card p-4 flex flex-col gap-2">
          <p className="text-sm font-bold text-slate-700">前回の改善点（任意）</p>
          <select className="input-base text-xs" value={selectedImprovement} onChange={e => setSelectedImprovement(e.target.value)}>
            <option value="">（使わない）</option>
            {[...ownAnalyses].reverse().map(a => (
              <option key={a.id} value={a.improvementPoint}>{a.createdAt.slice(0, 10)} — {a.improvementPoint}</option>
            ))}
          </select>
        </div>
      )}

      {/* 生成 */}
      <div className="card p-4 flex flex-col gap-3">
        <p className="text-sm font-bold text-slate-700">投稿案を生成</p>
        <button
          className={`btn-sec text-xs py-2.5 justify-center ${genCopyState === 'copied' ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
          onClick={handleCopyGenPrompt}
        >
          <i className={`fa-solid ${genCopyState === 'copied' ? 'fa-check' : 'fa-clipboard'} mr-1`} />
          {genCopyState === 'copied'
            ? '✓ コピーしました'
            : selectedTypes.length > 0
              ? `型ベース投稿生成プロンプトをコピー（${selectedTypes.length}型 ＋ 標準案）`
              : '投稿生成プロンプトをコピー'
          }
        </button>
        <p className="text-[10px] text-slate-400 text-center">↓ 外部AIに貼り付けて実行 → 出力をここに貼る</p>
        <textarea
          rows={4}
          className="input-base cs text-xs resize-y"
          placeholder="AI出力をここに貼り付け（===POST_GEN_START=== から ===POST_GEN_END=== まで）"
          value={genOutput}
          onChange={e => { setGenOutput(e.target.value); setGenError(null); setGenParsed(null) }}
        />
        {genError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{genError}</p>}
        <button
          className="btn-primary text-xs py-2.5 justify-center"
          style={{ background: '#4f46e5' }}
          disabled={!genOutput.trim()}
          onClick={handleParseGen}
        >
          <i className="fa-solid fa-bolt mr-1" />投稿案を表示
        </button>

        {/* generated posts */}
        {genParsed && (
          <div className="flex flex-col gap-3 mt-1">
            {genParsed.aim && (
              <div className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wide mb-0.5">狙い・テーマ</p>
                <p className="text-xs text-violet-800">{genParsed.aim}</p>
              </div>
            )}
            {genParsed.posts.map((post, i) => {
              const isKata = selectedTypes.some(t => post.label.includes(t.typeName))
              return (
                <div key={i} className={`border rounded-xl p-3 flex flex-col gap-2 ${isKata ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isKata ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-50 text-indigo-600'}`}>
                      {isKata && <i className="fa-solid fa-wand-magic-sparkles mr-1" />}
                      {post.label}
                    </span>
                    <button
                      className={`ml-auto btn-sec text-[10px] py-1 px-2 ${copyPostState[i] ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                      onClick={() => copyText(post.text, () => {
                        setCopyPostState(prev => ({ ...prev, [i]: true }))
                        setTimeout(() => setCopyPostState(prev => ({ ...prev, [i]: false })), 1500)
                      })}
                    >
                      {copyPostState[i] ? '✓ コピー' : 'コピー'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{post.text}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab6 ───────────────────────────────────────────────────────

export default function Tab6({ data, saveData, prompts, role, toast }: Tab6Props) {
  const [subTab, setSubTab] = useState<SubTab>('stocks')
  const stockCount = (data.postStocks || []).length
  const unanalyzedCount = (data.postStocks || []).filter(s => s.status === 'unanalyzed').length

  const SUB_TABS: { id: SubTab; label: string; icon: string }[] = [
    { id: 'stocks', label: '他社投稿ストック', icon: 'fa-box-archive' },
    { id: 'own', label: '自社投稿分析', icon: 'fa-pen-to-square' },
    { id: 'generate', label: '投稿案生成', icon: 'fa-wand-magic-sparkles' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="card p-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white text-sm font-bold shadow">④</div>
          <div>
            <h2 className="font-bold text-slate-800 text-base">OS④ 投稿分析・生成</h2>
            <p className="text-xs text-slate-400">他社のバズ投稿を解剖し、自社の勝ちパターンに変換する</p>
          </div>
          {stockCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-slate-500">ストック</span>
              <span className="font-bold text-slate-800 text-sm">{stockCount}</span>
              {unanalyzedCount > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{unanalyzedCount}未分析</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* sub-tab nav */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-2 rounded-lg transition ${subTab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setSubTab(t.id)}
          >
            <i className={`fa-solid ${t.icon}`} />
            {t.label}
          </button>
        ))}
      </div>

      {/* content */}
      {subTab === 'stocks' && <StocksSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
      {subTab === 'own' && <OwnSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
      {subTab === 'generate' && <GenerateSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
    </div>
  )
}
