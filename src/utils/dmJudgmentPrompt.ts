import type { PipelineItem, Touch, ConversationTurn } from '../types'

export interface DMJudgmentResult {
  judgment: string
  reason: string
  editEvaluation: string
  improvementSuggestion: string
  improvedText: string
  rawOutput: string
}

export function buildDMJudgmentPrompt(
  item: PipelineItem,
  touch: Touch,
  turnIndex: number,
  template: string
): string {
  const turns = touch.conversationTurns || []
  const turn = turns[turnIndex]
  if (!turn) return template

  // Most recent opponent turn before this one
  const previousOpponentTurn = [...turns.slice(0, turnIndex)].reverse().find(t => t.role === '相手')

  return template
    .replace('{{accountName}}', item.accountName)
    .replace('{{currentStep}}', item.currentStep)
    .replace('{{hypothesis}}', item.hypothesis || '未設定')
    .replace('{{previousDM}}', previousOpponentTurn?.text || '（会話ログ先頭のため直前のDMなし）')
    .replace('{{suggestedTextA}}', turn.dmSuggestedA || '（AI提案なし）')
    .replace('{{suggestedTextB}}', turn.dmSuggestedB || '（AI提案なし）')
    .replace('{{actualSentText}}', turn.text || '')
    .replace('{{editReason}}', turn.editReason || '変更なし')
}

export function parseDMJudgmentOutput(raw: string): DMJudgmentResult | null {
  const block = raw.match(/={1,3}DM_JUDGMENT_START={1,3}([\s\S]*?)={1,3}DM_JUDGMENT_END={1,3}/)?.[1]
  if (!block) return null

  const pick = (label: string): string => {
    const m = block.match(new RegExp(`${label}:\\s*(.+)`))
    return m ? m[1].trim() : ''
  }

  const judgment = pick('判定')
  if (!judgment) return null

  return {
    judgment,
    reason: pick('判定理由'),
    editEvaluation: pick('編集評価'),
    improvementSuggestion: pick('改善提案'),
    improvedText: pick('改善案'),
    rawOutput: raw,
  }
}
