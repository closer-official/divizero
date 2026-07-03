import type { Channel, Observation, OpportunityFacts, PrioritySegment, OpportunityFit, OpportunityStatus, Target, Track } from '../types'
import { parseOS1, parseOS1Instagram, parseOS1Threads } from './parser'
import { formatOpportunityFacts, getOpportunityFitLabel, getOpportunityStatusLabel, getPrioritySegmentLabel } from './opportunityUtils'
import { getDisplayScore } from './salesExpUtils'

export interface SpecRefreshBatchItem {
  index: number
  target: Target
}

export interface SpecRefreshParsed {
  caseId?: string
  accountName?: string
  url?: string
  channel?: Channel
  track?: Track
  hypothesis?: string
  startDate?: string
  contactA?: string
  contactB?: string
  storyA?: string
  storyB?: string
  storyNote?: string
  dmA?: string
  dmB?: string
  dmNote?: string
  trackReason?: string
  partnerFlag?: string
  nextAction?: string
  dmRoute?: string
  estimatedProduct?: string
  estimatedPrice?: string
  opportunityStatus?: OpportunityStatus
  opportunityStatusReason?: string
  prioritySegment?: PrioritySegment
  prioritySegmentReason?: string
  opportunityFacts?: OpportunityFacts
  opportunityFit?: OpportunityFit
  opportunityFitReason?: string
  opportunityBreakdown?: string
  primaryHypothesisPattern?: 'A' | 'B' | 'C' | 'D'
  naturalQuestion?: string
  forbiddenAngles?: string[]
  observations?: Observation[]
}

export interface SpecRefreshBatchResult {
  index: number
  targetId: string
  rawOutput: string
  parsed: SpecRefreshParsed
}

function parseByChannel(text: string, channel: Channel): SpecRefreshParsed {
  if (channel === 'instagram') return parseOS1Instagram(text) as SpecRefreshParsed
  if (channel === 'threads') return parseOS1Threads(text) as SpecRefreshParsed
  return parseOS1(text) as SpecRefreshParsed
}

function latestSpecMissingLabels(target: Pick<Target, 'opportunityStatus' | 'prioritySegment' | 'opportunityFit' | 'opportunityFacts'>): string[] {
  const missing: string[] = []
  if (!target.opportunityStatus) missing.push('営業対象判定')
  if (!target.prioritySegment) missing.push('優先セグメント')
  if (!target.opportunityFit) missing.push('案件適合度')
  if (!target.opportunityFacts || !Object.values(target.opportunityFacts).some(v => v !== undefined)) missing.push('観測事実')
  return missing
}

function buildCaseSection(item: SpecRefreshBatchItem): string {
  const t = item.target
  const missing = latestSpecMissingLabels(t)
  const currentFacts = t.opportunityFacts ? formatOpportunityFacts(t.opportunityFacts) : '（未設定）'

  return [
    `【再判定対象 ${item.index}】`,
    `アカウント名：${t.accountName}`,
    `ユーザーネーム（@〜）：${t.url || '未設定'}`,
    `チャネル：${t.channel}`,
    `トラック：${t.track}`,
    `事前仮説：${t.hypothesis || '未設定'}`,
    `観測スコア（旧）：${getDisplayScore(t) ?? '未設定'}点`,
    `営業対象判定（現状）：${getOpportunityStatusLabel(t.opportunityStatus)}`,
    `優先セグメント（現状）：${getPrioritySegmentLabel(t.prioritySegment)}`,
    `案件適合度（現状）：${getOpportunityFitLabel(t.opportunityFit)}`,
    `観測事実（現状）：`,
    currentFacts,
    `未設定の更新対象：${missing.length > 0 ? missing.join(' / ') : 'なし'}`,
    `旧OS1出力：`,
    t.aiOutput || '（旧出力なし）',
  ].filter(Boolean).join('\n')
}

export function buildSpecRefreshBatchPrompt(items: SpecRefreshBatchItem[], template: string): string {
  const casesText = items.map(item => [
    `===SPEC_REFRESH_CASE_START=== ${item.index} ===`,
    buildCaseSection(item),
    `===SPEC_REFRESH_CASE_END=== ${item.index} ===`,
  ].join('\n')).join('\n\n')

  return template
    .replace(/\{\{count\}\}/g, String(items.length))
    .replace('{{cases}}', casesText)
}

export function parseSpecRefreshBatchOutput(raw: string, items: SpecRefreshBatchItem[]): SpecRefreshBatchResult[] {
  const results: SpecRefreshBatchResult[] = []

  for (const item of items) {
    const blockMatch = raw.match(
      new RegExp(
        `===SPEC_REFRESH_RESULT_START===\\s*${item.index}\\s*===([\\s\\S]*?)===SPEC_REFRESH_RESULT_END===\\s*${item.index}\\s*===`
      )
    )
    if (!blockMatch) continue

    const block = blockMatch[1].trim()
    const parsed = parseByChannel(block, item.target.channel)
    if (!parsed.accountName && !parsed.url) continue

    results.push({
      index: item.index,
      targetId: item.target.id,
      rawOutput: block,
      parsed,
    })
  }

  return results
}

export function getLatestSpecMissingLabels(target: Pick<Target, 'opportunityStatus' | 'prioritySegment' | 'opportunityFit' | 'opportunityFacts'>): string[] {
  return latestSpecMissingLabels(target)
}

export function isLatestSpecRefreshTarget(target: Pick<Target, 'opportunityStatus' | 'prioritySegment' | 'opportunityFit' | 'opportunityFacts'>): boolean {
  return latestSpecMissingLabels(target).length > 0
}
