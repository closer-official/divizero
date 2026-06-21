import type { PipelineItem, Touch } from '../types'

export interface ParsedTouch {
  targetPostText: string
  targetPostType: string
  targetValidity: string
  gateJudgment: string
  suggestedTextA: string
  provisionalJudgmentA: string
  suggestedTextB: string
  provisionalJudgmentB: string
  nextAim: string
}

function formatDate(isoStr: string): string {
  return isoStr.slice(0, 10)
}

function formatTouchHistory(touches: Touch[]): string {
  if (touches.length === 0) return '（まだタッチ履歴なし。これが初回接触）'
  return touches
    .slice(0, 5)
    .map(t => {
      const date = formatDate(t.date)
      const reaction = t.status === 'awaiting_reaction' ? '反応待ち' : t.reactionType
      return `${date}／${t.targetPostType}／送った文: ${t.actualSentText}／反応: ${reaction}`
    })
    .join('\n')
}

function channelLabel(channel: string): string {
  if (channel === 'twitter') return 'X'
  if (channel === 'instagram') return 'Instagram'
  if (channel === 'threads') return 'Threads'
  return channel
}

export async function buildTouchPrompt(item: PipelineItem, touches: Touch[]): Promise<string> {
  const template = await fetch('/prompts/OS_継続接触_タッチ生成_latest.md').then(r => r.text())

  const recentTouches = [...touches].reverse()
  const likeReturnCount = touches.filter(t => t.reactionType === 'いいね返り').length
  const followReturned = touches.some(t => t.reactionType === 'フォロー返し')
  const lastTouchedAt = touches.length > 0
    ? touches.reduce((l, t) => t.date > l ? t.date : l, touches[0].date)
    : null

  const replacements: Record<string, string> = {
    accountName: item.accountName ?? '不明',
    handle: item.url ?? '不明',
    channel: channelLabel(item.channel),
    track: item.track ?? '不明',
    currentStep: item.currentStep ?? '不明',
    hypothesis: item.hypothesis ?? '（仮説未設定）',
    touchHistory: formatTouchHistory(recentTouches),
    s1Count: String(touches.length),
    likeReturnCount: String(likeReturnCount),
    followReturned: followReturned ? '有' : '無',
    lastTouchedAt: lastTouchedAt ? formatDate(lastTouchedAt) : 'なし',
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? '')
}

export function parseTouchOutput(raw: string): ParsedTouch | null {
  const block = raw.match(/===TOUCH_START===([\s\S]*?)===TOUCH_END===/)?.[1]
  if (!block) return null

  const pick = (label: string): string => {
    const m = block.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`))
    return m ? m[1].trim() : ''
  }

  const pickUntil = (label: string, stopLabel: string): string => {
    const m = block.match(new RegExp(`${label}\\s*[:：]\\s*([\\s\\S]+?)(?=\\n${stopLabel}|$)`))
    return m ? m[1].trim() : ''
  }

  const normalizePostType = (s: string): string => {
    const map: Record<string, string> = {
      '課題ツイート': '課題ツイート', '課題': '課題ツイート',
      '通常投稿': '通常投稿', '通常': '通常投稿',
      '達成・嬉しい報告': '達成・嬉しい報告', '達成': '達成・嬉しい報告',
      '愚痴・本音': '愚痴・本音', '愚痴': '愚痴・本音',
      'ネタ': 'ネタ', 'ストーリー': 'ストーリー', 'その他': 'その他',
    }
    return map[s.trim()] ?? s.trim()
  }

  const normalizeValidity = (s: string): string => {
    const t = s.trim()
    if (/[◯○]/.test(t)) return '◯'
    if (/△/.test(t)) return '△'
    if (/[✕×x]/i.test(t)) return '✕'
    return '未評価'
  }

  return {
    targetPostText: pick('接触した投稿'),
    targetPostType: normalizePostType(pick('投稿種別')),
    targetValidity: normalizeValidity(pick('対象妥当性')),
    gateJudgment: pick('ゲート判定'),
    suggestedTextA: pickUntil('提案文A', '仮判定A'),
    provisionalJudgmentA: pick('仮判定A').trim(),
    suggestedTextB: pickUntil('提案文B', '仮判定B'),
    provisionalJudgmentB: pick('仮判定B').trim(),
    nextAim: pick('次の狙い'),
  }
}
