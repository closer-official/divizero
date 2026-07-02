import { useState, useEffect, useRef } from 'react'
import type {
  AppData, Prompts,
  OtherPostResearch, OwnPostPDCA, GeneratedPostCandidate, PersonalityAudit,
  PostStock, Touch,
} from '../../types'
import type { Role } from '../../hooks/useAuth'
import type { ToastAPI } from '../../App'
import { uid, shortPostId, todayStr } from '../../utils/helpers'
import { copyText } from '../../utils/clipboard'

type SubTab = 'research' | 'quote' | 'post' | 'pdca' | 'lens' | 'audit' | 'constitution'

interface Tab6Props {
  data: AppData
  saveData: (fn: (prev: AppData) => AppData) => void
  prompts: Prompts
  role: Role
  toast: ToastAPI
}

// ── helpers ────────────────────────────────────────────────────

function mdSection(text: string, header: string): string {
  const re = new RegExp(`##\\s+${header}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n##|$)`)
  return (text.match(re)?.[1] || '').trim()
}

function fieldLine(text: string, label: string): string {
  const re = new RegExp(`${label}\\s*[:：]\\s*(.+)`)
  return (text.match(re)?.[1] || '').trim()
}

function bulletList(text: string): string[] {
  return text.split('\n')
    .map(l => l.replace(/^[-・*]\s*/, '').trim())
    .filter(Boolean)
}

function cleanMd(s: string): string {
  return s.replace(/\*\*([^*]*)\*\*/g, '$1').replace(/\*([^*]*)\*/g, '$1').replace(/\*/g, '').trim()
}

function cleanCandidate(item: string, ...prefixLabels: string[]): string {
  let s = cleanMd(item)
  for (const label of prefixLabels) {
    s = s.replace(new RegExp(`^${label}\\s*[：:]\\s*`), '').trim()
  }
  return cleanMd(s)
}

function migrateResearchData(r: OtherPostResearch): OtherPostResearch {
  if (!r.analysis) return r
  const a = r.analysis
  return {
    ...r,
    analysis: {
      ...a,
      cognitiveShift: cleanMd(a.cognitiveShift),
      personalitySignal: cleanMd(a.personalitySignal),
      aestheticSignal: cleanMd(a.aestheticSignal),
      twistStructure: cleanMd(a.twistStructure),
      negativeSpace: cleanMd(a.negativeSpace),
      followReason: cleanMd(a.followReason),
      quotePotential: cleanMd(a.quotePotential),
      researchNote: cleanMd(a.researchNote),
      usedLens: (a.usedLens || []).map(cleanMd).filter(Boolean),
      lensCandidates: (a.lensCandidates || []).map(s => cleanCandidate(s, 'レンズ')).filter(Boolean),
      twistCandidates: (a.twistCandidates || []).map(s => cleanCandidate(s, 'オチ', 'どんでん返し')).filter(Boolean),
      metaphorCandidates: (a.metaphorCandidates || []).map(s => cleanCandidate(s, '比喩')).filter(Boolean),
    }
  }
}

function constitutionContent(data: AppData, prompts: Prompts, key: 'personality' | 'aesthetic'): string {
  if (key === 'personality') return data.personalityConstitution?.content || prompts.PERSONALITY_CONSTITUTION || ''
  return data.aestheticConstitution?.content || prompts.AESTHETIC_CONSTITUTION || ''
}

function buildBasePrompt(spec: string, data: AppData, prompts: Prompts): string {
  const pc = constitutionContent(data, prompts, 'personality')
  const ac = constitutionContent(data, prompts, 'aesthetic')
  const suffix = pc || ac
    ? `\n\n---\n# 人格憲法（参照）\n${pc}\n\n# 美学憲法（参照）\n${ac}`
    : ''
  return spec + suffix
}

function migratePostStock(s: PostStock): OtherPostResearch {
  return {
    id: s.id,
    sourceType: s.sourceType,
    sourceText: s.postRawText || s.postText,
    summary: s.postText,
    postedAt: s.postDateTime,
    metrics: undefined,
    status: s.status === 'analyzed' ? 'researched' : 'stocked',
    legacyAnalysis: s.otherAnalysis,
    createdAt: s.createdAt,
    updatedAt: s.createdAt,
  }
}

// ── parsers ────────────────────────────────────────────────────

function parseOS01Output(raw: string): OtherPostResearch['analysis'] | null {
  if (!raw.trim()) return null
  const nigaM = raw.match(/ニヤッ度[：:]\s*(\d)/)
  const dbSection = mdSection(raw, 'DB登録候補')
  return {
    cognitiveShift: cleanMd(mdSection(raw, '認知変化')),
    usedLens: bulletList(mdSection(raw, 'レンズ分析')).map(cleanMd).filter(Boolean),
    personalitySignal: cleanMd(fieldLine(raw, '人格')),
    aestheticSignal: cleanMd(fieldLine(raw, '美学')),
    nigaDegree: nigaM ? parseInt(nigaM[1]) : 0,
    twistStructure: cleanMd(fieldLine(raw, 'どんでん返し')),
    negativeSpace: cleanMd(fieldLine(raw, '余白')),
    followReason: cleanMd(mdSection(raw, 'フォロー理由・引用されやすさ')),
    quotePotential: cleanMd(fieldLine(raw, '引用されやすさ')),
    lensCandidates: bulletList(dbSection.match(/レンズ[\s\S]*?(?=オチ|比喩|$)/)?.[0] || '').map(s => cleanCandidate(s, 'レンズ')).filter(Boolean),
    metaphorCandidates: bulletList(dbSection.match(/比喩[\s\S]*/)?.[0] || '').map(s => cleanCandidate(s, '比喩')).filter(Boolean),
    openingCandidates: [],
    endingCandidates: [],
    twistCandidates: bulletList(dbSection.match(/オチ[\s\S]*?(?=比喩|レンズ|$)/)?.[0] || '').map(s => cleanCandidate(s, 'オチ', 'どんでん返し')).filter(Boolean),
    humorCandidates: [],
    researchNote: cleanMd(mdSection(raw, '研究ノート')),
  }
}

function parseQuoteCandidates(raw: string): GeneratedPostCandidate[] {
  const candidates: GeneratedPostCandidate[] = []
  const caseRe = /##\s*案(\d+)([\s\S]*?)(?=##\s*案|##\s*自己監査|$)/g
  let m
  while ((m = caseRe.exec(raw)) !== null) {
    const block = m[2]
    const body = fieldLine(block, '本文')
    if (!body) continue
    const lens = fieldLine(block, 'レンズ')
    const nigaM = block.match(/ニヤッ度[：:]\s*(\d)/)
    candidates.push({
      id: uid(),
      type: 'quote',
      body,
      meta: {
        usedLens: lens ? [lens] : [],
        cognitiveShift: fieldLine(block, '認知変化'),
        nigaPoint: '',
        nigaDegree: nigaM ? parseInt(nigaM[1]) : 0,
        followReasonContribution: '',
        treeCount: 0,
        humanSelectionPoint: fieldLine(block, '人間の確認点'),
        endingType: fieldLine(block, '余白'),
      },
    })
  }
  return candidates
}

function parsePostCandidates(raw: string): GeneratedPostCandidate[] {
  const candidates: GeneratedPostCandidate[] = []
  const caseRe = /##\s*案(\d+)([\s\S]*?)(?=##\s*案|##\s*自己監査|$)/g
  let m
  while ((m = caseRe.exec(raw)) !== null) {
    const block = m[2]
    const body = fieldLine(block, '本文')
    if (!body) continue
    const nigaM = block.match(/ニヤッ度[：:]\s*(\d)/)
    const treeM = block.match(/ツリー数[：:]\s*(\d)/)
    candidates.push({
      id: uid(),
      type: 'normal',
      body,
      meta: {
        openingType: fieldLine(block, '冒頭型'),
        usedLens: bulletList(fieldLine(block, '使用レンズ')),
        cognitiveShift: fieldLine(block, '認知変化'),
        twistType: fieldLine(block, '裏切りの型'),
        endingType: fieldLine(block, '締め方'),
        nigaPoint: fieldLine(block, 'ニヤッの発生ポイント'),
        nigaDegree: nigaM ? parseInt(nigaM[1]) : 0,
        followReasonContribution: '',
        treeCount: (treeM && parseInt(treeM[1]) >= 1 ? 1 : 0) as 0 | 1,
        humanSelectionPoint: fieldLine(block, '人間が選ぶべきポイント'),
      },
    })
  }
  return candidates
}

function parsePersonalityAudit(raw: string, mode: PersonalityAudit['mode'], postType: PersonalityAudit['postType'], targetText: string): PersonalityAudit | null {
  const judgM = raw.match(/判定[：:]\s*(OK|WARNING|NG)/i)
  if (!judgM) return null
  return {
    id: uid(),
    mode,
    postType,
    targetText,
    judgment: judgM[1].toUpperCase() as 'OK' | 'WARNING' | 'NG',
    detectedItems: mdSection(raw, '検知項目と根拠'),
    impact: mdSection(raw, '人格への影響'),
    fixInstruction: mdSection(raw, '修正指示'),
    returnPoint: mdSection(raw, '回帰ポイント'),
    rawOutput: raw,
    createdAt: new Date().toISOString(),
  }
}

// ── sub-components ─────────────────────────────────────────────

function StatusBadge({ status }: { status: OtherPostResearch['status'] }) {
  return status === 'researched'
    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">研究済</span>
    : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">未研究</span>
}

function JudgmentBadge({ j }: { j: 'OK' | 'WARNING' | 'NG' }) {
  const cls = { OK: 'bg-emerald-100 text-emerald-700', WARNING: 'bg-amber-100 text-amber-700', NG: 'bg-rose-100 text-rose-700' }[j]
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{j}</span>
}

function NigaBadge({ n }: { n: number }) {
  return <span className="text-[10px] font-medium text-violet-600">ニヤッ {'★'.repeat(n)}{'☆'.repeat(3 - n)}</span>
}

function CopyBtn({ text, label, copiedLabel = '✓ コピー' }: { text: string; label: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={`btn-sec text-xs py-2 justify-center w-full ${copied ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
      onClick={() => copyText(text, () => { setCopied(true); setTimeout(() => setCopied(false), 2000) })}
    >
      <i className={`fa-solid ${copied ? 'fa-check' : 'fa-clipboard'} mr-1`} />
      {copied ? copiedLabel : label}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════
// 1. 他者投稿研究
// ══════════════════════════════════════════════════════════════

function ResearchSubTab({ data, saveData, prompts, role, toast }: Tab6Props) {
  const researches = data.otherPostResearches || []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [sourceText, setSourceText] = useState('')
  const [summary, setSummary] = useState('')
  const [postedAt, setPostedAt] = useState('')
  const [likes, setLikes] = useState('')
  const [replies, setReplies] = useState('')
  const [reposts, setReposts] = useState('')
  const [saves, setSaves] = useState('')
  const [impressions, setImpressions] = useState('')
  const [rawOutput, setRawOutput] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'stocked' | 'researched'>('all')

  const selected = researches.find(r => r.id === selectedId) ?? null
  const filtered = [...researches]
    .filter(r => filter === 'all' ? true : r.status === filter)
    .reverse()

  function buildOS01Prompt(r: OtherPostResearch): string {
    const spec = prompts.OS01_ANALYSIS || ''
    const base = buildBasePrompt(spec, data, prompts)
    const metricsStr = r.metrics
      ? Object.entries(r.metrics).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(', ')
      : 'なし'
    return `${base}\n\n---\n# 入力\ntarget_text: |\n  ${r.sourceText.split('\n').join('\n  ')}\nsource: manual\nmetrics: ${metricsStr}`
  }

  function handleAdd() {
    if (!sourceText.trim()) { toast.show('投稿本文は必須です', 2000); return }
    const r: OtherPostResearch = {
      id: uid(),
      sourceType: 'manual',
      sourceText: sourceText.trim(),
      summary: summary.trim() || sourceText.slice(0, 60),
      postedAt: postedAt || undefined,
      metrics: {
        likes: likes ? Number(likes) : undefined,
        replies: replies ? Number(replies) : undefined,
        reposts: reposts ? Number(reposts) : undefined,
        saves: saves ? Number(saves) : undefined,
        impressions: impressions ? Number(impressions) : undefined,
      },
      status: 'stocked',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    saveData(prev => ({ ...prev, otherPostResearches: [...(prev.otherPostResearches || []), r] }))
    setSourceText(''); setSummary(''); setPostedAt('')
    setLikes(''); setReplies(''); setReposts(''); setSaves(''); setImpressions('')
    setAddOpen(false)
    toast.show('ストックに追加しました')
  }

  function handleParseAnalysis() {
    setParseError(null)
    const parsed = parseOS01Output(rawOutput)
    if (!parsed) { setParseError('AI出力を認識できませんでした。OS①の出力をそのまま貼り付けてください。'); return }
    saveData(prev => ({
      ...prev,
      otherPostResearches: (prev.otherPostResearches || []).map(r =>
        r.id === selectedId ? { ...r, analysis: parsed, status: 'researched', updatedAt: new Date().toISOString() } : r
      ),
    }))
    setRawOutput('')
    toast.show('研究結果を保存しました')
  }

  function handleDelete(id: string) {
    saveData(prev => ({ ...prev, otherPostResearches: (prev.otherPostResearches || []).filter(r => r.id !== id) }))
    if (selectedId === id) setSelectedId(null)
    toast.show('削除しました')
  }

  function handleMigrateData() {
    const count = (data.otherPostResearches || []).filter(r => r.analysis).length
    saveData(prev => ({
      ...prev,
      otherPostResearches: (prev.otherPostResearches || []).map(migrateResearchData)
    }))
    toast.show(`${count}件の分析データを整形しました`)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {(['all', 'stocked', 'researched'] as const).map(f => (
            <button key={f} className={`text-[11px] font-semibold px-3 py-1 rounded-lg transition ${filter === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setFilter(f)}>
              {f === 'all' ? `すべて（${researches.length}）` : f === 'stocked' ? `未研究（${researches.filter(r => r.status === 'stocked').length}）` : `研究済（${researches.filter(r => r.status === 'researched').length}）`}
            </button>
          ))}
        </div>
        {role === 'admin' && (
          <button className="btn-sec text-xs py-2" onClick={handleMigrateData} title="保存済み分析データのMarkdown記号・重複ラベルを一括整形">
            <i className="fa-solid fa-wand-magic-sparkles mr-1" />既存データ整形
          </button>
        )}
        <button className="btn-sec text-xs py-2 ml-auto" onClick={() => setAddOpen(v => !v)}>
          <i className="fa-solid fa-plus mr-1" />手動追加
        </button>
      </div>

      {/* add form */}
      {addOpen && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-sm font-bold text-slate-700">投稿を手動追加</p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">投稿本文<span className="text-rose-500 ml-1">*</span></label>
            <textarea rows={4} className="input-base cs text-xs resize-y" value={sourceText} onChange={e => setSourceText(e.target.value)} placeholder="研究したい投稿本文をそのまま貼り付け" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">要約（省略可 / 一行）</label>
            <input className="input-base text-xs" value={summary} onChange={e => setSummary(e.target.value)} placeholder="投稿の一言サマリー（省略すると本文冒頭60文字）" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">投稿日時</label>
            <input className="input-base text-xs" value={postedAt} onChange={e => setPostedAt(e.target.value)} placeholder="例: 2026/06/28 12:00" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">反応数</label>
            <div className="grid grid-cols-5 gap-1.5">
              {([
                { label: 'いいね', v: likes, set: setLikes },
                { label: '返信', v: replies, set: setReplies },
                { label: 'RT', v: reposts, set: setReposts },
                { label: '保存', v: saves, set: setSaves },
                { label: 'インプ', v: impressions, set: setImpressions },
              ] as const).map(({ label, v, set }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400 text-center">{label}</span>
                  <input type="number" min="0" className="input-base text-xs text-center py-1 px-1" placeholder="0" value={v} onChange={e => set(e.target.value)} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-sec text-xs py-2 flex-1" onClick={() => setAddOpen(false)}>キャンセル</button>
            <button className="btn-primary text-xs py-2 flex-1 justify-center" onClick={handleAdd}>追加</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          <i className="fa-solid fa-microscope text-2xl mb-2 block" />
          研究ストックがありません。「手動追加」から投稿を追加してください。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(r => (
            <div
              key={r.id}
              className={`card p-3 cursor-pointer transition ${selectedId === r.id ? 'ring-2 ring-indigo-400' : 'hover:shadow-md'}`}
              onClick={() => { setSelectedId(r.id); setRawOutput(''); setParseError(null) }}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <StatusBadge status={r.status} />
                    {r.postedAt && <span className="text-[10px] text-slate-400">{r.postedAt}</span>}
                    {r.metrics?.likes != null && <span className="text-[10px] text-rose-500">♥{r.metrics.likes}</span>}
                    {r.metrics?.reposts != null && <span className="text-[10px] text-sky-500">↩{r.metrics.reposts}</span>}
                    {r.analysis && <NigaBadge n={r.analysis.nigaDegree} />}
                  </div>
                  <p className="text-xs text-slate-700 line-clamp-2">{r.summary}</p>
                  {(r.analysis?.usedLens?.length ?? 0) > 0 && (
                    <p className="text-[10px] text-indigo-500 mt-1">レンズ: {r.analysis!.usedLens.join(' / ')}</p>
                  )}
                </div>
                {role === 'admin' && (
                  <button className="shrink-0 text-slate-300 hover:text-rose-500 transition text-sm p-1" onClick={e => { e.stopPropagation(); handleDelete(r.id) }}>
                    <i className="fa-solid fa-trash-can" />
                  </button>
                )}
              </div>

              {/* detail panel */}
              {selectedId === r.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
                  {/* source text */}
                  <div className="bg-slate-50 rounded-lg p-2 text-xs text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto cs">{r.sourceText}</div>

                  {r.analysis ? (
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-indigo-50 rounded-lg p-2">
                          <p className="text-[10px] font-bold text-indigo-600 mb-1">認知変化</p>
                          <p className="text-slate-700 whitespace-pre-wrap">{r.analysis.cognitiveShift}</p>
                        </div>
                        <div className="bg-violet-50 rounded-lg p-2">
                          <p className="text-[10px] font-bold text-violet-600 mb-1">フォロー理由</p>
                          <p className="text-slate-700 whitespace-pre-wrap">{r.analysis.followReason}</p>
                        </div>
                      </div>
                      {r.analysis.researchNote && (
                        <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 text-xs">
                          <p className="text-[10px] font-bold text-amber-700 mb-1">研究ノート</p>
                          <p className="text-slate-700 whitespace-pre-wrap">{r.analysis.researchNote}</p>
                        </div>
                      )}
                      {(r.analysis.lensCandidates?.length > 0 || r.analysis.twistCandidates?.length > 0) && (
                        <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2 text-xs">
                          <p className="text-[10px] font-bold text-emerald-700 mb-1">DB登録候補</p>
                          {r.analysis.lensCandidates?.length > 0 && <p className="text-slate-600">レンズ: {r.analysis.lensCandidates.join(' / ')}</p>}
                          {r.analysis.twistCandidates?.length > 0 && <p className="text-slate-600">オチ: {r.analysis.twistCandidates.join(' / ')}</p>}
                        </div>
                      )}
                      <button className="btn-sec text-[10px] py-1 px-2 self-start" onClick={() => saveData(prev => ({ ...prev, otherPostResearches: (prev.otherPostResearches || []).map(x => x.id === r.id ? { ...x, analysis: undefined, status: 'stocked' as const, updatedAt: new Date().toISOString() } : x) }))}>
                        研究結果をリセット
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <CopyBtn text={buildOS01Prompt(r)} label="OS① 他者投稿分析プロンプトをコピー" />
                      <p className="text-[10px] text-slate-400 text-center">↓ 外部AIで実行 → 出力をここに貼る</p>
                      <textarea rows={5} className="input-base cs text-xs resize-y" placeholder="AI出力をそのまま貼り付け" value={rawOutput} onChange={e => { setRawOutput(e.target.value); setParseError(null) }} />
                      {parseError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{parseError}</p>}
                      <button className="btn-primary text-xs py-2 justify-center" style={{ background: '#4f46e5' }} disabled={!rawOutput.trim()} onClick={handleParseAnalysis}>
                        <i className="fa-solid fa-bolt mr-1" />研究結果を保存
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

// ══════════════════════════════════════════════════════════════
// 2. 引用RT生成
// ══════════════════════════════════════════════════════════════

function QuoteSubTab({ data, saveData, prompts, toast }: Tab6Props) {
  const [sourcePost, setSourcePost] = useState('')
  const [intent, setIntent] = useState('')
  const [avoid, setAvoid] = useState('')
  const [rawOutput, setRawOutput] = useState('')
  const [candidates, setCandidates] = useState<GeneratedPostCandidate[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [copyStates, setCopyStates] = useState<Record<string, boolean>>({})
  // pipeline リンク UI 状態
  const [linkingId, setLinkingId] = useState<string | null>(null) // 現在リンク選択中の candidate id
  const [linkPipelineId, setLinkPipelineId] = useState<string>('')

  const activePipeline = (data.pipeline || []).filter(p => p.state !== 'closed')

  function buildPrompt() {
    const spec = prompts.OS02_QUOTE || ''
    const base = buildBasePrompt(spec, data, prompts)
    return `${base}\n\n---\n# 入力\nsource_post: |\n  ${sourcePost.split('\n').join('\n  ')}\nintent: ${intent || 'なし'}\navoid: ${avoid || 'なし'}`
  }

  function handleParse() {
    setParseError(null)
    const parsed = parseQuoteCandidates(rawOutput)
    if (parsed.length === 0) { setParseError('AI出力から候補を取得できませんでした。OS②の出力をそのまま貼り付けてください。'); return }
    setCandidates(parsed)
    setLinkingId(null)
    setLinkPipelineId('')
  }

  function saveGenerated(c: GeneratedPostCandidate) {
    saveData(prev => ({ ...prev, generatedPosts: [...(prev.generatedPosts || []), { ...c, sourcePostText: sourcePost }] }))
  }

  function handleSaveOnly(c: GeneratedPostCandidate) {
    saveGenerated(c)
    setLinkingId(null)
    toast.show('投稿候補を保存しました')
  }

  function handleSaveWithTouch(c: GeneratedPostCandidate) {
    if (!linkPipelineId) { toast.show('pipeline アカウントを選択してください', 2000); return }
    const now = todayStr()
    const newTouch: Touch = {
      id: uid(),
      postId: shortPostId(),
      date: now,
      targetPostText: sourcePost.trim(),
      targetPostType: '引用RT',
      targetValidity: '未評価',
      aiSuggestedText: c.body,
      actualSentText: c.body,
      editReason: '',
      messageValidity: '未判定',
      status: 'awaiting_reaction',
      reactionType: '未記録',
      reactionNote: '',
    }
    saveData(prev => ({
      ...prev,
      generatedPosts: [...(prev.generatedPosts || []), { ...c, sourcePostText: sourcePost }],
      pipeline: prev.pipeline.map(p =>
        p.id === linkPipelineId
          ? { ...p, touches: [...(p.touches || []), newTouch], lastContactDate: now }
          : p
      ),
    }))
    const target = activePipeline.find(p => p.id === linkPipelineId)
    toast.show(`保存 + ${target?.accountName || ''}のタッチを記録しました`)
    setLinkingId(null)
    setLinkPipelineId('')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 flex flex-col gap-3">
        <p className="text-sm font-bold text-slate-700">引用RT生成</p>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">元投稿本文<span className="text-rose-500 ml-1">*</span></label>
          <textarea rows={4} className="input-base cs text-xs resize-y" value={sourcePost} onChange={e => setSourcePost(e.target.value)} placeholder="引用したい投稿本文をそのまま貼り付け" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">共感点・着目した理由</label>
          <input className="input-base text-xs" value={intent} onChange={e => setIntent(e.target.value)} placeholder="なぜこの投稿を引用したいか" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">避けたい角度</label>
          <input className="input-base text-xs" value={avoid} onChange={e => setAvoid(e.target.value)} placeholder="論破・マウント・営業など" />
        </div>
        <CopyBtn text={buildPrompt()} label="OS② 引用RT生成プロンプトをコピー" />
        <p className="text-[10px] text-slate-400 text-center">↓ 外部AIで実行 → 出力をここに貼る</p>
        <textarea rows={5} className="input-base cs text-xs resize-y" placeholder="AI出力をそのまま貼り付け" value={rawOutput} onChange={e => { setRawOutput(e.target.value); setParseError(null); setCandidates([]) }} />
        {parseError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{parseError}</p>}
        <button className="btn-primary text-xs py-2 justify-center" style={{ background: '#4f46e5' }} disabled={!rawOutput.trim()} onClick={handleParse}>
          <i className="fa-solid fa-bolt mr-1" />候補を表示
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="flex flex-col gap-3">
          {candidates.map((c, i) => (
            <div key={c.id} className="card p-3 flex flex-col gap-2 bg-violet-50 border-violet-200">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">案{i + 1}</span>
                {c.meta.usedLens.length > 0 && <span className="text-[10px] text-indigo-600">レンズ: {c.meta.usedLens.join('/')}</span>}
                <NigaBadge n={c.meta.nigaDegree} />
              </div>
              <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{c.body}</p>
              {c.meta.cognitiveShift && <p className="text-[10px] text-slate-500">認知変化: {c.meta.cognitiveShift}</p>}
              {c.meta.endingType && <p className="text-[10px] text-slate-500">余白: {c.meta.endingType}</p>}
              {c.meta.humanSelectionPoint && (
                <div className="bg-amber-50 border border-amber-100 rounded px-2 py-1 text-[10px] text-amber-800">
                  <i className="fa-solid fa-triangle-exclamation mr-1" />確認点: {c.meta.humanSelectionPoint}
                </div>
              )}
              <div className="flex gap-2">
                <button className={`btn-sec text-[10px] py-1 px-2 flex-1 justify-center ${copyStates[c.id] ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`} onClick={() => copyText(c.body, () => { setCopyStates(p => ({ ...p, [c.id]: true })); setTimeout(() => setCopyStates(p => ({ ...p, [c.id]: false })), 1500) }, { openGemini: false })}>
                  {copyStates[c.id] ? '✓ コピー' : 'コピー'}
                </button>
                <button
                  className="btn-sec text-[10px] py-1 px-2 flex-1 justify-center"
                  onClick={() => { setLinkingId(prev => prev === c.id ? null : c.id); setLinkPipelineId('') }}
                >
                  保存
                </button>
              </div>

              {/* pipeline リンク選択パネル */}
              {linkingId === c.id && (
                <div className="mt-1 pt-2 border-t border-violet-200 flex flex-col gap-2">
                  <p className="text-[11px] font-semibold text-slate-600">引用RT対象はパイプラインにいますか？</p>
                  {activePipeline.length > 0 ? (
                    <select
                      className="input-base text-xs"
                      value={linkPipelineId}
                      onChange={e => setLinkPipelineId(e.target.value)}
                    >
                      <option value="">— アカウントを選択（任意）—</option>
                      {activePipeline.map(p => (
                        <option key={p.id} value={p.id}>{p.accountName}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[10px] text-slate-400">パイプラインにアカウントがありません</p>
                  )}
                  <div className="flex gap-2">
                    <button className="btn-sec text-[10px] py-1 px-2 flex-1 justify-center" onClick={() => handleSaveOnly(c)}>
                      保存のみ
                    </button>
                    <button
                      className="btn-primary text-[10px] py-1 px-2 flex-1 justify-center"
                      style={{ background: '#4f46e5' }}
                      disabled={!linkPipelineId}
                      onClick={() => handleSaveWithTouch(c)}
                    >
                      保存 + タッチ記録
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// 3. 通常投稿生成
// ══════════════════════════════════════════════════════════════

function PostSubTab({ data, saveData, prompts, toast }: Tab6Props) {
  const [material, setMaterial] = useState('')
  const [expectation, setExpectation] = useState('')
  const [lens, setLens] = useState('')
  const [avoid, setAvoid] = useState('')
  const [charLimit, setCharLimit] = useState('140')
  const [rawOutput, setRawOutput] = useState('')
  const [candidates, setCandidates] = useState<GeneratedPostCandidate[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [copyStates, setCopyStates] = useState<Record<string, boolean>>({})

  function buildPrompt() {
    const spec = prompts.OS03_POST || ''
    const base = buildBasePrompt(spec, data, prompts)
    return `${base}\n\n---\n# 入力\nmaterial: |\n  ${material.split('\n').join('\n  ')}\nreader_expectation: ${expectation || 'なし'}\nlens: ${lens || '任意'}\navoid: ${avoid || 'なし'}\nchar_limit: ${charLimit ? charLimit + '字前後' : '140字前後'}`
  }

  function handleParse() {
    setParseError(null)
    const parsed = parsePostCandidates(rawOutput)
    if (parsed.length === 0) { setParseError('AI出力から候補を取得できませんでした。OS③の出力をそのまま貼り付けてください。'); return }
    setCandidates(parsed)
  }

  function handleSave(c: GeneratedPostCandidate) {
    saveData(prev => ({ ...prev, generatedPosts: [...(prev.generatedPosts || []), { ...c, material }] }))
    toast.show('投稿候補を保存しました')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 flex flex-col gap-3">
        <p className="text-sm font-bold text-slate-700">通常投稿生成</p>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">素材・出来事・違和感<span className="text-rose-500 ml-1">*</span></label>
          <textarea rows={4} className="input-base cs text-xs resize-y" value={material} onChange={e => setMaterial(e.target.value)} placeholder="今日あった出来事、感じた違和感、観察したこと、読んだ言葉など" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">読者の予想（転換前）</label>
            <input className="input-base text-xs" value={expectation} onChange={e => setExpectation(e.target.value)} placeholder="読者がどう思うと想定するか" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">使用レンズ（任意）</label>
            <input className="input-base text-xs" value={lens} onChange={e => setLens(e.target.value)} placeholder="例: 編集者的逆説" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">避けたい表現</label>
            <input className="input-base text-xs" value={avoid} onChange={e => setAvoid(e.target.value)} placeholder="例: 断言・説教・教育的" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">文字数目安</label>
            <input className="input-base text-xs" value={charLimit} onChange={e => setCharLimit(e.target.value)} placeholder="140" />
          </div>
        </div>
        <CopyBtn text={buildPrompt()} label="OS③ 通常投稿生成プロンプトをコピー" />
        <p className="text-[10px] text-slate-400 text-center">↓ 外部AIで実行 → 出力をここに貼る（ツリーは最大1投稿）</p>
        <textarea rows={5} className="input-base cs text-xs resize-y" placeholder="AI出力をそのまま貼り付け" value={rawOutput} onChange={e => { setRawOutput(e.target.value); setParseError(null); setCandidates([]) }} />
        {parseError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{parseError}</p>}
        <button className="btn-primary text-xs py-2 justify-center" style={{ background: '#4f46e5' }} disabled={!rawOutput.trim()} onClick={handleParse}>
          <i className="fa-solid fa-bolt mr-1" />候補を表示
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="flex flex-col gap-3">
          {candidates.map((c, i) => (
            <div key={c.id} className="card p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">案{i + 1}</span>
                {c.meta.openingType && <span className="text-[10px] text-slate-500">冒頭: {c.meta.openingType}</span>}
                {c.meta.usedLens.length > 0 && <span className="text-[10px] text-indigo-600">レンズ: {c.meta.usedLens.join('/')}</span>}
                <NigaBadge n={c.meta.nigaDegree} />
                {c.meta.treeCount > 0 && <span className="text-[10px] font-bold text-amber-600">ツリー{c.meta.treeCount}</span>}
              </div>
              <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{c.body}</p>
              {c.meta.twistType && <p className="text-[10px] text-slate-500">裏切りの型: {c.meta.twistType}</p>}
              {c.meta.nigaPoint && <p className="text-[10px] text-violet-600">ニヤッポイント: {c.meta.nigaPoint}</p>}
              {c.meta.humanSelectionPoint && (
                <div className="bg-amber-50 border border-amber-100 rounded px-2 py-1 text-[10px] text-amber-800">
                  <i className="fa-solid fa-triangle-exclamation mr-1" />選択の根拠: {c.meta.humanSelectionPoint}
                </div>
              )}
              <div className="flex gap-2">
                <button className={`btn-sec text-[10px] py-1 px-2 flex-1 justify-center ${copyStates[c.id] ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`} onClick={() => copyText(c.body, () => { setCopyStates(p => ({ ...p, [c.id]: true })); setTimeout(() => setCopyStates(p => ({ ...p, [c.id]: false })), 1500) }, { openGemini: false })}>
                  {copyStates[c.id] ? '✓ コピー' : 'コピー'}
                </button>
                <button className="btn-sec text-[10px] py-1 px-2 flex-1 justify-center" onClick={() => handleSave(c)}>保存</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// 4. 投稿PDCA
// ══════════════════════════════════════════════════════════════

function PdcaSubTab({ data, saveData, prompts, role, toast }: Tab6Props) {
  const pdcas = data.ownPostPdcas || []
  const [addOpen, setAddOpen] = useState(false)
  const [postText, setPostText] = useState('')
  const [postType, setPostType] = useState<'normal' | 'quote'>('normal')
  const [hypothesis, setHypothesis] = useState('')
  const [usedLens, setUsedLens] = useState('')
  const [postedAt, setPostedAt] = useState('')
  const [impressions, setImpressions] = useState('')
  const [follows, setFollows] = useState('')
  const [saves, setSaves] = useState('')
  const [profileVisits, setProfileVisits] = useState('')
  const [rawOutput, setRawOutput] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingMetricsId, setEditingMetricsId] = useState<string | null>(null)
  const [editPostedAt, setEditPostedAt] = useState('')
  const [editImpressions, setEditImpressions] = useState('')
  const [editFollows, setEditFollows] = useState('')
  const [editSaves, setEditSaves] = useState('')
  const [editProfileVisits, setEditProfileVisits] = useState('')

  function buildPrompt() {
    const spec = prompts.OS04_PDCA || ''
    const base = buildBasePrompt(spec, data, prompts)
    return `${base}\n\n---\n# 投稿\npost_text: |\n  ${postText.split('\n').join('\n  ')}\nhypothesis: ${hypothesis || 'なし'}\nused_lens: ${usedLens || 'なし'}\npost_type: ${postType}\nmetrics:\n  impressions: ${impressions || 0}\n  follows: ${follows || 0}\n  saves: ${saves || 0}\n  profile_visits: ${profileVisits || 0}`
  }

  function handleAdd() {
    if (!postText.trim()) { toast.show('投稿本文は必須です', 2000); return }
    const entry: OwnPostPDCA = {
      id: uid(),
      postText: postText.trim(),
      postedAt: postedAt || undefined,
      metricsRecordedAt: (impressions || follows || saves || profileVisits) ? todayStr() : undefined,
      hypothesis: hypothesis || undefined,
      usedLens: usedLens ? [usedLens] : undefined,
      postType,
      metrics: {
        impressions: impressions ? Number(impressions) : undefined,
        follows: follows ? Number(follows) : undefined,
        saves: saves ? Number(saves) : undefined,
        profileVisits: profileVisits ? Number(profileVisits) : undefined,
      },
      createdAt: new Date().toISOString(),
    }
    saveData(prev => ({ ...prev, ownPostPdcas: [...(prev.ownPostPdcas || []), entry] }))
    setPostText(''); setHypothesis(''); setUsedLens(''); setPostedAt('')
    setImpressions(''); setFollows(''); setSaves(''); setProfileVisits(''); setRawOutput('')
    setAddOpen(false)
    toast.show('PDCA記録を追加しました')
  }

  function beginEditMetrics(p: OwnPostPDCA) {
    setEditingMetricsId(p.id)
    setEditPostedAt(p.postedAt || '')
    setEditImpressions(p.metrics.impressions != null ? String(p.metrics.impressions) : '')
    setEditFollows(p.metrics.follows != null ? String(p.metrics.follows) : '')
    setEditSaves(p.metrics.saves != null ? String(p.metrics.saves) : '')
    setEditProfileVisits(p.metrics.profileVisits != null ? String(p.metrics.profileVisits) : '')
  }

  function cancelEditMetrics() {
    setEditingMetricsId(null)
    setEditPostedAt('')
    setEditImpressions('')
    setEditFollows('')
    setEditSaves('')
    setEditProfileVisits('')
  }

  function handleSaveMetrics(id: string) {
    saveData(prev => ({
      ...prev,
      ownPostPdcas: (prev.ownPostPdcas || []).map(p => p.id === id ? {
        ...p,
        postedAt: editPostedAt || undefined,
        metricsRecordedAt: todayStr(),
        metrics: {
          ...p.metrics,
          impressions: editImpressions ? Number(editImpressions) : undefined,
          follows: editFollows ? Number(editFollows) : undefined,
          saves: editSaves ? Number(editSaves) : undefined,
          profileVisits: editProfileVisits ? Number(editProfileVisits) : undefined,
        },
      } : p),
    }))
    cancelEditMetrics()
    toast.show('記録を更新しました')
  }

  function handleParsePdca(id: string) {
    setParseError(null)
    if (!rawOutput.trim()) return
    const pdca = pdcas.find(p => p.id === id)
    if (!pdca) return
    const analysisRaw = rawOutput
    const followRateM = analysisRaw.match(/フォロー率[：:]\s*([\d.]+)/)
    const pvRateM = analysisRaw.match(/プロフィール遷移率[：:]\s*([\d.]+)/)
    const analysis: OwnPostPDCA['analysis'] = {
      followRate: followRateM ? parseFloat(followRateM[1]) : undefined,
      profileVisitRate: pvRateM ? parseFloat(pvRateM[1]) : undefined,
      quoteQuality: fieldLine(analysisRaw, '引用され方'),
      personalityAccumulation: fieldLine(analysisRaw, '人格蓄積'),
      cognitiveShiftResult: fieldLine(analysisRaw, '認知変化'),
      nigaResult: fieldLine(analysisRaw, 'ニヤッ'),
      lensResult: fieldLine(analysisRaw, 'レンズ結果'),
      dangerSignals: bulletList(mdSection(analysisRaw, '危険信号')),
      continuePoint: fieldLine(analysisRaw, '続けるべき点'),
      revisePoint: fieldLine(analysisRaw, '修正すべき点'),
      stopPoint: fieldLine(analysisRaw, 'やめるべき点'),
      dbCandidates: bulletList(mdSection(analysisRaw, 'DB候補')),
      researchNote: mdSection(analysisRaw, '研究ノート'),
    }
    saveData(prev => ({
      ...prev,
      ownPostPdcas: (prev.ownPostPdcas || []).map(p => p.id === id ? { ...p, analysis, rawOutput: analysisRaw } : p),
    }))
    setRawOutput('')
    toast.show('PDCA分析を保存しました')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button className="btn-primary text-xs py-2" onClick={() => setAddOpen(v => !v)}>
          <i className="fa-solid fa-plus mr-1" />投稿を記録
        </button>
      </div>

      {addOpen && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-sm font-bold text-slate-700">投稿記録</p>
          <div className="flex gap-2">
            {(['normal', 'quote'] as const).map(t => (
              <button key={t} className={`flex-1 text-xs py-2 rounded-xl border font-semibold transition ${postType === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`} onClick={() => setPostType(t)}>
                {t === 'normal' ? '通常投稿' : '引用RT'}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">投稿本文<span className="text-rose-500 ml-1">*</span></label>
            <textarea rows={4} className="input-base cs text-xs resize-y" value={postText} onChange={e => setPostText(e.target.value)} placeholder="実際に投稿した本文" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">投稿前仮説</label>
              <input className="input-base text-xs" value={hypothesis} onChange={e => setHypothesis(e.target.value)} placeholder="どんな反応を狙ったか" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">使用レンズ</label>
              <input className="input-base text-xs" value={usedLens} onChange={e => setUsedLens(e.target.value)} placeholder="例: 編集者的逆説" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">投稿日時</label>
            <input className="input-base text-xs" value={postedAt} onChange={e => setPostedAt(e.target.value)} placeholder="例: 2026/06/28" />
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {([
              { label: 'インプ', v: impressions, set: setImpressions },
              { label: 'フォロー', v: follows, set: setFollows },
              { label: '保存', v: saves, set: setSaves },
              { label: 'プロフ遷移', v: profileVisits, set: setProfileVisits },
            ] as const).map(({ label, v, set }) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400 text-center">{label}</span>
                <input type="number" min="0" className="input-base text-xs text-center py-1 px-1" placeholder="0" value={v} onChange={e => set(e.target.value)} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400">数値は空欄で追加して、3日後や1週間後に「記録編集」で追記できます。</p>
          <div className="flex gap-2">
            <button className="btn-sec text-xs py-2 flex-1" onClick={() => setAddOpen(false)}>キャンセル</button>
            <button className="btn-primary text-xs py-2 flex-1 justify-center" onClick={handleAdd}>追加</button>
          </div>
        </div>
      )}

      {pdcas.length === 0 && !addOpen ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          <i className="fa-solid fa-chart-line text-2xl mb-2 block" />
          まだPDCA記録がありません。「投稿を記録」から追加してください。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {[...pdcas].reverse().map(p => (
            <div
              key={p.id}
              className={`card p-3 cursor-pointer transition ${selectedId === p.id ? 'ring-2 ring-indigo-400' : 'hover:shadow-md'}`}
              onClick={() => { setSelectedId(prev => prev === p.id ? null : p.id); setRawOutput(''); setParseError(null) }}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.postType === 'quote' ? 'bg-violet-100 text-violet-700' : 'bg-indigo-100 text-indigo-700'}`}>{p.postType === 'quote' ? '引用RT' : '通常'}</span>
                    {p.analysis ? <span className="text-[10px] text-emerald-600 font-semibold">分析済</span> : <span className="text-[10px] text-amber-600">未分析</span>}
                    {p.postedAt && <span className="text-[10px] text-slate-400">{p.postedAt}</span>}
                    {p.metrics.impressions != null && <span className="text-[10px] text-slate-500">インプ{p.metrics.impressions}</span>}
                    {p.metrics.follows != null && <span className="text-[10px] text-emerald-600">フォロー{p.metrics.follows}</span>}
                    {p.metricsRecordedAt && <span className="text-[10px] text-slate-300">記録{p.metricsRecordedAt}</span>}
                  </div>
                  <p className="text-xs text-slate-700 line-clamp-2">{p.postText}</p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button className="btn-sec text-[10px] py-1 px-2" onClick={e => { e.stopPropagation(); beginEditMetrics(p); setSelectedId(p.id) }}>
                    <i className="fa-solid fa-pen mr-1" />記録編集
                  </button>
                  {role === 'admin' && (
                    <button className="shrink-0 text-slate-300 hover:text-rose-500 transition text-sm p-1" onClick={e => { e.stopPropagation(); saveData(prev => ({ ...prev, ownPostPdcas: (prev.ownPostPdcas || []).filter(x => x.id !== p.id) })); toast.show('削除しました') }}>
                      <i className="fa-solid fa-trash-can" />
                    </button>
                  )}
                </div>
              </div>

              {selectedId === p.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
                  {editingMetricsId === p.id && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-700">記録編集</p>
                        <span className="text-[10px] text-slate-400">あとから追記してOK</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-slate-500">投稿日時</label>
                        <input className="input-base text-xs" value={editPostedAt} onChange={e => setEditPostedAt(e.target.value)} placeholder="例: 2026/06/28" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { label: 'インプ', v: editImpressions, set: setEditImpressions },
                          { label: 'フォロー', v: editFollows, set: setEditFollows },
                          { label: '保存', v: editSaves, set: setEditSaves },
                          { label: 'プロフ遷移', v: editProfileVisits, set: setEditProfileVisits },
                        ] as const).map(({ label, v, set }) => (
                          <div key={label} className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-400 text-center">{label}</span>
                            <input type="number" min="0" className="input-base text-xs text-center py-1 px-1" placeholder="0" value={v} onChange={e => set(e.target.value)} />
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button className="btn-sec text-xs py-2 flex-1" onClick={cancelEditMetrics}>キャンセル</button>
                        <button className="btn-primary text-xs py-2 flex-1 justify-center" onClick={() => handleSaveMetrics(p.id)}>更新</button>
                      </div>
                    </div>
                  )}
                  {p.analysis ? (
                    <div className="flex flex-col gap-2 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        {p.analysis.continuePoint && <div className="bg-emerald-50 rounded-lg p-2"><p className="text-[10px] font-bold text-emerald-700 mb-1">続ける</p><p className="text-slate-700">{p.analysis.continuePoint}</p></div>}
                        {p.analysis.revisePoint && <div className="bg-amber-50 rounded-lg p-2"><p className="text-[10px] font-bold text-amber-700 mb-1">修正</p><p className="text-slate-700">{p.analysis.revisePoint}</p></div>}
                      </div>
                      {p.analysis.stopPoint && <div className="bg-rose-50 rounded-lg p-2"><p className="text-[10px] font-bold text-rose-700 mb-1">やめる</p><p className="text-slate-700">{p.analysis.stopPoint}</p></div>}
                      {p.analysis.dbCandidates?.length > 0 && (
                        <div className="bg-indigo-50 rounded-lg p-2">
                          <p className="text-[10px] font-bold text-indigo-700 mb-1">DB候補</p>
                          <p className="text-slate-700">{p.analysis.dbCandidates.join(' / ')}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <CopyBtn text={(() => {
                        const spec = prompts.OS04_PDCA || ''
                        const base = buildBasePrompt(spec, data, prompts)
                        return `${base}\n\n---\n# 投稿\npost_text: |\n  ${p.postText.split('\n').join('\n  ')}\nhypothesis: ${p.hypothesis || 'なし'}\npost_type: ${p.postType}\nmetrics:\n  impressions: ${p.metrics.impressions ?? 0}\n  follows: ${p.metrics.follows ?? 0}\n  saves: ${p.metrics.saves ?? 0}`
                      })()} label="OS④ 投稿PDCA プロンプトをコピー" />
                      <p className="text-[10px] text-slate-400 text-center">↓ 外部AIで実行 → 出力をここに貼る</p>
                      <textarea rows={5} className="input-base cs text-xs resize-y" placeholder="AI出力をそのまま貼り付け" value={rawOutput} onChange={e => { setRawOutput(e.target.value); setParseError(null) }} />
                      {parseError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{parseError}</p>}
                      <button className="btn-primary text-xs py-2 justify-center" style={{ background: '#4f46e5' }} disabled={!rawOutput.trim()} onClick={() => handleParsePdca(p.id)}>
                        <i className="fa-solid fa-bolt mr-1" />分析を保存
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

// ══════════════════════════════════════════════════════════════
// 5. レンズ/DB管理
// ══════════════════════════════════════════════════════════════

const DB_FILES = [
  { key: 'lens_db', label: 'レンズDB', path: '/prompts/db/lens_db.md' },
  { key: 'metaphor_db', label: '比喩DB', path: '/prompts/db/metaphor_db.md' },
  { key: 'opening_db', label: '冒頭DB', path: '/prompts/db/opening_db.md' },
  { key: 'ending_db', label: '締めDB', path: '/prompts/db/ending_db.md' },
  { key: 'expectation_db', label: '予想DB', path: '/prompts/db/expectation_db.md' },
  { key: 'tempo_db', label: 'テンポDB', path: '/prompts/db/tempo_db.md' },
  { key: 'persona_db', label: 'ペルソナDB', path: '/prompts/db/persona_db.md' },
  { key: 'structure_db', label: '構造DB', path: '/prompts/db/structure_db.md' },
  { key: 'emotion_db', label: '感情DB', path: '/prompts/db/emotion_db.md' },
  { key: 'question_db', label: '問いDB', path: '/prompts/db/question_db.md' },
  { key: 'twist_db', label: 'オチDB', path: '/prompts/db/twist_db.md' },
  { key: 'humor_db', label: 'ユーモアDB', path: '/prompts/db/humor_db.md' },
  { key: 'reader_reaction_db', label: '読者反応DB', path: '/prompts/db/reader_reaction_db.md' },
  { key: 'reference_db', label: '参照DB', path: '/prompts/db/reference_db.md' },
  { key: 'research_notes', label: '研究ノート', path: '/prompts/db/research_notes.md' },
]

function LensSubTab({ data, saveData, prompts, toast }: Tab6Props) {
  const [selectedDb, setSelectedDb] = useState('lens_db')
  const [contents, setContents] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)

  const current = DB_FILES.find(d => d.key === selectedDb)!

  function getContent(): string {
    return data.dbOverrides?.[selectedDb] || contents[selectedDb] || ''
  }

  async function loadContent(key: string, path: string) {
    if (data.dbOverrides?.[key] || contents[key]) return
    setLoading(true)
    try {
      const text = await fetch(path).then(r => r.text())
      setContents(prev => ({ ...prev, [key]: text }))
    } catch {
      setContents(prev => ({ ...prev, [key]: '（読み込み失敗）' }))
    }
    setLoading(false)
  }

  useEffect(() => {
    if (current) loadContent(current.key, current.path)
  }, [selectedDb])

  function handleEdit() {
    setDraft(getContent())
    setEditing(true)
  }

  function handleSave() {
    saveData(prev => ({
      ...prev,
      dbOverrides: { ...(prev.dbOverrides || {}), [selectedDb]: draft },
    }))
    setEditing(false)
    toast.show('DB内容を保存しました')
  }

  function handleReset() {
    saveData(prev => {
      const overrides = { ...(prev.dbOverrides || {}) }
      delete overrides[selectedDb]
      return { ...prev, dbOverrides: overrides }
    })
    toast.show('初期値にリセットしました')
  }

  function buildOS05Prompt(): string {
    const spec = prompts.OS05_LENS || ''
    const allDbs = DB_FILES.map(d => {
      const c = data.dbOverrides?.[d.key] || contents[d.key] || ''
      return c ? `## ${d.label}\n${c}` : ''
    }).filter(Boolean).join('\n\n')
    return `${spec}\n\n---\n# 現在のDB状態\n${allDbs}`
  }

  return (
    <div className="flex flex-col gap-4">
      {/* OS05 prompt copy */}
      <div className="card p-3">
        <CopyBtn text={buildOS05Prompt()} label="OS⑤ レンズ/DB管理プロンプトをコピー" />
        <p className="text-[10px] text-slate-400 text-center mt-2">外部AIにDBの現状を渡してDB候補を提案させる</p>
      </div>

      {/* DB selector */}
      <div className="flex gap-1 flex-wrap">
        {DB_FILES.map(d => (
          <button
            key={d.key}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border transition ${selectedDb === d.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}
            onClick={() => { setSelectedDb(d.key); setEditing(false) }}
          >
            {d.label}
            {data.dbOverrides?.[d.key] && <span className="ml-1 text-amber-400">*</span>}
          </button>
        ))}
      </div>

      {/* DB content */}
      <div className="card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-700 flex-1">{current.label}</p>
          {data.dbOverrides?.[selectedDb] && (
            <button className="text-[10px] text-slate-400 hover:text-rose-500 transition" onClick={handleReset}>初期値に戻す</button>
          )}
          {!editing && (
            <button className="btn-sec text-xs py-1.5" onClick={handleEdit}>
              <i className="fa-solid fa-pen text-xs mr-1" />編集
            </button>
          )}
        </div>
        {loading ? (
          <p className="text-xs text-slate-400">読み込み中...</p>
        ) : editing ? (
          <>
            <textarea rows={16} className="input-base cs text-xs resize-y font-mono" value={draft} onChange={e => setDraft(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-sec text-xs py-2 flex-1" onClick={() => setEditing(false)}>キャンセル</button>
              <button className="btn-primary text-xs py-2 flex-1 justify-center" onClick={handleSave}>保存</button>
            </div>
          </>
        ) : (
          <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 whitespace-pre-wrap max-h-96 overflow-y-auto cs font-mono leading-relaxed">
            {getContent() || '（内容なし）'}
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// 6. 人格監査
// ══════════════════════════════════════════════════════════════

function AuditSubTab({ data, saveData, prompts, toast }: Tab6Props) {
  const audits = data.personalityAudits || []
  const [mode, setMode] = useState<'pre_post' | 'post_post' | 'recent_set'>('pre_post')
  const [postType, setPostType] = useState<'normal' | 'quote'>('normal')
  const [targetText, setTargetText] = useState('')
  const [rawOutput, setRawOutput] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function buildPrompt() {
    const spec = prompts.OS06_PERSONALITY || ''
    const base = buildBasePrompt(spec, data, prompts)
    return `${base}\n\n---\n# 監査対象\nmode: ${mode}\npost_type: ${postType}\ntarget: |\n  ${targetText.split('\n').join('\n  ')}`
  }

  function handleParse() {
    setParseError(null)
    const parsed = parsePersonalityAudit(rawOutput, mode, postType, targetText)
    if (!parsed) { setParseError('AI出力から判定（OK/WARNING/NG）を取得できませんでした。OS⑥の出力をそのまま貼り付けてください。'); return }
    saveData(prev => ({ ...prev, personalityAudits: [...(prev.personalityAudits || []), parsed] }))
    setRawOutput(''); setTargetText('')
    toast.show('監査結果を保存しました')
  }

  const modeLabels: Record<typeof mode, string> = { pre_post: '事前（送信前）', post_post: '事後（単投稿）', recent_set: '群監査（直近5〜20件）' }

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 flex flex-col gap-3">
        <p className="text-sm font-bold text-slate-700">人格監査</p>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">監査モード</label>
          <div className="flex gap-1">
            {(['pre_post', 'post_post', 'recent_set'] as const).map(m => (
              <button key={m} className={`flex-1 text-[10px] py-1.5 rounded-lg border font-semibold transition ${mode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`} onClick={() => setMode(m)}>
                {modeLabels[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {(['normal', 'quote'] as const).map(t => (
            <button key={t} className={`flex-1 text-xs py-1.5 rounded-xl border font-semibold transition ${postType === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`} onClick={() => setPostType(t)}>
              {t === 'normal' ? '通常投稿' : '引用RT'}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">監査対象本文<span className="text-rose-500 ml-1">*</span></label>
          <textarea rows={5} className="input-base cs text-xs resize-y" value={targetText} onChange={e => setTargetText(e.target.value)} placeholder={mode === 'recent_set' ? '直近5〜20件の投稿を改行区切りで貼り付け' : '監査したい投稿本文を貼り付け'} />
        </div>
        <CopyBtn text={buildPrompt()} label="OS⑥ 人格監査プロンプトをコピー" />
        <p className="text-[10px] text-slate-400 text-center">↓ 外部AIで実行 → 出力をここに貼る</p>
        <textarea rows={5} className="input-base cs text-xs resize-y" placeholder="AI出力をそのまま貼り付け" value={rawOutput} onChange={e => { setRawOutput(e.target.value); setParseError(null) }} />
        {parseError && <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{parseError}</p>}
        <button className="btn-primary text-xs py-2 justify-center" style={{ background: '#4f46e5' }} disabled={!rawOutput.trim()} onClick={handleParse}>
          <i className="fa-solid fa-bolt mr-1" />監査結果を保存
        </button>
      </div>

      {audits.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-slate-500">監査履歴</p>
          {[...audits].reverse().map(a => (
            <div
              key={a.id}
              className={`card p-3 cursor-pointer transition ${selectedId === a.id ? 'ring-2 ring-indigo-400' : 'hover:shadow-md'}`}
              onClick={() => setSelectedId(prev => prev === a.id ? null : a.id)}
            >
              <div className="flex items-center gap-2 mb-1">
                <JudgmentBadge j={a.judgment} />
                <span className="text-[10px] text-slate-500">{modeLabels[a.mode]} / {a.postType === 'quote' ? '引用RT' : '通常'}</span>
                <span className="text-[10px] text-slate-400 ml-auto">{a.createdAt.slice(0, 10)}</span>
              </div>
              <p className="text-xs text-slate-700 line-clamp-2">{a.targetText}</p>
              {selectedId === a.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2 text-xs">
                  {a.detectedItems && <div className="bg-rose-50 rounded-lg p-2"><p className="text-[10px] font-bold text-rose-700 mb-1">検知項目</p><p className="text-slate-700 whitespace-pre-wrap">{a.detectedItems}</p></div>}
                  {a.fixInstruction && <div className="bg-amber-50 rounded-lg p-2"><p className="text-[10px] font-bold text-amber-700 mb-1">修正指示</p><p className="text-slate-700 whitespace-pre-wrap">{a.fixInstruction}</p></div>}
                  {a.returnPoint && <div className="bg-indigo-50 rounded-lg p-2"><p className="text-[10px] font-bold text-indigo-700 mb-1">回帰ポイント</p><p className="text-slate-700">{a.returnPoint}</p></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// 7. 憲法設定
// ══════════════════════════════════════════════════════════════

type ConstitutionKey = 'personality' | 'aesthetic'

function ConstitutionSubTab({ data, saveData, prompts, toast }: Tab6Props) {
  const [active, setActive] = useState<ConstitutionKey>('personality')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [reason, setReason] = useState('')
  const [impactScope, setImpactScope] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const constitutionData = active === 'personality' ? data.personalityConstitution : data.aestheticConstitution
  const defaultContent = active === 'personality' ? prompts.PERSONALITY_CONSTITUTION : prompts.AESTHETIC_CONSTITUTION
  const currentContent = constitutionData?.content || defaultContent || ''

  function handleEdit() {
    setDraft(currentContent)
    setReason('')
    setImpactScope('')
    setEditing(true)
  }

  function handleSave() {
    if (!reason.trim()) { toast.show('変更理由を入力してください', 2000); return }
    const now = new Date().toISOString()
    const prev = constitutionData
    const historyEntry = prev?.content ? { content: prev.content, reason: prev.reason || '', updatedAt: prev.updatedAt } : null
    const newEntry = {
      content: draft,
      updatedAt: now,
      reason: reason.trim(),
      impactScope: impactScope.trim(),
      history: [
        ...(prev?.history || []),
        ...(historyEntry ? [historyEntry] : []),
      ],
    }
    saveData(p => ({
      ...p,
      ...(active === 'personality' ? { personalityConstitution: newEntry } : { aestheticConstitution: newEntry }),
    }))
    setEditing(false)
    setShowHistory(false)
    toast.show('憲法を更新しました')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* selector */}
      <div className="flex gap-2">
        {(['personality', 'aesthetic'] as const).map(k => (
          <button key={k} className={`flex-1 text-xs py-2.5 rounded-xl border font-semibold transition ${active === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`} onClick={() => { setActive(k); setEditing(false) }}>
            {k === 'personality' ? '人格憲法' : '美学憲法'}
          </button>
        ))}
      </div>

      {/* meta */}
      {constitutionData && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[10px] text-slate-500 flex gap-4">
          <span>更新: {constitutionData.updatedAt.slice(0, 10)}</span>
          {constitutionData.reason && <span>理由: {constitutionData.reason}</span>}
          {constitutionData.impactScope && <span>影響範囲: {constitutionData.impactScope}</span>}
          {(constitutionData.history || []).length > 0 && (
            <button className="ml-auto underline text-indigo-500" onClick={() => setShowHistory(v => !v)}>
              履歴（{(constitutionData.history || []).length}件）
            </button>
          )}
        </div>
      )}

      {/* history */}
      {showHistory && (constitutionData?.history || []).length > 0 && (
        <div className="flex flex-col gap-2">
          {[...(constitutionData!.history || [])].reverse().map((h, i) => (
            <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-slate-400">{h.updatedAt.slice(0, 10)}</span>
                <span className="text-slate-600">{h.reason}</span>
              </div>
              <p className="text-slate-500 whitespace-pre-wrap line-clamp-4">{h.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* content */}
      <div className="card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-700 flex-1">{active === 'personality' ? '人格憲法' : '美学憲法'}</p>
          {!editing && (
            <button className="btn-sec text-xs py-1.5" onClick={handleEdit}>
              <i className="fa-solid fa-pen text-xs mr-1" />編集
            </button>
          )}
        </div>

        {editing ? (
          <>
            <textarea rows={16} className="input-base cs text-xs resize-y" value={draft} onChange={e => setDraft(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">変更理由<span className="text-rose-500 ml-1">*</span></label>
                <input className="input-base text-xs" value={reason} onChange={e => setReason(e.target.value)} placeholder="なぜ変更したか" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">影響範囲</label>
                <input className="input-base text-xs" value={impactScope} onChange={e => setImpactScope(e.target.value)} placeholder="OS①〜OS⑥ / レンズ選択 等" />
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-[10px] text-amber-800">
              <i className="fa-solid fa-triangle-exclamation mr-1" />
              憲法を変更するとすべてのOSに影響します。慎重に変更してください。
            </div>
            <div className="flex gap-2">
              <button className="btn-sec text-xs py-2 flex-1" onClick={() => setEditing(false)}>キャンセル</button>
              <button className="btn-primary text-xs py-2 flex-1 justify-center" onClick={handleSave}>保存</button>
            </div>
          </>
        ) : (
          <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 whitespace-pre-wrap max-h-[500px] overflow-y-auto cs">
            {currentContent || '（未設定 — 初期値はpublic/prompts/から自動読み込みされます）'}
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// Tab6 root
// ══════════════════════════════════════════════════════════════

export default function Tab6({ data, saveData, prompts, role, toast }: Tab6Props) {
  const [subTab, setSubTab] = useState<SubTab>('research')
  const migrated = useRef(false)

  // 旧データ（postStocks）を otherPostResearches へ一度だけ移行
  useEffect(() => {
    if (migrated.current) return
    migrated.current = true
    const hasOld = (data.postStocks?.length ?? 0) > 0
    const hasNew = (data.otherPostResearches?.length ?? 0) > 0
    if (hasOld && !hasNew) {
      saveData(prev => ({
        ...prev,
        otherPostResearches: (prev.postStocks || []).map(migratePostStock),
      }))
    }
  }, [])

  const researchCount = (data.otherPostResearches || []).length
  const unstockedCount = (data.otherPostResearches || []).filter(r => r.status === 'stocked').length

  const SUB_TABS: { id: SubTab; label: string; icon: string }[] = [
    { id: 'research', label: '他者投稿研究', icon: 'fa-microscope' },
    { id: 'quote', label: '引用RT生成', icon: 'fa-quote-left' },
    { id: 'post', label: '通常投稿生成', icon: 'fa-pen-nib' },
    { id: 'pdca', label: '投稿PDCA', icon: 'fa-chart-line' },
    { id: 'lens', label: 'レンズ/DB', icon: 'fa-database' },
    { id: 'audit', label: '人格監査', icon: 'fa-shield-halved' },
    { id: 'constitution', label: '憲法設定', icon: 'fa-scroll' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="card p-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 flex items-center justify-center text-white text-xs font-bold shadow">人格</div>
          <div>
            <h2 className="font-bold text-slate-800 text-base">SNS人格OS Ver.4</h2>
            <p className="text-xs text-slate-400">レンズを一枚だけ増やす編集者として、短く・美しく・少しだけ裏切る</p>
          </div>
          {researchCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-slate-500">研究ストック</span>
              <span className="font-bold text-slate-800 text-sm">{researchCount}</span>
              {unstockedCount > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{unstockedCount}未研究</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* sub-tab nav */}
      <div className="grid grid-cols-4 gap-1 bg-slate-100 rounded-xl p-1">
        {SUB_TABS.slice(0, 4).map(t => (
          <button
            key={t.id}
            className={`flex items-center justify-center gap-1 text-[10px] font-semibold py-2 rounded-lg transition ${subTab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setSubTab(t.id)}
          >
            <i className={`fa-solid ${t.icon}`} />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1 bg-slate-100 rounded-xl p-1">
        {SUB_TABS.slice(4).map(t => (
          <button
            key={t.id}
            className={`flex items-center justify-center gap-1 text-[10px] font-semibold py-2 rounded-lg transition ${subTab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setSubTab(t.id)}
          >
            <i className={`fa-solid ${t.icon}`} />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* selected sub-tab label */}
      <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 px-1">
        <i className={`fa-solid ${SUB_TABS.find(t => t.id === subTab)?.icon} text-indigo-500`} />
        {SUB_TABS.find(t => t.id === subTab)?.label}
      </div>

      {/* content */}
      {subTab === 'research' && <ResearchSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
      {subTab === 'quote' && <QuoteSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
      {subTab === 'post' && <PostSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
      {subTab === 'pdca' && <PdcaSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
      {subTab === 'lens' && <LensSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
      {subTab === 'audit' && <AuditSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
      {subTab === 'constitution' && <ConstitutionSubTab data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} />}
    </div>
  )
}
