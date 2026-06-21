import type { PipelineItem, Touch } from '../types'
import { hasReaction, reactionDisplay } from './helpers'

export interface S1ActionResult {
  judgment: string
  reason: string
  nextStep: string
  warning: string
  replyA?: string
  replyB?: string
}

export function buildS1ActionPrompt(
  item: PipelineItem,
  touch: Touch,
  template: string
): string {
  const reactionType = reactionDisplay(touch.reactionType)

  const followReturned = (item.touches || []).some(t =>
    hasReaction(t.reactionType, 'フォロー返し')
  )

  let result = template
    .replace('{{accountName}}', item.accountName)
    .replace('{{channel}}', item.channel)
    .replace('{{track}}', item.track)
    .replace('{{hypothesis}}', item.hypothesis || '未設定')
    .replace('{{targetPostType}}', touch.targetPostType || '—')
    .replace('{{targetPostText}}', touch.targetPostText || '—')
    .replace('{{targetPostRawText}}', touch.targetPostRawText || '（原文なし）')
    .replace('{{actualSentText}}', touch.actualSentText || '—')
    .replace('{{reactionType}}', reactionType)
    .replace('{{reactionNote}}', touch.reactionNote || '（なし）')
    .replace('{{s1Count}}', String((item.touches || []).length))
    .replace('{{likeReturnStreak}}', String(item.likeReturnStreak || 0))
    .replace('{{noReactionStreak}}', String(item.noReactionStreak || 0))
    .replace('{{followReturned}}', followReturned ? '有' : '無')

  // 複数往復の場合は会話履歴を追加
  const turns = touch.conversationTurns || []
  if (turns.length > 2) {
    result += '\n\n━━━━━━━━━━━━━━━━━━'
    result += `\n■ 会話履歴（${turns.length}ターン・複数往復）`
    result += '\n※ 下記は最初のコメント以降の会話の続きです。最新の「相手の返信」をもとに判定してください。\n'
    result += turns.map((t, i) => `[${i + 1}] ${t.role}：${t.text}`).join('\n')
    result += `\n\n（上記「${turns[turns.length - 1].role}」のメッセージが今回判定する最新の発言です）`
  }

  return result
}

export function parseS1ActionOutput(raw: string): S1ActionResult | null {
  const block = raw.match(/={1,3}S1ACTION_START={1,3}([\s\S]*?)={1,3}S1ACTION_END={1,3}/)?.[1]
  if (!block) return null

  const pick = (label: string): string => {
    const m = block.match(new RegExp(`${label}:\\s*(.+)`))
    return m ? m[1].trim() : ''
  }

  const judgment = pick('判定')
  if (!judgment) return null

  const replyA = pick('返信案A')
  const replyB = pick('返信案B')

  return {
    judgment,
    reason: pick('理由'),
    nextStep: pick('推奨アクション'),
    warning: pick('警告'),
    replyA: replyA && replyA !== 'なし' ? replyA : undefined,
    replyB: replyB && replyB !== 'なし' ? replyB : undefined,
  }
}
