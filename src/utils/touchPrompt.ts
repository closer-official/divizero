import type { PipelineItem, Touch } from '../types'
import { hasReaction, reactionDisplay } from './helpers'

export interface InboundTouchPromptContext {
  ownPostText: string
  ownPostRawText: string
  inboundMemo: string
  inboundReactions: string[]
  inboundChannel: 'リプ' | 'DM'
}

export interface ParsedTouch {
  targetPostText: string
  targetPostRawText: string
  targetPostType: string
  targetValidity: string
  gateJudgment: string
  suggestedTextA: string
  provisionalJudgmentA: string
  suggestedTextB: string
  provisionalJudgmentB: string
  nextAim: string
  postDateTime?: string
  engagementStats?: string
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
      const reaction = t.status === 'awaiting_reaction' ? '反応待ち' : reactionDisplay(t.reactionType)
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

export interface TargetPostInfo {
  url?: string
  text?: string
  postedAt?: string
}

export function buildTouchPromptFromTemplate(item: PipelineItem, touches: Touch[], template: string, targetPost?: TargetPostInfo): string {
  const recentTouches = [...touches].reverse()
  const likeReturnCount = touches.filter(t => hasReaction(t.reactionType, 'いいね返り')).length
  const followReturned = touches.some(t => hasReaction(t.reactionType, 'フォロー返し'))
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

  const base = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? '')
  if (!targetPost || (!targetPost.text?.trim() && !targetPost.url?.trim())) return base
  const lines = [
    '',
    '━━━━━━━━━━━━━━━━━━',
    '【今回の接触対象投稿（拡張機能が自動取得）】',
    targetPost.url?.trim() ? `投稿URL: ${targetPost.url.trim()}` : '',
    targetPost.postedAt?.trim() ? `投稿日時: ${targetPost.postedAt.trim()}` : '',
    targetPost.text?.trim() ? `投稿本文:\n${targetPost.text.trim()}` : '',
    '',
    '※スクリーンショットが添付されない場合は、上記の投稿本文を接触対象として処理してください。',
    '※画像の内容やリプ欄の温度が判断に必要な場合のみ、スクリーンショットを併用してください。',
  ].filter(Boolean)
  return base + '\n' + lines.join('\n')
}

export async function buildTouchPrompt(item: PipelineItem, touches: Touch[], targetPost?: TargetPostInfo): Promise<string> {
  const template = await fetch('/prompts/OS_継続接触_タッチ生成_latest.md').then(r => r.text())
  return buildTouchPromptFromTemplate(item, touches, template, targetPost)
}

export async function buildInboundTouchPrompt(
  item: PipelineItem,
  touches: Touch[],
  context: InboundTouchPromptContext,
): Promise<string> {
  const base = await buildTouchPrompt(item, touches)
  const reactions = context.inboundReactions.length > 0 ? context.inboundReactions.join('・') : '未選択'
  const ownPostText = context.ownPostText.trim() || '（自分の投稿要約なし）'
  const ownPostRawText = context.ownPostRawText.trim() || ownPostText
  const memo = context.inboundMemo.trim() || '（補足メモなし）'

  return [
    '【今回のケースは通常の新規投稿タッチではなく、相手からのインバウンド反応への返信作成です】',
    `- チャネル: ${context.inboundChannel}`,
    `- 相手からの反応: ${reactions}`,
    `- こちらが先に出していた投稿の要約: ${ownPostText}`,
    '━━━━━━━━━━━━━━━━━━',
    '【このケースでの処理ルール】',
    '1. 添付スクショは不要。以下の「自分の投稿情報」と「相手からの反応・メモ」だけで判断する。',
    '2. 出力フォーマットは通常どおり ===TOUCH_START=== / ===TOUCH_END=== を厳守する。',
    '3. 「接触した投稿」「投稿原文」には、相手投稿ではなく以下の自分の投稿情報を入れる。',
    '4. 提案文A/Bには、相手から来た反応への返答文を出す。公開リプなら短く自然に、DMなら会話継続しやすく。',
    '5. 投稿種別・対象妥当性・ゲート判定も、この自分の投稿に来た反応への返答として自然な値を補完する。',
    '━━━━━━━━━━━━━━━━━━',
    '【自分の投稿情報】',
    `接触した投稿: ${ownPostText}`,
    `投稿原文: ${ownPostRawText}`,
    '━━━━━━━━━━━━━━━━━━',
    '【相手からの反応・メモ】',
    memo,
    '━━━━━━━━━━━━━━━━━━',
    base,
  ].join('\n')
}

export function parseTouchOutput(raw: string): ParsedTouch | null {
  const matches = [...raw.matchAll(/={1,3}TOUCH_START={1,3}([\s\S]*?)={1,3}TOUCH_END={1,3}/g)]
  if (matches.length === 0) return null
  const block = matches[matches.length - 1][1]

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

  const postDateTime = pick('投稿日時')
  const engagementStats = pick('エンゲージメント')
  return {
    targetPostText: pick('接触した投稿'),
    targetPostRawText: pickUntil('投稿原文', '投稿日時') || pickUntil('投稿原文', '投稿種別'),
    targetPostType: normalizePostType(pick('投稿種別')),
    targetValidity: normalizeValidity(pick('対象妥当性')),
    gateJudgment: pick('ゲート判定'),
    suggestedTextA: pickUntil('提案文A', '仮判定A'),
    provisionalJudgmentA: pick('仮判定A').trim(),
    suggestedTextB: pickUntil('提案文B', '仮判定B'),
    provisionalJudgmentB: pick('仮判定B').trim(),
    nextAim: pick('次の狙い'),
    postDateTime: postDateTime && postDateTime !== '不明' ? postDateTime : undefined,
    engagementStats: engagementStats && engagementStats !== '不明' ? engagementStats : undefined,
  }
}
