import type { Observation, PipelineItem, Touch } from '../types'
import { hasReaction, reactionDisplay } from './helpers'
import { getDisplayScore } from './salesExpUtils'
import {
  formatOpportunityFacts,
  getOpportunityFitLabel,
  getOpportunityStatusLabel,
  getPrioritySegmentLabel,
} from './opportunityUtils'

function formatObservations(observations: Observation[] | undefined): string {
  if (!observations || observations.length === 0) {
    return '（なし — 旧形式案件のためnaturalQuestionを使うこと）'
  }
  const sorted = [...observations].sort((a, b) => a.priority - b.priority)
  return sorted.map(o =>
    `[priority:${o.priority}] 観察:${o.observation} / 疑問:${o.curiosity} / DM質問:${o.naturalQuestion}`
  ).join('\n')
}

export interface S1ActionResult {
  judgment: string
  reason: string
  nextStep: string
  warning: string
  waitDays?: number
  replyA?: string
  replyB?: string
  dmScore?: string
  dmMoveReason?: string
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

  const isInboundDM = (item.isInbound || !!item.inbound_signal) &&
    (item.inboundActions?.includes('突然DM') || item.inbound_signal?.type === '突然DM')

  const resolvedTargetPostRawText = isInboundDM
    ? '（インバウンドDM案件のため、接触した投稿はありません）'
    : (touch.targetPostRawText || '（原文なし）')

  const resolvedReactionNote = isInboundDM && !touch.reactionNote && item.inbound_signal?.memo
    ? `相手からのDM内容：\n${item.inbound_signal.memo}`
    : (touch.reactionNote || '（なし）')

  const forbiddenAnglesStr = item.forbiddenAngles?.length
    ? item.forbiddenAngles.join('・')
    : '（OS①カルテ未作成 — 売り込み・提案フレーズは禁止）'

  let result = template
    .replace('{{accountName}}', item.accountName)
    .replace('{{channel}}', item.channel)
    .replace('{{track}}', item.track)
    .replace('{{trackReason}}', item.trackReason || '（未記録）')
    .replace('{{estimatedProduct}}', item.estimatedProduct || '（未記録）')
    .replace('{{partnerFlag}}', item.partnerFlag || '（未記録）')
    .replace('{{hypothesis}}', item.hypothesis || '未設定')
    .replace('{{salesExpectation}}', String(getDisplayScore(item) ?? '未設定'))
    .replace('{{opportunityStatus}}', getOpportunityStatusLabel(item.opportunityStatus))
    .replace('{{prioritySegment}}', getPrioritySegmentLabel(item.prioritySegment))
    .replace('{{opportunityFit}}', getOpportunityFitLabel(item.opportunityFit))
    .replace('{{opportunityFacts}}', formatOpportunityFacts(item.opportunityFacts))
    .replace('{{primaryHypothesisPattern}}', item.primaryHypothesisPattern || '（OS①カルテ未作成）')
    .replace('{{naturalQuestion}}', item.naturalQuestion || '（OS①カルテ未作成 — 仮説から自力で問いを生成すること）')
    .replace('{{forbiddenAngles}}', forbiddenAnglesStr)
    .replace('{{observations}}', formatObservations(item.observations))
    .replace('{{targetPostType}}', touch.targetPostType || '—')
    .replace('{{targetPostText}}', touch.targetPostText || '—')
    .replace('{{targetPostRawText}}', resolvedTargetPostRawText)
    .replace('{{actualSentText}}', touch.actualSentText || '—')
    .replace('{{reactionType}}', reactionType)
    .replace('{{reactionNote}}', resolvedReactionNote)
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

  // インバウンドコンテキスト追加
  const inboundActions = item.inboundActions?.length
    ? item.inboundActions
    : item.inbound_signal ? [item.inbound_signal.type] : []
  if ((item.isInbound || item.inbound_signal) && inboundActions.length > 0) {
    result += '\n\n━━━━ インバウンド情報（重要） ━━━━'
    result += '\n■ この案件はインバウンド起点です（こちらから接触する前に、相手から先にアクションが来ています）'
    result += `\n■ 相手からのアクション：${inboundActions.join('、')}`
    if (item.inbound_signal?.date) result += `\n■ 起点日：${item.inbound_signal.date}`
    if (item.inbound_signal?.memo) result += `\n■ 備考：${item.inbound_signal.memo}`
    result += '\n■ 判定留意点：相手が先にアクションしている分、接触ハードルは低め。フォロー返し・リプへの反応率は通常より高いと仮定して、積極的な初期アクション（フォロー返し+早期リプ等）を優先してください。'
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

  const dmScore = pick('DM_SCORE')
  const dmMoveReason = pick('DM移行判断')
  const waitDaysRaw = pick('待機日数')
  const waitDays = waitDaysRaw ? parseInt(waitDaysRaw, 10) : undefined

  return {
    judgment,
    reason: pick('理由'),
    nextStep: pick('推奨アクション'),
    warning: pick('警告'),
    waitDays: waitDays !== undefined && !isNaN(waitDays) ? waitDays : undefined,
    replyA: replyA && replyA !== 'なし' ? replyA : undefined,
    replyB: replyB && replyB !== 'なし' ? replyB : undefined,
    dmScore: dmScore || undefined,
    dmMoveReason: dmMoveReason || undefined,
  }
}
