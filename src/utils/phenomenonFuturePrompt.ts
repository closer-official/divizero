import type { PipelineItem, Touch } from '../types'

export interface PhenomenonFutureResult {
  channel: string
  track: string
  purpose: string
  reactionPattern: string
  suggestedA: string
  suggestedB: string
  aim: string
  nextAction: string
  recontactDays: number | null
  rawOutput: string
}

export function buildPhenomenonFuturePrompt(
  item: PipelineItem,
  touch: Touch,
  template: string
): string {
  const turns = touch.conversationTurns ?? []
  const selfTurns = turns.filter(t => t.role === '自分')
  const replyTurns = turns.filter(t => t.role === '相手')
  const lastReply = replyTurns[replyTurns.length - 1]

  const daysSinceLast = item.lastContactDate
    ? Math.floor((Date.now() - new Date(item.lastContactDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  const conversationLog = turns.length > 0
    ? turns.map(turn => {
        const selfIdx = selfTurns.indexOf(turn)
        const replyIdx = replyTurns.indexOf(turn)
        const label = turn.role === '自分'
          ? `【自分｜送信${selfIdx + 1}（${turn.timestamp.slice(0, 10)}）】`
          : `【相手｜返信${replyIdx + 1}（${turn.timestamp.slice(0, 10)}）】`
        return `${label}\n${turn.text}`
      }).join('\n\n')
    : '（会話ログなし）'

  const channelMap: Record<string, string> = { twitter: 'X', instagram: 'Instagram', threads: 'Threads' }
  const channelDisplay = channelMap[item.channel] ?? item.channel
  const temperature = item.temperature ?? 0

  return template
    .replace('{{accountName}}', item.accountName)
    .replace('{{handle}}', item.url)
    .replace('{{channel}}', channelDisplay)
    .replace('{{track}}', item.track)
    .replace('{{temperature}}', String(temperature))
    .replace('{{daysSinceLast}}', String(daysSinceLast))
    .replace('{{lastReply}}', lastReply?.text ?? '（返信なし）')
    .replace('{{conversationLog}}', conversationLog)
    .replace('{{hypothesis}}', item.hypothesis ?? '未設定')
}

export function parsePhenomenonFutureOutput(raw: string): PhenomenonFutureResult | null {
  const block = raw.match(/={1,3}MSG_START={1,3}([\s\S]*?)={1,3}MSG_END={1,3}/)?.[1]
  if (!block) return null

  const pick = (label: string): string => {
    const m = block.match(new RegExp(`${label}:\\s*(.+)`))
    return m ? m[1].trim() : ''
  }

  const suggestedA = pick('提案文A')
  const suggestedB = pick('提案文B').replace(/^（空欄）$/, '')
  if (!suggestedA && !suggestedB) return null

  const nextAction = pick('次のアクション')
  const recontactMatch = nextAction.match(/(\d+)日後に再接触/)
  const recontactDays = recontactMatch ? parseInt(recontactMatch[1], 10) : null

  return {
    channel: pick('チャネル'),
    track: pick('トラック'),
    purpose: pick('今回の目的'),
    reactionPattern: pick('返信パターン判定'),
    suggestedA,
    suggestedB,
    aim: pick('今回の狙い'),
    nextAction,
    recontactDays,
    rawOutput: raw,
  }
}
