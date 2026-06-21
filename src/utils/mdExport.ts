import type { AppData, PipelineItem, Analysis } from '../types'
import { hasReaction, reactionDisplay } from './helpers'

function dateStr(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('ja-JP')
}

function todayFilename(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// ── 1. 案件別MD ────────────────────────────────────────────────
export function buildCaseMd(item: PipelineItem): string {
  const touches = item.touches || []
  const likeReturnCount = touches.filter(t => hasReaction(t.reactionType, 'いいね返り')).length
  const followReturned = touches.some(t => hasReaction(t.reactionType, 'フォロー返し'))

  let md = `# ${item.accountName}（${item.url}）| ${item.channel} | ${item.track}\n\n`
  md += `**案件ID：** ${item.id}\n`
  md += `**接触開始日：** ${dateStr(item.startDate)}\n`
  md += `**事前仮説：** ${item.hypothesis || '—'}\n`
  md += `**現在ステップ：** ${item.currentStep}\n`
  md += `**S1接触数：** ${touches.length}回　いいね返り：${likeReturnCount}回　フォロー返し：${followReturned ? '有' : '無'}\n\n`
  md += `---\n\n## タッチ履歴\n\n`

  touches.forEach((touch, i) => {
    if (touch.touchMode === 'conversation') {
      // 会話スレッドモード
      const entryLabel: Record<string, string> = {
        s1l_promotion: 'S1-L昇格',
        s3_direct: 'S3直行（IGストーリー）',
        log_restore: 'ログ復元',
      }
      const entryName = touch.threadEntry ? entryLabel[touch.threadEntry] ?? touch.threadEntry : ''
      md += `### 会話スレッド${i + 1}${entryName ? ` — ${entryName}` : ''}\n\n`
      ;(touch.conversationTurns ?? []).forEach(turn => {
        const prefix = turn.role === '自分' ? '▶ 自分' : '◀ 相手'
        md += `**${prefix}**（${dateStr(turn.timestamp)}）\n${turn.text}\n\n`
        if (turn.dmSuggestedA) {
          md += `　DM提案A：${turn.dmSuggestedA}\n`
          md += `　DM提案B：${turn.dmSuggestedB}\n`
          md += `　次の狙い：${turn.dmNextAim}\n`
          if (turn.dmOs2Recommended) md += `　⚠ OS²起動推奨あり\n`
        }
        if (turn.os2Judgment) {
          md += `　OS②判定：${turn.os2Judgment} ／ 次アクション：${turn.os2NextAction || '—'}\n`
        }
        md += '\n'
      })
      md += `---\n\n`
    } else {
      // 既存の新規投稿タッチモード
      md += `### タッチ${i + 1} — ${dateStr(touch.date)}\n\n`
      md += `**接触した投稿（要約）：** ${touch.targetPostText || '—'}\n`
      if (touch.targetPostRawText) md += `**投稿原文：** ${touch.targetPostRawText}\n`
      md += `**投稿種別：** ${touch.targetPostType}　**対象妥当性：** ${touch.targetValidity}\n\n`
      if (touch.aiSuggestedText) {
        md += `**AI提案文：** ${touch.aiSuggestedText}\n`
      }
      if (touch.os2ReplyA) {
        md += `**AI提案文A：** ${touch.os2ReplyA}\n`
        if (touch.os2ReplyB) md += `**AI提案文B：** ${touch.os2ReplyB}\n`
      }
      md += `\n**実際に送った文章：** ${touch.actualSentText || '—'}\n`
      md += `**変えた理由：** ${touch.editReason || '（なし）'}\n\n`
      md += `**文面妥当性：** ${touch.messageValidity}`
      if (touch.judgedAt) md += `（${dateStr(touch.judgedAt)}判定）`
      md += `\n`
      if (touch.judgmentReason) md += `**判定理由：** ${touch.judgmentReason}\n`
      if (touch.editEvaluation) md += `**編集評価：** ${touch.editEvaluation}　${touch.editComment || ''}\n`
      if (touch.improvementSuggestion && touch.improvementSuggestion !== 'なし') {
        md += `**改善提案：** ${touch.improvementSuggestion}\n`
      }
      if (touch.improvedText && touch.improvedText !== 'なし') {
        md += `**改善案：** ${touch.improvedText}\n`
      }
      md += `\n**相手の反応：** ${reactionDisplay(touch.reactionType)}\n`
      if (touch.reactionNote) md += `**反応の補足：** ${touch.reactionNote}\n`
      if (touch.os2Judgment) {
        md += `\n**OS②判定：** ${touch.os2Judgment}\n`
        md += `**次アクション：** ${touch.os2NextAction || '—'}\n`
      }
      // 会話スレッドをMDに追加
      if (touch.threadStatus === 'active' && touch.conversationTurns?.length) {
        md += `\n#### 会話スレッド\n\n`
        touch.conversationTurns.forEach(turn => {
          const prefix = turn.role === '自分' ? '▶ 自分' : '◀ 相手'
          md += `**${prefix}**（${dateStr(turn.timestamp)}）\n${turn.text}\n\n`
          if (turn.os2Judgment) {
            md += `　OS②判定：${turn.os2Judgment} / 次アクション：${turn.os2NextAction || '—'}\n`
            md += `\n`
          }
        })
      }
      md += `\n---\n\n`
    }
  })

  // OS②判定履歴テーブル
  const judgedTouches = touches.filter(t => t.os2Judgment)
  if (judgedTouches.length > 0) {
    md += `## OS②判定履歴\n\n`
    md += `| 日付 | 判定 | 次アクション |\n`
    md += `|------|------|-------------|\n`
    judgedTouches.forEach(t => {
      md += `| ${dateStr(t.date)} | ${t.os2Judgment} | ${t.os2NextAction || '—'} |\n`
    })
    md += `\n`
  }

  return md
}

export function caseMdFilename(item: PipelineItem): string {
  const safe = item.accountName.replace(/[\\/:*?"<>|]/g, '_')
  return `${safe}_${todayFilename()}.md`
}

// ── 2. 全案件サマリMD ─────────────────────────────────────────
export function buildSummaryMd(data: AppData): string {
  const active = (data.pipeline || []).filter(p => p.isOpen)
  const closed = data.closed || []
  const total = active.length + closed.length

  let md = `# 案件サマリ — ${new Date().toLocaleDateString('ja-JP')}出力\n\n`
  md += `総案件数：${total}件（進行中：${active.length}件 / クローズ済み：${closed.length}件）\n\n`
  md += `---\n\n`

  md += `## 進行中案件\n\n`
  if (active.length === 0) {
    md += `進行中の案件はありません。\n\n`
  } else {
    md += `| アカウント | チャネル | トラック | ステップ | タッチ数 | 最終接触 | いいね返り |\n`
    md += `|----------|---------|---------|---------|---------|---------|----------|\n`
    active.forEach(p => {
      const touches = p.touches || []
      const likeCount = touches.filter(t => hasReaction(t.reactionType, 'いいね返り')).length
      const lastTouch = touches.length > 0
        ? dateStr(touches.reduce((l, t) => t.date > l ? t.date : l, touches[0].date))
        : dateStr(p.lastContactDate)
      md += `| ${p.accountName} | ${p.channel} | ${p.track} | ${p.currentStep} | ${touches.length} | ${lastTouch} | ${likeCount} |\n`
    })
    md += `\n`
  }

  md += `## クローズ済み案件\n\n`
  if (closed.length === 0) {
    md += `クローズ済みの案件はありません。\n\n`
  } else {
    md += `| アカウント | クローズタイプ | 学習価値 | クローズ日 |\n`
    md += `|----------|-------------|---------|----------|\n`
    closed.forEach(c => {
      md += `| ${c.accountName} | ${c.closeType || c.result} | ${c.learningValue ?? '—'} | ${dateStr(c.closeDate || c.createdAt)} |\n`
    })
    md += `\n`
  }

  return md
}

export function summaryMdFilename(): string {
  return `cases_summary_${todayFilename()}.md`
}

// ── 3. 分析レポートMD ─────────────────────────────────────────
export function buildAnalysisReportMd(data: AppData): string {
  const completed = [...(data.analyses || [])]
    .filter(a => a.status === 'completed')
    .sort((a, b) => (b.completedAt || b.triggeredAt).localeCompare(a.completedAt || a.triggeredAt))

  let md = `# 分析レポート — ${new Date().toLocaleDateString('ja-JP')}出力\n\n`

  if (completed.length === 0) {
    md += `完了済みの分析がありません。\n`
    return md
  }

  md += `---\n\n`

  completed.forEach((a: Analysis) => {
    const date = a.completedAt || a.triggeredAt
    const dateLabel = date ? new Date(date).toLocaleDateString('ja-JP') : '—'

    if (a.type === 'case_pattern') {
      md += `## 失注パターン分析（${dateLabel}）\n\n`
      if (a.targetCount) md += `**対象案件数：** ${a.targetCount}件\n`
      if (a.topLossType) md += `**最多失注タイプ：** ${a.topLossType}\n`
      if (a.winRate) md += `**受注率：** ${a.winRate}\n`
      if (a.patternSummary) md += `\n**パターン要約：**\n${a.patternSummary}\n`
      if (a.lastActionImprovement) md += `\n**前回指摘の改善状況：** ${a.lastActionImprovement}\n`
      if (a.highValuePattern) md += `\n**学習価値高案件の共通点：**\n${a.highValuePattern}\n`
      if (a.actionItem) md += `\n**今すぐ直すべき1点：** ${a.actionItem}\n`
      if (a.nextFocusPoint) md += `**次回注目ポイント：** ${a.nextFocusPoint}\n`
    } else if (a.type === 'touch_trend') {
      md += `## 文面傾向分析（${dateLabel}）\n\n`
      if (a.targetCount) md += `**対象タッチ数：** ${a.targetCount}件\n`
      if (a.targetValiditySummary) md += `**対象妥当性：** ${a.targetValiditySummary}\n`
      if (a.messageValiditySummary) md += `**文面妥当性：** ${a.messageValiditySummary}\n`
      if (a.editEvalSummary) md += `**編集評価：** ${a.editEvalSummary}\n`
      if (a.topImprovementPattern) md += `\n**最多改善提案パターン：**\n${a.topImprovementPattern}\n`
      if (a.frequentNgPostType) md += `**よく出る投稿種別✕：** ${a.frequentNgPostType}\n`
      if (a.trendComment) md += `\n**傾向コメント：**\n${a.trendComment}\n`
      if (a.actionItem) md += `\n**今すぐ直すべき1点：** ${a.actionItem}\n`
    } else if (a.type === 'emergency_alert') {
      md += `## 対象選び警告（${dateLabel}）\n\n`
      if (a.alertDetail) md += `${a.alertDetail}\n`
    }

    md += `\n---\n\n`
  })

  return md
}

export function analysisReportMdFilename(): string {
  return `analysis_report_${todayFilename()}.md`
}
