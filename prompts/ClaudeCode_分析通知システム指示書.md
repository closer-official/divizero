# 分析通知システム実装指示書

## 概要

データが一定量溜まったらアプリがお知らせを出し、ボタン一発で分析プロンプトを生成→外部AIに貼る→結果を貼り返す、という分析PDCAフローを実装する。運用者が「分析してください」を能動的にやる必要がなくなる。

---

## Firestoreのデータ構造追加

### 分析記録コレクション

```typescript
// コレクション: analyses/{analysisId}
interface Analysis {
  id: string;
  type: 'case_pattern' | 'touch_trend' | 'emergency_alert';
  triggeredAt: Timestamp;
  status: 'pending' | 'prompted' | 'completed';
  promptedAt?: Timestamp;
  completedAt?: Timestamp;
  targetCount: number;        // 今回分析した件数

  // case_pattern の結果フィールド
  topLossType?: string;
  winRate?: string;
  patternSummary?: string;
  lastActionImprovement?: string;
  highValuePattern?: string;
  actionItem?: string;        // 今すぐ直すべき1点（次回通知に引き継ぐ）
  nextFocusPoint?: string;

  // touch_trend の結果フィールド
  targetValiditySummary?: string;
  messageValiditySummary?: string;
  editEvalSummary?: string;
  topImprovementPattern?: string;
  frequentNgPostType?: string;
  trendComment?: string;
  // actionItem と nextFocusPoint は共通

  // emergency_alert の結果フィールド
  alertDetail?: string;       // 直近10タッチで✕が何件あったか等

  rawOutput?: string;         // AIのフル出力（詳細確認用）
}
```

---

## 通知のトリガーロジック

### 3種類の通知

```typescript
type NotificationType = 'case_pattern' | 'touch_trend' | 'emergency_alert';

interface NotificationConfig {
  case_pattern: {
    threshold: 5;          // 前回分析から5件クローズしたら発火
    severity: 'info';
    label: '失注パターン分析';
    message: '失注案件が5件増えました。傾向をチェックしてみましょう。';
    icon: '📊';
  };
  touch_trend: {
    threshold: 20;         // 前回分析から判定済みタッチが20件増えたら発火
    severity: 'info';
    label: '文面傾向分析';
    message: '文面判定が20件溜まりました。傾向をチェックしてみましょう。';
    icon: '📝';
  };
  emergency_alert: {
    threshold: 3;          // 直近10タッチで対象妥当性✕が3件以上
    severity: 'critical';
    label: '対象選びに注意';
    message: '直近10タッチで対象✕が{count}件。Rinパターンの兆候があります。';
    icon: '🔴';
  };
}
```

### トリガー判定関数

```typescript
// src/utils/analysisNotification.ts

export async function checkNotificationTriggers(db: Firestore): Promise<void> {
  // 1. case_pattern：前回分析以降のクローズ件数を確認
  const lastCaseAnalysis = await getLastAnalysis(db, 'case_pattern');
  const newClosedCount = await countClosedCasesSince(db, lastCaseAnalysis?.triggeredAt);
  if (newClosedCount >= 5) {
    await createNotification(db, 'case_pattern', newClosedCount);
  }

  // 2. touch_trend：前回分析以降の判定済みタッチ件数を確認
  const lastTouchAnalysis = await getLastAnalysis(db, 'touch_trend');
  const newJudgedCount = await countJudgedTouchesSince(db, lastTouchAnalysis?.triggeredAt);
  if (newJudgedCount >= 20) {
    await createNotification(db, 'touch_trend', newJudgedCount);
  }

  // 3. emergency_alert：直近10タッチの対象妥当性✕件数を確認
  const recentNgCount = await countRecentTargetNg(db, 10);
  if (recentNgCount >= 3) {
    // 既に未処理の emergency_alert があれば重複作成しない
    const existingAlert = await getPendingNotification(db, 'emergency_alert');
    if (!existingAlert) {
      await createNotification(db, 'emergency_alert', recentNgCount);
    }
  }
}

// タッチを記録したとき・案件をクローズしたときに呼び出す
// （Touch保存後・Case status更新後のフックに追加）
```

### いつトリガーチェックを実行するか

以下のタイミングで `checkNotificationTriggers` を呼び出す：
- タッチの「送信完了として記録」ボタン押下後
- 案件のクローズ操作後
- アプリ起動時（ログイン後）

---

## 通知UI

### 表示場所

案件管理タブ（OS②パイプライン）の最上部に通知エリアを設ける。
未処理の通知がある場合のみ表示する（通知がなければ非表示）。

### 通知カードのデザイン

```
┌──────────────────────────────────┐
│ 📊 失注パターン分析               │  ← info = 紫ベース
│ 失注案件が5件増えました。         │
│ 傾向をチェックしてみましょう。    │
│                                  │
│         [あとで] [分析する →]    │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ 🔴 対象選びに注意                 │  ← critical = 赤ベース
│ 直近10タッチで対象✕が3件。       │
│ Rinパターンの兆候があります。     │
│                                  │
│                    [確認する →]  │  ← あとでボタンなし（緊急）
└──────────────────────────────────┘
```

複数通知が同時にある場合は縦に積む。emergency_alertを最上部に固定する。

「あとで」を押すと通知が一時的に折りたたまれる（dismissedではない・翌日また出る）。

---

## 分析フロー（「分析する→」を押したあと）

### プロンプト生成

「分析する →」を押すと、分析モーダルを開く：

```
┌──────────────────────────────────┐
│ 📊 失注パターン分析               │
│                                  │
│ 対象：前回分析（XX/XX）〜今日     │
│ 案件数：5件                       │
│                                  │
│ ① [📋 プロンプトをコピー]        │
│   ↓ ChatGPT等に貼り付けて実行    │
│                                  │
│ ② AI出力を貼り付け               │
│ ┌──────────────────────────────┐ │
│ │ ===CASE_ANALYSIS_START=== か  │ │
│ │ ら貼り付けてください          │ │
│ └──────────────────────────────┘ │
│                                  │
│ [⚡ 結果を取り込む]               │
│                                  │
│                       [キャンセル]│
└──────────────────────────────────┘
```

### case_patternのプロンプト生成関数

```typescript
// src/utils/analysisPrompt.ts

export async function buildCaseAnalysisPrompt(db: Firestore): Promise<string> {
  const template = await fetch('/prompts/OS_失注パターン分析_latest.md').then(r => r.text());

  // 前回分析日を取得
  const lastAnalysis = await getLastAnalysis(db, 'case_pattern');
  const since = lastAnalysis?.triggeredAt ?? null;

  // 対象案件を取得（クローズ済み・前回分析以降）
  const cases = await getClosedCasesSince(db, since);

  // 累計統計
  const allCases = await getAllClosedCases(db);
  const wonCount = allCases.filter(c => c.result === '受注').length;
  const lostCount = allCases.filter(c => c.result !== '受注').length;

  // 案件リストを整形
  const caseList = cases.map(c =>
    `${c.id}／${c.closeType}／学習価値${c.learningValue ?? '-'}／${c.lossReason}／${c.maxLearning}／${c.channel}／${c.track}`
  ).join('\n');

  const replacements: Record<string, string> = {
    caseList: caseList || '（対象案件なし）',
    totalClosed: String(allCases.length),
    wonCount: String(wonCount),
    lostCount: String(lostCount),
    unreachedCount: String(allCases.filter(c => c.result === '未到達クローズ').length),
    lastAnalysisDate: since ? formatDate(since) : '（初回分析）',
    newCasesCount: String(cases.length),
    lastActionItem: lastAnalysis?.actionItem ?? '（前回分析なし）',
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => replacements[key] ?? '');
}
```

### touch_trendのプロンプト生成関数

```typescript
export async function buildTouchAnalysisPrompt(db: Firestore): Promise<string> {
  const template = await fetch('/prompts/OS_文面傾向分析_latest.md').then(r => r.text());

  const lastAnalysis = await getLastAnalysis(db, 'touch_trend');
  const since = lastAnalysis?.triggeredAt ?? null;
  const touches = await getJudgedTouchesSince(db, since);

  // 集計
  const targetOk = touches.filter(t => t.targetValidity === '◯').length;
  const targetDelta = touches.filter(t => t.targetValidity === '△').length;
  const targetNg = touches.filter(t => t.targetValidity === '✕').length;
  const messageOk = touches.filter(t => t.messageValidity === '◯').length;
  const messageDelta = touches.filter(t => t.messageValidity === '△').length;
  const messageNg = touches.filter(t => t.messageValidity === '✕').length;
  const editOk = touches.filter(t => t.editEvaluation === '適切').length;
  const editBad = touches.filter(t => t.editEvaluation === '悪化').length;
  const editNone = touches.filter(t => t.editEvaluation === '変更なし').length;

  // タッチリストを整形
  const touchList = touches.map(t =>
    `${formatDate(t.date)}／${t.channel}／${t.targetPostType}／対象${t.targetValidity}／文面${t.messageValidity}／編集${t.editEvaluation}／${t.judgmentReason}／${t.improvementSuggestion}`
  ).join('\n');

  const replacements: Record<string, string> = {
    touchList: touchList || '（対象タッチなし）',
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
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => replacements[key] ?? '');
}
```

---

## 出力パースと結果保存

### case_patternパーサー

```typescript
export function parseCaseAnalysis(raw: string): Partial<Analysis> | null {
  const block = raw.match(/===CASE_ANALYSIS_START===([\s\S]*?)===CASE_ANALYSIS_END===/)?.[1];
  if (!block) return null;

  const pick = (label: string) =>
    block.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`))?.[1]?.trim() ?? '';

  return {
    topLossType: pick('最多失注タイプ'),
    winRate: pick('受注率'),
    patternSummary: pick('パターン要約'),
    lastActionImprovement: pick('前回指摘の改善状況'),
    highValuePattern: pick('学習価値高案件の共通点'),
    actionItem: pick('今すぐ直すべき1点'),
    nextFocusPoint: pick('次回注目ポイント'),
    rawOutput: raw,
    status: 'completed',
    completedAt: serverTimestamp() as Timestamp,
  };
}
```

### touch_trendパーサー

```typescript
export function parseTouchAnalysis(raw: string): Partial<Analysis> | null {
  const block = raw.match(/===TOUCH_ANALYSIS_START===([\s\S]*?)===TOUCH_ANALYSIS_END===/)?.[1];
  if (!block) return null;

  const pick = (label: string) =>
    block.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`))?.[1]?.trim() ?? '';

  return {
    targetValiditySummary: pick('対象妥当性サマリ'),
    messageValiditySummary: pick('文面妥当性サマリ'),
    editEvalSummary: pick('編集評価サマリ'),
    topImprovementPattern: pick('最多改善提案パターン'),
    frequentNgPostType: pick('よく出る投稿種別✕'),
    lastActionImprovement: pick('前回指摘の改善状況'),
    trendComment: pick('傾向コメント'),
    actionItem: pick('今すぐ直すべき1点'),
    nextFocusPoint: pick('次回注目ポイント'),
    rawOutput: raw,
    status: 'completed',
    completedAt: serverTimestamp() as Timestamp,
  };
}
```

### 「⚡ 結果を取り込む」ボタンの処理

```typescript
async function handleAnalysisImport(raw: string, analysisId: string, type: NotificationType) {
  const parsed = type === 'case_pattern'
    ? parseCaseAnalysis(raw)
    : parseTouchAnalysis(raw);

  if (!parsed) {
    showError('AI出力の形式が認識できませんでした。===CASE_ANALYSIS_START=== から最後まで含めて貼り付けてください。');
    return;
  }

  // Firestoreに保存
  await updateDoc(doc(db, 'analyses', analysisId), parsed);

  // 通知を既読にする
  await dismissNotification(db, analysisId);

  // モーダルを閉じて完了トースト
  showSuccess('分析結果を保存しました。');
}
```

---

## 分析履歴タブ（新タブとして追加）

タブ構成に「📊 分析履歴」を追加する（既存タブの右端）。

表示内容：
- 過去の分析一覧（日付・種別・今すぐ直すべき1点）
- 各分析をタップすると詳細（rawOutput含む全フィールド）をアコーディオン展開
- 「今すぐ直すべき1点」の時系列変化が一番上に並ぶ（PDCAの軌跡が見える）

---

## プロンプトファイルの配置

以下2ファイルを `/public/prompts/` に追加：
- `OS_失注パターン分析_latest.md`
- `OS_文面傾向分析_latest.md`

---

## 実装順

1. Firestoreの `analyses` コレクション設計・型定義
2. `src/utils/analysisNotification.ts`（トリガー判定）
3. `src/utils/analysisPrompt.ts`（プロンプト生成・パース）
4. 通知カードUI（案件管理タブ最上部）
5. 分析モーダル（プロンプトコピー＋出力貼り付け＋取り込み）
6. トリガーチェックの呼び出しフック（タッチ記録後・クローズ後・アプリ起動時）
7. 分析履歴タブ
8. プロンプトファイルの配置

---

## 注意事項

- emergency_alertは分析プロンプトを生成しない（データを見るだけ）。「確認する→」を押すと直近10タッチの対象妥当性一覧を表示し、確認ボタンで既読にする
- 同じ種別の通知は1件だけ存在できる（重複作成しない）
- 「あとで」は一時折りたたみ（24時間後に再表示）。完全既読はanalysis完了時のみ
- 分析完了後の「今すぐ直すべき1点」は次回分析プロンプトに自動引き継ぎ（`lastActionItem`として埋め込まれる）。これがPDCAの軸になる
