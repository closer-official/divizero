import type { PipelineItem, SalesExpectationFacts, Target } from '../types'

export const SALES_EXP_ITEMS: {
  key: keyof SalesExpectationFacts
  label: string
  score: number
}[] = [
  { key: 'isEducatorConfirmed', label: '教育者（コンサル・講師・コミュニティ運営者）', score: 8 },
  { key: 'usesUtageConfirmed', label: 'UTAGE利用が確認済み', score: 8 },
  { key: 'hasStudentsOrCommunityConfirmed', label: '受講生・コミュニティ会員の存在が確認済み', score: 8 },
  { key: 'hasLineOrHighTicketOfferConfirmed', label: 'LINE販売または高単価無形商材が確認済み', score: 6 },
  { key: 'hasNoteOrLpSalesFlowConfirmed', label: 'note・LP等の販売導線が確認済み', score: 5 },
  { key: 'sellsIntangibleProductConfirmed', label: '無形商材販売が確認済み（上記以外）', score: 4 },
  { key: 'hasExistingLpOrHpConfirmed', label: 'LP・HPが既に存在する（減点）', score: -3 },
]

export function calcSalesExpectationScore(facts: SalesExpectationFacts): number {
  const score = SALES_EXP_ITEMS.reduce((sum, entry) => sum + (facts[entry.key] ? entry.score : 0), 0)
  return Math.min(40, Math.max(0, score))
}

export function getDisplayScore(
  item: Pick<Target | PipelineItem, 'salesExpectationFacts' | 'salesExpectation'>,
): number | undefined {
  return item.salesExpectationFacts
    ? calcSalesExpectationScore(item.salesExpectationFacts)
    : item.salesExpectation
}
