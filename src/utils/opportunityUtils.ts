import type {
  OpportunityFacts,
  OpportunityFit,
  OpportunityStatus,
  PipelineItem,
  PrioritySegment,
  Target,
} from '../types'

export const OPPORTUNITY_FACT_ITEMS: {
  key: keyof OpportunityFacts
  label: string
}[] = [
  { key: 'usesUtageConfirmed', label: 'UTAGE利用が確認できる' },
  { key: 'sellsProductConfirmed', label: '商品販売の実体が確認できる' },
  { key: 'hasExistingLpOrHpConfirmed', label: '既存LP/HPが確認できる' },
  { key: 'hasLimitedSalesFlowConfirmed', label: '販売導線が限定的である' },
  { key: 'lacksProductInfoConfirmed', label: '商品理解に必要な情報不足が確認できる' },
]

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  target: '対象',
  hold: '保留',
  out: '対象外',
}

export const PRIORITY_SEGMENT_LABELS: Record<PrioritySegment, string> = {
  utage: 'UTAGE優先',
  normal: '通常',
  partner: '提携候補',
}

export const OPPORTUNITY_FIT_LABELS: Record<OpportunityFit, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export function normalizeOpportunityStatus(raw?: string): OpportunityStatus | undefined {
  if (!raw) return undefined
  if (raw.includes('対象外')) return 'out'
  if (raw.includes('保留')) return 'hold'
  if (raw.includes('対象')) return 'target'
  return undefined
}

export function normalizePrioritySegment(raw?: string): PrioritySegment | undefined {
  if (!raw) return undefined
  if (/UTAGE|UT\b/i.test(raw)) return 'utage'
  if (raw.includes('提携')) return 'partner'
  if (raw.includes('通常')) return 'normal'
  return undefined
}

export function normalizeOpportunityFit(raw?: string): OpportunityFit | undefined {
  if (!raw) return undefined
  if (raw.includes('高')) return 'high'
  if (raw.includes('中')) return 'medium'
  if (raw.includes('低')) return 'low'
  return undefined
}

export function getOpportunityStatusLabel(status?: OpportunityStatus): string {
  return status ? OPPORTUNITY_STATUS_LABELS[status] : '未設定'
}

export function getPrioritySegmentLabel(segment?: PrioritySegment): string {
  return segment ? PRIORITY_SEGMENT_LABELS[segment] : '未設定'
}

export function getOpportunityFitLabel(fit?: OpportunityFit): string {
  return fit ? OPPORTUNITY_FIT_LABELS[fit] : '未設定'
}

export function isUTAGEPriority(item: Pick<Target | PipelineItem, 'prioritySegment' | 'opportunityFacts' | 'track'>): boolean {
  return item.prioritySegment === 'utage'
    || !!item.opportunityFacts?.usesUtageConfirmed
    || item.track === 'UT'
  }

export function isStrongOpportunity(item: Pick<Target | PipelineItem, 'prioritySegment' | 'opportunityFit' | 'opportunityStatus' | 'opportunityFacts' | 'track'>): boolean {
  if (item.opportunityStatus === 'out') return false
  return isUTAGEPriority(item) || item.opportunityFit === 'high'
}

export function formatOpportunityFacts(facts?: OpportunityFacts): string {
  if (!facts) return '（未設定）'
  const lines = OPPORTUNITY_FACT_ITEMS
    .filter(entry => facts[entry.key] !== undefined)
    .map(entry => `・${entry.label}: ${facts[entry.key] ? 'YES' : 'NO'}`)
  return lines.length > 0 ? lines.join('\n') : '（未設定）'
}
