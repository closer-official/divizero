import type { PipelineItem, Touch } from '../types'

export interface DMGenerationResult {
  entryType: string
  currentStep: string
  conversationState: string
  suggestedA: string
  suggestedB: string
  nextAim: string
  os2Recommended: boolean
  os2Reason: string
  rawOutput: string
}

export function buildDMPrompt(
  item: PipelineItem,
  touch: Touch,
  template: string
): string {
  const turns = touch.conversationTurns ?? []
  const selfTurns = turns.filter(t => t.role === '自分')
  const replyTurns = turns.filter(t => t.role === '相手')

  const entryLabel: Record<string, string> = {
    s1l_promotion: 'S1-L昇格',
    s3_direct: 'S3直行（IGストーリー返信起点）',
    log_restore: 'ログ復元',
  }
  const entryType = entryLabel[touch.threadEntry ?? 's1l_promotion'] ?? 'S1-L昇格'

  const conversationLog = turns.map(turn => {
    const selfIdx = selfTurns.indexOf(turn)
    const replyIdx = replyTurns.indexOf(turn)
    const label = turn.role === '自分'
      ? `【自分｜送信${selfIdx + 1}（${turn.timestamp.slice(0, 10)}）】`
      : `【相手｜返信${replyIdx + 1}（${turn.timestamp.slice(0, 10)}）】`
    return `${label}\n${turn.text}`
  }).join('\n\n')

  return template
    .replace('{{accountName}}', item.accountName)
    .replace('{{handle}}', item.url)
    .replace('{{channel}}', item.channel)
    .replace('{{track}}', item.track)
    .replace('{{currentStep}}', item.currentStep)
    .replace('{{hypothesis}}', item.hypothesis || '未設定')
    .replace('{{entryType}}', entryType)
    .replace('{{conversationLog}}', conversationLog)
}

export function parseDMOutput(raw: string): DMGenerationResult | null {
  const block = raw.match(/={1,3}DM_START={1,3}([\s\S]*?)={1,3}DM_END={1,3}/)?.[1]
  if (!block) return null

  const pick = (label: string): string => {
    const m = block.match(new RegExp(`${label}:\\s*(.+)`))
    return m ? m[1].trim() : ''
  }

  const os2Field = pick('OS②起動推奨')
  const os2Recommended = os2Field.startsWith('はい')
  const os2Reason = os2Field.replace(/^(はい|いいえ)\s*[—\-ー]\s*/, '').trim()

  const suggestedA = pick('提案文A')
  const suggestedB = pick('提案文B')

  return {
    entryType: pick('エントリー種別'),
    currentStep: pick('現在ステップ'),
    conversationState: pick('会話状態'),
    suggestedA,
    suggestedB,
    nextAim: pick('次の狙い'),
    os2Recommended,
    os2Reason,
    rawOutput: raw,
  }
}
