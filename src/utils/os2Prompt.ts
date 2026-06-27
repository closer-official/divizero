import type { PipelineItem, Touch } from '../types'
import { hasReaction } from './helpers'

export interface OS2ConversationResult {
  judgment: string
  nextAction: string
  deadline: string
  suggestedA: string
  suggestedB: string
  warning: string
  rawOutput: string
}

export function buildOS2ConversationPrompt(
  item: PipelineItem,
  touch: Touch,
  template: string
): string {
  const turns = touch.conversationTurns ?? []
  const replyTurns = turns.filter(t => t.role === '相手')
  const selfTurns = turns.filter(t => t.role === '自分' && t.sentStatus === 'sent')
  const lastTurn = turns[turns.length - 1]
  const lastReply = replyTurns[replyTurns.length - 1]

  const repCount = touch.repExchangeCount ?? 0
  const dmCount = touch.dmExchangeCount ?? 0

  const daysSinceContact = lastTurn?.timestamp
    ? Math.floor((Date.now() - new Date(lastTurn.timestamp).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  const lastReplyText = lastReply?.text ?? ''
  const hasQuestion = /[？?]/.test(lastReplyText)
  const reactionQuality = hasQuestion ? '質問あり' : '受け答えのみ'

  const touchCount = (item.touches || []).length
  const likeReturnCount = (item.touches || []).filter(t => hasReaction(t.reactionType, 'いいね返り')).length
  const followReturned = (item.touches || []).some(t => hasReaction(t.reactionType, 'フォロー返し'))

  const conversationLog = turns.map(turn => {
    const selfIdx = selfTurns.indexOf(turn)
    const replyIdx = replyTurns.indexOf(turn)
    const label = turn.role === '自分'
      ? `【自分｜送信${selfIdx + 1}（${turn.timestamp.slice(0, 10)}）】`
      : `【相手｜返信${replyIdx + 1}（${turn.timestamp.slice(0, 10)}）】`
    return `${label}\n${turn.text}`
  }).join('\n\n')

  const inputBlock = [
    `【案件名】${item.accountName}（${item.url}）`,
    `【チャネル】${item.channel}`,
    `【トラック】${item.track}`,
    ...(item.inbound_signal ? [`【起点】インバウンド（${item.inbound_signal.type}）- ${item.inbound_signal.date}${item.inbound_signal.memo ? ' / ' + item.inbound_signal.memo : ''}`] : []),
    `【営業期待値スコア】${item.salesExpectation ?? '未設定'}点（OS①確定値）`,
    `【事前仮説】${item.hypothesis ?? '未設定'}`,
    `【接触開始日】${item.startDate ?? '不明'}`,
    `【現在ステップ】${item.currentStep}`,
    `【往復回数】リプ往復：${repCount}回　DM往復：${dmCount}回`,
    `【S1接触数】${touchCount}回`,
    `【相手の微反応】いいね返り：${likeReturnCount}回　フォロー返し：${followReturned ? '有' : '無'}`,
    `【最終接触からの経過】${daysSinceContact}日`,
    `【赤信号】（AIが下記会話ログから判定する）`,
    `【相手の最新反応タイプ】テキスト返信`,
    `【相手反応の質】${reactionQuality}`,
    `【事前仮説との照合】不明`,
    `【会話ログ】`,
    conversationLog,
  ].join('\n')

  if (template.includes('【入力情報】')) {
    return template.replace('【入力情報】', `【入力情報】\n${inputBlock}`)
  }
  return template + '\n\n' + inputBlock
}

export interface OS2CheckpointResult {
  judgment: string
  nextAction: string
  deadline: string
  warning: string
  rawOutput: string
}

export function parseOS2CheckpointOutput(raw: string): OS2CheckpointResult | null {
  const pick = (label: string): string => {
    const m = raw.match(new RegExp(`【${label}】([\\s\\S]*?)(?=【|$)`))
    return m ? m[1].trim() : ''
  }
  const judgment = pick('判定')
  if (!judgment) return null
  return {
    judgment,
    nextAction: pick('次アクション'),
    deadline: pick('実行期限'),
    warning: pick('今やってはいけないこと'),
    rawOutput: raw,
  }
}

export function parseOS2Output(raw: string): OS2ConversationResult | null {
  const pick = (label: string): string => {
    const m = raw.match(new RegExp(`【${label}】([\\s\\S]*?)(?=【|$)`))
    return m ? m[1].trim() : ''
  }

  const replyBlock = pick('次の返信案')
  const raM = replyBlock.match(/案A[（(]前進案[）)]：([^\n]+)/)
  const rbM = replyBlock.match(/案B[（(]安全案[）)]：([^\n]+)/)

  const judgment = pick('判定')
  if (!judgment) return null

  const clean = (s: string) => s.trim().replace(/^[「『]|[」』]$/g, '')

  return {
    judgment,
    nextAction: pick('次アクション'),
    deadline: pick('実行期限'),
    suggestedA: raM ? clean(raM[1]) : '',
    suggestedB: rbM ? clean(rbM[1]) : '',
    warning: pick('今やってはいけないこと'),
    rawOutput: raw,
  }
}
