import type { AppData, Analysis } from '../types'

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

function getLastCompleted(analyses: Analysis[], type: string): Analysis | null {
  return [...(analyses || [])]
    .filter(a => a.type === type && a.status === 'completed')
    .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))[0] ?? null
}

// ── 失注パターン分析 ─────────────────────────────────────────
export async function buildCaseAnalysisPrompt(data: AppData): Promise<string> {
  const template = await fetch('/prompts/OS_失注パターン分析_latest.md').then(r => r.text())
  const analyses = data.analyses || []
  const last = getLastCompleted(analyses, 'case_pattern')
  const sinceDate = last?.completedAt ?? null

  const newCases = (data.closed || []).filter(c => {
    if (!sinceDate) return true
    return (c.closeDate || c.createdAt || '') > sinceDate
  })
  const allClosed = data.closed || []
  const wonCount = allClosed.filter(c => c.result === '受注').length
  const lostCount = allClosed.filter(c => c.result !== '受注' && c.result !== '未到達クローズ').length
  const unreachedCount = allClosed.filter(c => c.result === '未到達クローズ').length

  const caseList = newCases.map(c =>
    `${c.id}／${c.closeType || c.result}／学習価値${c.learningValue ?? '-'}／${c.conclusionReason || '-'}／${c.maxLearning || '-'}／${c.track}`
  ).join('\n')

  const replacements: Record<string, string> = {
    caseList: caseList || '（対象案件なし）',
    totalClosed: String(allClosed.length),
    wonCount: String(wonCount),
    lostCount: String(lostCount),
    unreachedCount: String(unreachedCount),
    lastAnalysisDate: sinceDate ? formatDate(sinceDate) : '（初回分析）',
    newCasesCount: String(newCases.length),
    lastActionItem: last?.actionItem ?? '（前回分析なし）',
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? '')
}

export function parseCaseAnalysis(raw: string): Partial<Analysis> | null {
  const block = raw.match(/===CASE_ANALYSIS_START===([\s\S]*?)===CASE_ANALYSIS_END===/)?.[1]
  if (!block) return null
  const pick = (label: string) =>
    block.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`))?.[1]?.trim() ?? ''
  return {
    topLossType: pick('最多失注タイプ'),
    winRate: pick('受注率'),
    patternSummary: pick('パターン要約'),
    lastActionImprovement: pick('前回指摘の改善状況'),
    highValuePattern: pick('学習価値高案件の共通点'),
    actionItem: pick('今すぐ直すべき1点'),
    nextFocusPoint: pick('次回注目ポイント'),
    rawOutput: raw,
    status: 'completed' as const,
    completedAt: new Date().toISOString(),
  }
}

// ── 文面傾向分析 ─────────────────────────────────────────────
export async function buildTouchAnalysisPrompt(data: AppData): Promise<string> {
  const template = await fetch('/prompts/OS_文面傾向分析_latest.md').then(r => r.text())
  const analyses = data.analyses || []
  const last = getLastCompleted(analyses, 'touch_trend')
  const sinceDate = last?.completedAt ?? null

  const allTouches = (data.pipeline || []).flatMap(p =>
    (p.touches || []).map(t => ({ ...t, channel: p.channel }))
  )
  const judged = allTouches.filter(t => {
    if (!t.judgedAt) return false
    if (!sinceDate) return true
    return t.judgedAt > sinceDate
  })

  const count = (arr: typeof judged, pred: (t: (typeof judged)[0]) => boolean) =>
    arr.filter(pred).length

  const targetOk = count(judged, t => t.targetValidity === '◯')
  const targetDelta = count(judged, t => t.targetValidity === '△')
  const targetNg = count(judged, t => t.targetValidity === '✕')
  const messageOk = count(judged, t => t.messageValidity === '◯')
  const messageDelta = count(judged, t => t.messageValidity === '△')
  const messageNg = count(judged, t => t.messageValidity === '✕')
  const editOk = count(judged, t => t.editEvaluation === '適切')
  const editBad = count(judged, t => t.editEvaluation === '悪化')
  const editNone = count(judged, t => t.editEvaluation === '変更なし')

  const touchList = judged.map(t =>
    `${formatDate(t.date)}／${t.channel}／${t.targetPostType}／対象${t.targetValidity}／文面${t.messageValidity}／編集${t.editEvaluation || '-'}／${t.judgmentReason || '-'}／${t.improvementSuggestion || '-'}`
  ).join('\n')

  const replacements: Record<string, string> = {
    touchList: touchList || '（対象タッチなし）',
    totalTouches: String(judged.length),
    targetOk: String(targetOk),
    targetDelta: String(targetDelta),
    targetNg: String(targetNg),
    messageOk: String(messageOk),
    messageDelta: String(messageDelta),
    messageNg: String(messageNg),
    editOk: String(editOk),
    editBad: String(editBad),
    editNone: String(editNone),
    lastAnalysisDate: sinceDate ? formatDate(sinceDate) : '（初回分析）',
    newTouchesCount: String(judged.length),
    lastActionItem: last?.actionItem ?? '（前回分析なし）',
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? '')
}

export function parseTouchAnalysis(raw: string): Partial<Analysis> | null {
  const block = raw.match(/===TOUCH_ANALYSIS_START===([\s\S]*?)===TOUCH_ANALYSIS_END===/)?.[1]
  if (!block) return null
  const pick = (label: string) =>
    block.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`))?.[1]?.trim() ?? ''
  return {
    targetValiditySummary: pick('対象妥当性サマリ'),
    messageValiditySummary: pick('文面妥当性サマリ'),
    editEvalSummary: pick('編集評価サマリ'),
    topImprovementPattern: pick('最多改善提案パターン'),
    frequentNgPostType: pick('よく出る投稿種別✕'),
    lastActionImprovement: pick('前回指摘の改善状況'),
    trendComment: pick('傾向コメント'),
    actionItem: pick('今すぐ直すべき1点'),
    nextFocusPoint: pick('次回注目ポイント'),
    rawOutput: raw,
    status: 'completed' as const,
    completedAt: new Date().toISOString(),
  }
}
