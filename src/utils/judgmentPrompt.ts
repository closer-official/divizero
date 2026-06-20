export interface JudgmentResult {
  judgment: '◯' | '△' | '✕' | '未判定'
  judgmentReason: string
  editEvaluation: string
  editComment: string
  improvementSuggestion: string
  improvedText: string
}

export async function buildJudgmentPrompt(params: {
  targetPostText: string
  targetPostType: string
  suggestedTextA: string
  suggestedTextB: string
  actualSentText: string
  editReason: string
}): Promise<string> {
  const template = await fetch('/prompts/OS_文面再判定_latest.md').then(r => r.text())
  const map: Record<string, string> = {
    targetPostText: params.targetPostText || '（未入力）',
    targetPostType: params.targetPostType || '（未選択）',
    suggestedTextA: params.suggestedTextA || '（なし）',
    suggestedTextB: params.suggestedTextB || '（なし）',
    actualSentText: params.actualSentText || '（未入力）',
    editReason: params.editReason || '（未入力）',
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => map[key] ?? '')
}

export function parseJudgmentOutput(raw: string): JudgmentResult | null {
  const block = raw.match(/===JUDGMENT_START===([\s\S]*?)===JUDGMENT_END===/)?.[1]
  if (!block) return null

  const pick = (label: string): string => {
    const m = block.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`))
    return m ? m[1].trim() : ''
  }

  const rawJudgment = pick('判定')
  const judgment =
    /[◯○]/.test(rawJudgment) ? '◯' :
    /△/.test(rawJudgment) ? '△' :
    /[✕×x]/i.test(rawJudgment) ? '✕' : '未判定'

  return {
    judgment,
    judgmentReason: pick('判定理由'),
    editEvaluation: pick('編集評価'),
    editComment: pick('編集コメント'),
    improvementSuggestion: pick('改善提案'),
    improvedText: pick('改善案'),
  }
}
