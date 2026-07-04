import type { PipelineItem, Touch } from '../types'
import { hasReaction, reactionDisplay } from './helpers'
import { getDisplayScore } from './salesExpUtils'
import { formatOpportunityFacts, getOpportunityFitLabel, getOpportunityStatusLabel, getPrioritySegmentLabel } from './opportunityUtils'
import { formatObservations } from './s1ActionPrompt'

export interface BatchS1ActionItem {
  index: number
  pipelineId: string
  touchId: string
  pipelineItem: PipelineItem
  touch: Touch
}

export interface BatchS1ActionResult {
  index: number
  pipelineId: string
  touchId: string
  judgment: string
  reason: string
  nextStep: string
  warning: string
  waitDays?: number
  replyMode?: 'text' | 'like_only' | 'none'
  replyA?: string
  replyB?: string
  dmScore?: string
  dmMoveReason?: string
}

function buildCaseSection(item: BatchS1ActionItem): string {
  const { pipelineItem: p, touch: t } = item
  const reactionType = reactionDisplay(t.reactionType)
  const touches = p.touches || []
  const followReturned = touches.some(tp => hasReaction(tp.reactionType, 'フォロー返し'))
  const likeTotal = touches.filter(tp => hasReaction(tp.reactionType, 'いいね返り')).length
  const replyTotal = touches.filter(tp => hasReaction(tp.reactionType, 'テキスト返信')).length

  let section = `■ 案件情報
アカウント名：${p.accountName}
チャネル：${p.channel}
トラック：${p.track}
事前仮説：${p.hypothesis || '未設定'}
営業期待値スコア：${getDisplayScore(p) ?? '未設定'}点
営業対象判定：${getOpportunityStatusLabel(p.opportunityStatus)}
優先セグメント：${getPrioritySegmentLabel(p.prioritySegment)}
案件適合度：${getOpportunityFitLabel(p.opportunityFit)}
観測事実：
${formatOpportunityFacts(p.opportunityFacts)}
OS①Observationリスト（priority昇順）：
${formatObservations(p.observations)}

■ 接触した投稿
投稿種別：${t.targetPostType || '—'}
投稿要約：${t.targetPostText || '—'}
投稿原文：
${t.targetPostRawText || '（原文なし）'}

■ 自分が送ったコメント
${t.actualSentText || '—'}

■ 相手のリアクション
種別：${reactionType}
返信テキスト（テキスト返信の場合）：
${t.reactionNote || '（なし）'}

■ S1接触サマリ
S1接触数：${touches.length}回
いいね返り連続：${p.likeReturnStreak || 0}回
いいね累計：${likeTotal}回
テキスト返信累計：${replyTotal}回
無反応連続：${p.noReactionStreak || 0}回
フォロー返し：${followReturned ? '有' : '無'}`

  const turns = t.conversationTurns || []
  if (turns.length > 2) {
    section += '\n\n━━━━━━━━━━━━━━━━━━'
    section += `\n■ 会話履歴（${turns.length}ターン・複数往復）`
    section += '\n※ 最新の「相手の返信」をもとに判定してください。\n'
    section += turns.map((turn, i) => `[${i + 1}] ${turn.role}：${turn.text}`).join('\n')
    section += `\n\n（上記「${turns[turns.length - 1].role}」のメッセージが今回判定する最新の発言です）`
  }

  return section
}

export function buildBatchS1ActionPrompt(items: BatchS1ActionItem[], template: string): string {
  const casesText = items.map(item => [
    `===S1_CASE_START=== ${item.index} ===`,
    buildCaseSection(item),
    `===S1_CASE_END=== ${item.index} ===`,
  ].join('\n')).join('\n\n')

  return template
    .replace(/\{\{count\}\}/g, String(items.length))
    .replace('{{cases}}', casesText)
}

export function parseBatchS1ActionOutput(
  raw: string,
  items: BatchS1ActionItem[]
): BatchS1ActionResult[] {
  const results: BatchS1ActionResult[] = []

  for (const item of items) {
    const blockMatch = raw.match(
      new RegExp(
        `===S1_RESULT_START===\\s*${item.index}\\s*===([\\s\\S]*?)===S1_RESULT_END===\\s*${item.index}\\s*===`
      )
    )
    if (!blockMatch) continue

    const block = blockMatch[1]
    const pick = (label: string): string => {
      const m = block.match(new RegExp(`${label}:\\s*(.+)`))
      return m ? m[1].trim() : ''
    }

    const judgment = pick('判定')
    if (!judgment) continue

    const replyA = pick('返信案A')
    const replyB = pick('返信案B')
    const replyModeRaw = pick('返信方法')
    const replyMode = replyModeRaw.includes('いいね')
      ? 'like_only'
      : replyModeRaw.includes('なし')
        ? 'none'
        : replyModeRaw
          ? 'text'
          : undefined

    const dmScore = pick('DM_SCORE')
    const dmMoveReason = pick('DM移行判断')
    const waitDaysRaw = pick('待機日数')
    const waitDays = waitDaysRaw ? parseInt(waitDaysRaw, 10) : undefined
    results.push({
      index: item.index,
      pipelineId: item.pipelineId,
      touchId: item.touchId,
      judgment,
      reason: pick('理由'),
      nextStep: pick('推奨アクション'),
      warning: pick('警告'),
      waitDays: waitDays !== undefined && !isNaN(waitDays) ? waitDays : undefined,
      replyMode: replyMode || (
        judgment === 'S1継続' || judgment === '公開リプ継続' || judgment === 'DM移行'
          ? (replyA || replyB ? 'text' : 'none')
          : 'none'
      ),
      replyA: replyA && replyA !== 'なし' ? replyA : undefined,
      replyB: replyB && replyB !== 'なし' ? replyB : undefined,
      dmScore: dmScore || undefined,
      dmMoveReason: dmMoveReason || undefined,
    })
  }

  return results
}
