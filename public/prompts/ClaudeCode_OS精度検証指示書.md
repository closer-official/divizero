# OS精度検証フィードバックループ 実装指示書

## 目的

現在の分析システムは「OSの判定結果を記録・分析する」仕組みは整っているが、
**「OS判定と相手の実反応を突き合わせてOSの予測精度を評価する」フィードバックループが存在しない。**

この指示書では以下を実装する：
- Touch に蓄積されている `reactionType` / `repExchangeCount` を分析に活用する
- 「OS判定◯→無反応」「OS判定✕→テキスト返信」などの乖離を検出・集計する
- 乖離が一定件数を超えたら「OS精度アラート」を発火する
- 文面傾向分析のプロンプト（OS_文面傾向分析_latest.md）に実反応データを追加する

**この仕組みの目的は「OSルール自体が正しいかを疑うフェーズ」を自動で誘導することである。**

---

## 対象ファイル（必ず事前に読むこと）

実装前に以下のファイルをすべて読んでから変更に入ること。

```
src/utils/analysisNotification.ts   ← 通知トリガーロジック
src/utils/analysisPrompt.ts         ← プロンプト生成・パース
public/prompts/OS_文面傾向分析_latest.md  ← 分析プロンプト本体
src/types/                          ← Touch・Analysis の型定義
```

---

## Step 1：データモデルの確認と型追加

### 1-1. Touchの既存フィールドを確認する

Touchモデルにすでにあるはずのフィールドを確認する：

```typescript
reactionType:      string   // 例：'テキスト返信'|'いいね返り'|'フォロー返し'|'無反応'|'ブロック/スルー'
reactionJudgment:  string   // S1行動判定の結果
repExchangeCount:  number   // リプが何往復に発展したか
```

これらが型定義に存在するか確認する。なければ追加する。

### 1-2. Analysisモデルへのフィールド追加

`analyses` コレクションの `Analysis` 型に以下を追加する：

```typescript
// touch_trend の精度検証フィールド（新規追加）
falsePositiveCount?: number;   // 文面◯ → 無反応 の件数
falseNegativeCount?: number;   // 文面✕ → テキスト返信 の件数
falsePositiveRate?: string;    // 偽陽性率（例："3件（15%）"）
falseNegativeRate?: string;    // 偽陰性率（例："2件（10%）"）
osAccuracyVerdict?: string;    // 'OSを疑うべき' | 'まだ様子見'
```

### 1-3. 通知タイプの追加

```typescript
type NotificationType = 'case_pattern' | 'touch_trend' | 'emergency_alert' | 'os_accuracy_alert';
//                                                                              ↑ 新規追加
```

---

## Step 2：OS精度アラートのトリガー追加

### 対象ファイル：`src/utils/analysisNotification.ts`

既存の `checkNotificationTriggers` 関数に以下を追加する。

```typescript
// 4. os_accuracy_alert：偽陽性または偽陰性が累計5件を超えたら発火
const lastOsAccuracyAnalysis = await getLastAnalysis(db, 'os_accuracy_alert');
const since = lastOsAccuracyAnalysis?.triggeredAt ?? null;
const recentTouches = await getJudgedTouchesSince(db, since);

// 偽陽性：文面◯ かつ 無反応
const falsePositives = recentTouches.filter(t =>
  t.messageValidity === '◯' && t.reactionType === '無反応'
);
// 偽陰性：文面✕ かつ テキスト返信あり
const falseNegatives = recentTouches.filter(t =>
  t.messageValidity === '✕' && t.reactionType === 'テキスト返信'
);

const totalDiscrepancy = falsePositives.length + falseNegatives.length;

if (totalDiscrepancy >= 5) {
  const existingAlert = await getPendingNotification(db, 'os_accuracy_alert');
  if (!existingAlert) {
    await createNotification(db, 'os_accuracy_alert', totalDiscrepancy);
  }
}
```

### 通知設定への追加

```typescript
os_accuracy_alert: {
  threshold: 5;
  severity: 'warning';
  label: 'OS精度を確認してください';
  message: 'OS判定と実反応の乖離が{count}件検出されました。OSルールの見直しを検討してください。';
  icon: '⚠️';
}
```

---

## Step 3：プロンプト生成関数への実反応データ追加

### 対象ファイル：`src/utils/analysisPrompt.ts`

`buildTouchAnalysisPrompt` 関数を以下のように修正する。

#### 追加する集計ロジック

```typescript
// 実反応との乖離集計（新規追加）
const withReaction = touches.filter(t => t.reactionType && t.reactionType !== '');

const falsePositives = withReaction.filter(t =>
  t.messageValidity === '◯' && t.reactionType === '無反応'
);
const falseNegatives = withReaction.filter(t =>
  t.messageValidity === '✕' && t.reactionType === 'テキスト返信'
);
const truePositives = withReaction.filter(t =>
  t.messageValidity === '◯' && t.reactionType === 'テキスト返信'
);

const reactionDataCount = withReaction.length;
const fpRate = reactionDataCount > 0
  ? `${falsePositives.length}件（${Math.round(falsePositives.length / reactionDataCount * 100)}%）`
  : '（反応データなし）';
const fnRate = reactionDataCount > 0
  ? `${falseNegatives.length}件（${Math.round(falseNegatives.length / reactionDataCount * 100)}%）`
  : '（反応データなし）';

// 反応データ付きタッチリスト（実反応カラム追加）
const touchListWithReaction = touches.map(t =>
  `${formatDate(t.date)}／${t.channel}／${t.targetPostType}／対象${t.targetValidity}／文面${t.messageValidity}／実反応:${t.reactionType ?? '未記録'}／往復:${t.repExchangeCount ?? '-'}回／編集${t.editEvaluation}／${t.judgmentReason}／${t.improvementSuggestion}`
).join('\n');
```

#### replacements への追加

```typescript
const replacements: Record<string, string> = {
  // 既存フィールド（変更なし）
  touchList: touchListWithReaction,   // ← 実反応カラム追加済みのリストに差し替え
  totalTouches: String(touches.length),
  targetOk: String(targetOk),
  targetDelta: String(targetDelta),
  targetNg: String(targetNg),
  messageOk: String(messageOk),
  messageDelta: String(messageDelta),
  messageNg: String(messageNg),
  editOk: String(editOk),
  editBad: String(editBad),
  editNone: String(editNone),
  lastAnalysisDate: since ? formatDate(since) : '（初回分析）',
  newTouchesCount: String(touches.length),
  lastActionItem: lastAnalysis?.actionItem ?? '（前回分析なし）',

  // 新規追加：OS精度検証データ
  reactionDataCount: String(reactionDataCount),
  falsePositiveRate: fpRate,
  falseNegativeRate: fnRate,
  truePositiveCount: String(truePositives.length),
  osAccuracySuspicion: (falsePositives.length + falseNegatives.length) >= 5
    ? 'OSを疑うべき'
    : 'まだ様子見',
};
```

---

## Step 4：OS_文面傾向分析_latest.md の改修

### 対象ファイル：`public/prompts/OS_文面傾向分析_latest.md`

以下の変更を加える。

#### 4-1. タッチリストのカラム説明を更新

```
（各行＝日付／チャネル／投稿種別／対象妥当性／文面妥当性／実反応／往復回数／編集評価／判定理由／改善提案）
```

#### 4-2. 集計サマリへのOS精度データ追加

既存の集計サマリブロックの末尾に追加する：

```
■ OS精度検証データ（実反応との照合）
実反応記録あり：{{reactionDataCount}}件
偽陽性疑い（文面◯→無反応）：{{falsePositiveRate}}
偽陰性疑い（文面✕→テキスト返信）：{{falseNegativeRate}}
真陽性（文面◯→テキスト返信）：{{truePositiveCount}}件
OS精度判定：{{osAccuracySuspicion}}
```

#### 4-3. 分析の観点に「⑤ OS精度検証」を追加

既存の①〜④の後に追加する：

```
⑤ OS精度の検証（OSルール自体を疑うフェーズ）
偽陽性疑い・偽陰性疑いの件数と割合を確認する。
「文面◯→無反応」が多い場合、◯基準が甘い・または対象選定に問題がある可能性。
「文面✕→テキスト返信」が多い場合、✕基準が厳しすぎる・または別の変数が効いている可能性。
OS精度判定が「OSを疑うべき」の場合は、以下のOSを名指しで疑義対象として挙げること：
  - OS0_一次選別（対象ゲート基準の妥当性）
  - OS1_Instagram_接触スクリーニング（Instagram文面の禁止語・アンカー基準）
  - OS1_X_接触スクリーニング（X文面の禁止語・アンカー基準）
  - OS1_Threads_接触スクリーニング（Threads文面の禁止語・アンカー基準）
  - OS_文面再判定（再判定の判定基準）
  - OS_継続接触_タッチ生成（継続タッチの文面生成ルール）
どのOSのどのルールが「実反応と乖離している可能性が高いか」を具体的に指摘する。
反証データが少ない（実反応記録が5件未満）場合は「データ不足・判断留保」と明記する。
```

#### 4-4. 出力フォーマットに追加フィールドを追加

`===TOUCH_ANALYSIS_START===` 〜 `===TOUCH_ANALYSIS_END===` の中に以下を追加する（`今すぐ直すべき1点` の直前に挿入）：

```
偽陽性疑い件数: （文面◯→無反応 XX件）
偽陰性疑い件数: （文面✕→テキスト返信 XX件）
OS精度判定: （OSを疑うべき／まだ様子見）
疑義対象OS: （OS精度判定が「OSを疑うべき」の場合、該当するOSファイル名を列挙。「まだ様子見」の場合は「なし」）
OS見直し根拠: （疑義対象OSのどのルールが問題の可能性があるか。「なし」の場合は省略可）
```

---

## Step 5：touch_trendパーサーの更新

### 対象ファイル：`src/utils/analysisPrompt.ts`

`parseTouchAnalysis` 関数に以下のフィールドを追加する：

```typescript
export function parseTouchAnalysis(raw: string): Partial<Analysis> | null {
  const block = raw.match(/===TOUCH_ANALYSIS_START===([\s\S]*?)===TOUCH_ANALYSIS_END===/)?.[1];
  if (!block) return null;

  const pick = (label: string) =>
    block.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`))?.[1]?.trim() ?? '';

  return {
    // 既存フィールド（変更なし）
    targetValiditySummary: pick('対象妥当性サマリ'),
    messageValiditySummary: pick('文面妥当性サマリ'),
    editEvalSummary: pick('編集評価サマリ'),
    topImprovementPattern: pick('最多改善提案パターン'),
    frequentNgPostType: pick('よく出る投稿種別✕'),
    lastActionImprovement: pick('前回指摘の改善状況'),
    trendComment: pick('傾向コメント'),
    actionItem: pick('今すぐ直すべき1点'),
    nextFocusPoint: pick('次回注目ポイント'),

    // 新規追加：OS精度検証フィールド
    falsePositiveRate: pick('偽陽性疑い件数'),
    falseNegativeRate: pick('偽陰性疑い件数'),
    osAccuracyVerdict: pick('OS精度判定'),

    rawOutput: raw,
    status: 'completed',
    completedAt: serverTimestamp() as Timestamp,
  };
}
```

---

## Step 6：os_accuracy_alert の通知UIと「確認する→」の処理

### 通知カードのデザイン

```
┌──────────────────────────────────┐
│ ⚠️ OS精度を確認してください       │  ← warning = 黄ベース
│ OS判定と実反応の乖離が5件         │
│ 検出されました。                  │
│ OSルールの見直しを検討してください。│
│                                  │
│                    [確認する →]  │  ← あとでボタンなし
└──────────────────────────────────┘
```

### 「確認する→」を押したときの表示

次の文面傾向分析（touch_trend）のプロンプトコピーモーダルを開く。

モーダル内に以下を表示する：

```
⚠️ OS精度アラートが発生しています。
このプロンプトを分析AIに貼り付け、「疑義対象OS」欄に注目してください。
出力されたOSファイル名をもとに、該当OSのMDファイルを提示してルール見直しの意見を求めてください。
```

---

## Step 7：トリガーチェックの呼び出しタイミング追加

### 対象ファイル：タッチ記録後のフック

既存のトリガーチェック呼び出し箇所（タッチ記録後）に変更は不要。
`checkNotificationTriggers` 内に os_accuracy_alert のチェックを追加したため、
既存の呼び出しタイミング（タッチ記録後・アプリ起動時）で自動的に判定される。

---

## 実装順

1. `src/types/` → `Analysis` 型に新フィールド追加、`NotificationType` に `os_accuracy_alert` 追加
2. `src/utils/analysisNotification.ts` → `os_accuracy_alert` トリガーと通知設定を追加
3. `src/utils/analysisPrompt.ts` → `buildTouchAnalysisPrompt` の集計ロジックと replacements を更新
4. `src/utils/analysisPrompt.ts` → `parseTouchAnalysis` に新フィールドを追加
5. `public/prompts/OS_文面傾向分析_latest.md` → カラム説明・集計サマリ・分析観点⑤・出力フォーマットを更新
6. 通知カードUI → `os_accuracy_alert` のカード表示と「確認する→」の処理を追加

---

## 注意事項

- `reactionType` が未記録（空・null）のタッチは精度計算から除外する。実反応を記録していない段階では「データ不足・判断留保」となる
- 偽陽性/偽陰性の判定は「文面妥当性」のみを対象とする。対象妥当性✕のタッチは精度計算に含めない（そもそも送るべきでないため）
- `os_accuracy_alert` は `touch_trend` 分析完了時に自動既読にする（同じデータを二重分析しないよう）
- 疑義対象OSの名指しはAI出力側（OS_文面傾向分析_latest.md）が行う。アプリ側はOSファイル名を固定リストで持たない
