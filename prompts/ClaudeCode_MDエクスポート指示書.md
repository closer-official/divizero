# MDエクスポート実装指示書

## 概要

Firestoreに蓄積された全データ（案件・タッチ履歴・文面判定・OS②判定・分析結果）を
Markdownファイルとして書き出す機能を実装する。

外部での振り返り・他ツールへの持ち出し・バックアップとして使う。

---

## エクスポートの種類

### 1. 案件別MD（案件カードから個別出力）

1案件の全タッチ履歴＋判定ログを1ファイルに出力する。
案件カードのメニュー（…ボタン等）から「MDでエクスポート」で実行。

**出力ファイル名：** `{handle}_{YYYYMMDD}.md`
例：`supisama_uranai_20260621.md`

**出力フォーマット：**

```markdown
# {アカウント名}（{@handle}）| {チャネル} | {トラック}

**案件ID：** {caseId}
**接触開始日：** {createdAt}
**事前仮説：** {hypothesis}
**現在ステップ：** {currentStep}
**S1接触数：** {s1Count}回　いいね返り：{likeReturnCount}回　フォロー返し：{followReturned}

---

## タッチ履歴

### タッチ{N} — {date}

**接触した投稿：** {targetPostText}
**投稿種別：** {targetPostType}　**対象妥当性：** {targetValidity}

**AI提案文A：** {suggestedTextA}
　仮判定A：{provisionalJudgmentA}
**AI提案文B：** {suggestedTextB}
　仮判定B：{provisionalJudgmentB}

**実際に送った文章：** {actualSentText}
**変えた理由：** {editReason}

**文面妥当性：** {messageValidity}（{judgedAt}判定）
**判定理由：** {judgmentReason}
**編集評価：** {editEvaluation}　{editComment}
**改善提案：** {improvementSuggestion}
**改善案：** {improvedText}

**相手の反応：** {reactionType}
{reactionNote ? `**反応の補足：** {reactionNote}` : ''}

{os2Judgment ? `
**OS②判定：** {os2Judgment}
**次アクション：** {os2NextAction}
` : ''}

---

{次のタッチ…}

## OS②判定履歴

{os2Judgment が記録されているタッチを時系列で並べる}
| 日付 | 判定 | 次アクション |
|------|------|-------------|
| {date} | {os2Judgment} | {os2NextAction} |

```

---

### 2. 全案件サマリMD（まとめて出力）

全案件の概要を1ファイルにまとめる。
設定画面または集計ダッシュボードから「全案件をMDエクスポート」で実行。

**出力ファイル名：** `cases_summary_{YYYYMMDD}.md`

**出力フォーマット：**

```markdown
# 案件サマリ — {YYYY/MM/DD}出力

総案件数：{total}件（進行中：{active}件 / クローズ済み：{closed}件）

---

## 進行中案件

| アカウント | チャネル | トラック | ステップ | タッチ数 | 最終接触 | いいね返り |
|----------|---------|---------|---------|---------|---------|----------|
| @{handle} | {channel} | {track} | {currentStep} | {s1Count} | {lastTouchedAt} | {likeReturnCount} |

## クローズ済み案件

| アカウント | クローズタイプ | 学習価値 | クローズ日 |
|----------|-------------|---------|----------|
| @{handle} | {closeType} | {learningValue} | {closedAt} |

```

---

### 3. 分析レポートMD（分析結果を出力）

過去の分析結果を1ファイルに出力する。
分析履歴タブから「MDでエクスポート」で実行。

**出力ファイル名：** `analysis_report_{YYYYMMDD}.md`

**出力フォーマット：**

```markdown
# 分析レポート — {YYYY/MM/DD}出力

---

## 失注パターン分析（{date}）

**対象案件数：** {targetCount}件
**最多失注タイプ：** {topLossType}
**受注率：** {winRate}

**パターン要約：**
{patternSummary}

**前回指摘の改善状況：** {lastActionImprovement}

**学習価値高案件の共通点：**
{highValuePattern}

**今すぐ直すべき1点：** {actionItem}

**次回注目ポイント：** {nextFocusPoint}

---

## 文面傾向分析（{date}）

**対象タッチ数：** {targetCount}件
**対象妥当性：** {targetValiditySummary}
**文面妥当性：** {messageValiditySummary}
**編集評価：** {editEvalSummary}

**最多改善提案パターン：**
{topImprovementPattern}

**よく出る投稿種別✕：** {frequentNgPostType}

**傾向コメント：**
{trendComment}

**今すぐ直すべき1点：** {actionItem}

---

{次の分析…}
```

---

## 実装

### エクスポート関数

`src/utils/mdExport.ts` を作成：

```typescript
// 案件別MDを生成
export async function exportCaseMd(db: Firestore, caseId: string): Promise<string> {
  const caseData = await getCase(db, caseId);
  const touches = await getTouches(db, caseId); // 古い順

  let md = `# ${caseData.accountName}（@${caseData.handle}）| ${caseData.channel} | ${caseData.track}\n\n`;
  md += `**案件ID：** ${caseData.id}\n`;
  md += `**接触開始日：** ${formatDate(caseData.createdAt)}\n`;
  md += `**事前仮説：** ${caseData.hypothesis}\n`;
  md += `**現在ステップ：** ${caseData.currentStep}\n`;
  md += `**S1接触数：** ${caseData.s1Count}回　いいね返り：${caseData.likeReturnCount}回　フォロー返し：${caseData.followReturned ? '有' : '無'}\n\n`;
  md += `---\n\n## タッチ履歴\n\n`;

  touches.forEach((touch, i) => {
    md += `### タッチ${i + 1} — ${formatDate(touch.date)}\n\n`;
    md += `**接触した投稿：** ${touch.targetPostText}\n`;
    md += `**投稿種別：** ${touch.targetPostType}　**対象妥当性：** ${touch.targetValidity}\n\n`;
    md += `**AI提案文A：** ${touch.suggestedTextA || '—'}\n`;
    if (touch.provisionalJudgmentA) md += `　仮判定A：${touch.provisionalJudgmentA}\n`;
    md += `**AI提案文B：** ${touch.suggestedTextB || '—'}\n`;
    if (touch.provisionalJudgmentB) md += `　仮判定B：${touch.provisionalJudgmentB}\n`;
    md += `\n**実際に送った文章：** ${touch.actualSentText}\n`;
    md += `**変えた理由：** ${touch.editReason || '（なし）'}\n\n`;
    md += `**文面妥当性：** ${touch.messageValidity}`;
    if (touch.judgedAt) md += `（${formatDate(touch.judgedAt)}判定）`;
    md += `\n`;
    if (touch.judgmentReason) md += `**判定理由：** ${touch.judgmentReason}\n`;
    if (touch.editEvaluation) md += `**編集評価：** ${touch.editEvaluation}　${touch.editComment}\n`;
    if (touch.improvementSuggestion && touch.improvementSuggestion !== 'なし') {
      md += `**改善提案：** ${touch.improvementSuggestion}\n`;
    }
    if (touch.improvedText && touch.improvedText !== 'なし') {
      md += `**改善案：** ${touch.improvedText}\n`;
    }
    md += `\n**相手の反応：** ${touch.reactionType}\n`;
    if (touch.reactionNote) md += `**反応の補足：** ${touch.reactionNote}\n`;
    if (touch.os2Judgment) {
      md += `\n**OS②判定：** ${touch.os2Judgment}\n`;
      md += `**次アクション：** ${touch.os2NextAction}\n`;
    }
    md += `\n---\n\n`;
  });

  return md;
}

// ファイルダウンロードのトリガー
export function downloadMd(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### UIへの配置

**案件別エクスポート：**
案件カードの右上メニュー（…ボタン）に「📄 MDでエクスポート」を追加。
タップすると `exportCaseMd` を実行してダウンロード。

**全案件サマリ：**
集計ダッシュボードまたは案件管理タブのヘッダーに「📄 全案件をエクスポート」ボタンを追加。

**分析レポート：**
分析履歴タブのヘッダーに「📄 分析レポートをエクスポート」ボタンを追加。

---

## Touchデータモデルへの追記

```typescript
interface Touch {
  // ...既存フィールド
  improvedText?: string;  // 改善案（文面再判定OSの新フィールド）
}
```

`parseJudgmentOutput` に `improvedText` の抽出を追加：

```typescript
return {
  // ...既存フィールド
  improvementSuggestion: pick('改善提案'),
  improvedText: pick('改善案'),  // 追加
};
```

---

## 実装順

1. Touchデータモデルに `improvedText` を追加
2. `parseJudgmentOutput` に `improvedText` の抽出を追加
3. 判定結果表示UIに「改善案」欄を追加（判定理由・改善提案の下）
4. `src/utils/mdExport.ts` を作成（案件別・全案件・分析レポートの3関数）
5. 案件カードに「MDでエクスポート」メニューを追加
6. 全案件・分析レポートのエクスポートボタンを追加
