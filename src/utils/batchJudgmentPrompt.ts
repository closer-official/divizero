import type { Touch, PipelineItem } from '../types'

export interface BatchJudgmentResult {
  postId: string
  judgment: '◯' | '△' | '✕'
  judgmentReason: string
  improvementSuggestion: string
  improvedText: string
}

export async function buildBatchJudgmentPrompt(
  items: Array<{ touch: Touch; pipelineItem: PipelineItem }>
): Promise<string> {
  const template = await fetch('/prompts/OS_バッチ文面判定_latest.md').then(r => r.text())

  const itemsText = items.map(({ touch, pipelineItem }) => {
    const aiText = touch.aiSuggestedText || ''
    const aMatch = aiText.match(/A:\s*([\s\S]*?)(?=\nB:|$)/)
    const bMatch = aiText.match(/B:\s*([\s\S]*)/)
    const suggestedA = aMatch?.[1]?.trim() || aiText
    const suggestedB = bMatch?.[1]?.trim() || ''
    const pid = touch.postId || touch.id.slice(0, 8)

    return [
      '===ITEM_START===',
      `投稿ID: ${pid}`,
      `アカウント: ${pipelineItem.accountName}`,
      `投稿種別: ${touch.targetPostType}`,
      `対象投稿（要約）: ${touch.targetPostText || '（未入力）'}`,
      `AI提案A: ${suggestedA || '（なし）'}`,
      `AI提案B: ${suggestedB || '（なし）'}`,
      `実際に送った文章: ${touch.actualSentText}`,
      `変えた理由: ${touch.editReason || '変更なし'}`,
      '===ITEM_END===',
    ].join('\n')
  }).join('\n\n')

  return template
    .replace('{{count}}', String(items.length))
    .replace(/\{\{count\}\}/g, String(items.length))
    .replace('{{items}}', itemsText)
}

export function parseBatchJudgmentOutput(raw: string): BatchJudgmentResult[] {
  const blocks = [...raw.matchAll(/={1,3}RESULT_START={1,3}([\s\S]*?)={1,3}RESULT_END={1,3}/g)].map(m => m[1])

  return blocks.map(block => {
    const pick = (label: string): string => {
      const m = block.match(new RegExp(`${label}:\\s*(.+)`))
      return m ? m[1].trim() : ''
    }
    const rawJ = pick('判定')
    const judgment: '◯' | '△' | '✕' =
      /[◯○]/.test(rawJ) ? '◯' :
      /△/.test(rawJ) ? '△' : '✕'

    return {
      postId: pick('投稿ID'),
      judgment,
      judgmentReason: pick('判定理由'),
      improvementSuggestion: pick('改善提案'),
      improvedText: pick('改善案'),
    }
  }).filter(r => r.postId)
}
