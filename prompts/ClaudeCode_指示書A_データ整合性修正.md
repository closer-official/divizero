# 指示書A｜データ整合性修正（Tier 1・最優先）

## 対象バグ
1. OS③のAI出力がパースされずrawOutputのみ保存 → Tab4集計が常に空
2. OS①接触文パーサーが1行しか取得できない → 接触文が毎回切れる
3. OS⓪リストで同一アカウントが重複登録される

---

## 必須前提（実装前に必ず守ること）

1. **既存コードを全部読んでから書く**
   - 最初に `types.ts` `parser.ts` `Tab1.tsx` `Tab3.tsx` `Tab4.tsx` を読む
   - CLAUDE.md があれば最初に確認する

2. **変更するファイル**（これ以外は触らない）
   - `src/types.ts`
   - `src/utils/parser.ts`
   - `src/components/Tab1.tsx`（または OS⓪リストのhandleSubmitがあるファイル）
   - `src/components/Tab3.tsx`（または OS③入力のhandleSubmitがあるファイル）

3. **変更しないファイル**
   - `Tab2.tsx` `Tab4.tsx` `Tab5.tsx`（Tab4はc.closeType等を既に参照しているため、型が合えば自動で動く）
   - `firebase.ts` `App.tsx`

4. **実装順序を守る**
   ```
   Step 1: types.ts の型定義変更（コンパイルエラーを先に潰す）
   Step 2: parser.ts の修正・追加
   Step 3: Tab3.tsx の修正（OS③パーサー呼び出し）
   Step 4: Tab1.tsx の修正（重複チェック）
   ```
   この順番を崩さないこと。UIから先に書くとコンパイルエラーが連鎖する。

---

## Step 1｜types.ts の変更

### 1-1. OS③パース結果の型を追加

```typescript
// types.ts に追加
export interface CaseOS3Result {
  closeType:        string;   // 例: "TypeC営業警戒" / "W-A顕在課題直行"
  closeTypeReason:  string;   // 分類理由
  hypothesisResult: '的中' | '部分的中' | '外れ' | '検証不能' | '';
  hypothesisNote:   string;   // 解説
  timingVerdict:    'YES' | 'NO' | '';
  timingNote:       string;
  bestTiming:       '前' | '同じ' | '後' | '';
  reapproachScore:  'S' | 'A' | 'B' | 'C' | 'D' | '';
  reapproachWait:   string;
  reapproachHow:    string;
  reapproachNever:  string;
  closeSummary:     string;   // 失注/受注理由（1文）
  maxLearning:      string;   // 最大の学び（1文）
  nextTypeAction:   string;   // 次回同タイプへの最適行動
  learningValue:    number;   // 0〜100（パース失敗時は -1）
  os3RawOutput:     string;
  os3ProcessedAt:   string;   // ISO文字列
}
```

### 1-2. Case 型に OS③フィールドを追加

```typescript
// 既存の Case インターフェースに以下を追加
export interface Case {
  // ... 既存フィールド ...

  // ─── OS③ 解析結果（新規追加）───
  closeType?:        string;
  closeTypeReason?:  string;
  hypothesisResult?: string;
  hypothesisNote?:   string;
  timingVerdict?:    string;
  bestTiming?:       string;
  reapproachScore?:  string;
  reapproachWait?:   string;
  reapproachHow?:    string;
  reapproachNever?:  string;
  closeSummary?:     string;
  maxLearning?:      string;
  nextTypeAction?:   string;
  learningValue?:    number;
  os3RawOutput?:     string;
  os3ProcessedAt?:   string;
}
```

---

## Step 2｜parser.ts の変更

### 2-1. OS③パーサーを新規追加

OS③の出力はセクション見出し `【〇〇】` で区切られている。
`===マーカー===` 形式ではないため、セクション間の範囲抽出で処理する。

```typescript
// parser.ts に追加
export function parseOS3Output(raw: string): CaseOS3Result {
  // ─── セクション内の任意行を取得するユーティリティ ───
  const pickSection = (sectionName: string): string => {
    const pattern = new RegExp(
      `【${sectionName}】([\\s\\S]*?)(?=\\n【|$)`
    );
    return raw.match(pattern)?.[1]?.trim() ?? '';
  };

  const pickLabel = (label: string): string => {
    const pattern = new RegExp(`${label}[：:]\\s*([^\\n]+)`);
    return raw.match(pattern)?.[1]?.trim() ?? '';
  };

  // ─── 【クローズタイプ】 ───
  const closeTypeSection = pickSection('クローズタイプ');
  // 最初の非空行がクローズタイプ値（例: "TypeC営業警戒" / "W-A顕在課題直行"）
  const closeType = closeTypeSection
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0 && !l.startsWith('（') && !l.startsWith('分類')) ?? '';
  const closeTypeReason = pickLabel('分類理由');

  // ─── 【事前仮説の答え合わせ】 ───
  const hypothesisSection = pickSection('事前仮説の答え合わせ');
  const hypothesisResultRaw = hypothesisSection
    .split('\n')
    .map(l => l.trim())
    .find(l => ['的中', '部分的中', '外れ', '検証不能'].includes(l)) ?? '';
  const hypothesisResult = hypothesisResultRaw as CaseOS3Result['hypothesisResult'];
  const hypothesisNote = pickLabel('解説');

  // ─── 【タイミング検証】 ───
  const timingRaw = pickLabel('もっと早く動いていたら結果は変わったか');
  const timingVerdict: CaseOS3Result['timingVerdict'] =
    timingRaw.startsWith('YES') ? 'YES' :
    timingRaw.startsWith('NO')  ? 'NO'  : '';
  const timingNote = timingRaw.replace(/^(YES|NO)\s*[＋+]?\s*/, '').trim();
  const bestTimingRaw = pickLabel('ベストタイミングは');
  const bestTiming: CaseOS3Result['bestTiming'] =
    bestTimingRaw.startsWith('前') ? '前' :
    bestTimingRaw.startsWith('後') ? '後' :
    bestTimingRaw.startsWith('同') ? '同じ' : '';

  // ─── 【再アプローチ判定】 ───
  const reapproachRaw = pickLabel('可能性');
  const reapproachScore: CaseOS3Result['reapproachScore'] =
    (['S', 'A', 'B', 'C', 'D'] as const).find(s => reapproachRaw.startsWith(s)) ?? '';
  const reapproachWait   = pickLabel('推奨待機期間');
  const reapproachHow    = pickLabel('再接触の入り方');
  const reapproachNever  = pickLabel('絶対やってはいけないこと');

  // ─── 【個別結論】 ───
  const closeSummary   = pickLabel('失注\\/受注理由');
  const maxLearning    = pickLabel('最大の学び');
  const nextTypeAction = pickLabel('次回同タイプへの最適行動');
  const learningValueRaw = pickLabel('学習価値');
  const learningValue = parseInt(learningValueRaw.replace(/[^0-9]/g, ''), 10);

  return {
    closeType,
    closeTypeReason,
    hypothesisResult,
    hypothesisNote,
    timingVerdict,
    timingNote,
    bestTiming,
    reapproachScore,
    reapproachWait,
    reapproachHow,
    reapproachNever,
    closeSummary,
    maxLearning,
    nextTypeAction,
    learningValue: isNaN(learningValue) ? -1 : learningValue,
    os3RawOutput:    raw,
    os3ProcessedAt:  new Date().toISOString(),
  };
}
```

### 2-2. OS①接触文パーサーの正規表現修正

**問題：** `[^\n]+` は最初の改行で止まる。接触文が2行以上になると2行目以降が切れる。

**対象関数：** `parseOS1` / `parseOS1Instagram` / `parseOS1Threads`
（parser.ts:34-38 付近の `案A` / `案B` 取得箇所）

**修正方針：** 次のラベル行が来るまでを複数行で取得する。

```typescript
// ─── 修正前（各parse関数の該当箇所）───
// 例: /案A（実行案）[：:]\s*([^\n]+)/
// 例: /提案文A[：:]\s*([^\n]+)/

// ─── 修正後（共通パターン）───
// 「次のラベル行（行頭に日本語ラベル:または===）が来るまで」を複数行取得し、末尾の空白を除去

// ① 継続接触OS（===TOUCH_START=== 形式）の提案文A/B
const TOUCH_A_PATTERN = /提案文A[：:]\s*([\s\S]+?)(?=\n仮判定A|\n提案文B|\n===|$)/;
const TOUCH_B_PATTERN = /提案文B[：:]\s*([\s\S]+?)(?=\n仮判定B|\n次の狙い|\n===|$)/;

// ② OS①（IG/X/Threads）の案A/B（▼投稿コメント案セクション）
const COMMENT_A_PATTERN = /案A[（(]実行案[）)][：:]\s*([\s\S]+?)(?=\n案B|\n▼|\n【|$)/;
const COMMENT_B_PATTERN = /案B[（(]予備案[）)][：:]\s*([\s\S]+?)(?=\n▼|\n【|\n案A|$)/;

// ③ ストーリー返信案（OS①IG版）
const STORY_A_PATTERN = /案A[：:]\s*([\s\S]+?)(?=\n案B|\n【|\n次に|$)/;
const STORY_B_PATTERN = /案B[：:]\s*([\s\S]+?)(?=\n【|\n次に|$)/;
```

**各parse関数での置き換え方：**

```typescript
// 修正前
const suggestionA = raw.match(/案A（実行案）[：:]\s*([^\n]+)/)?.[1]?.trim() ?? '';

// 修正後
const suggestionA = raw
  .match(/案A[（(]実行案[）)][：:]\s*([\s\S]+?)(?=\n案B|\n▼|\n【|$)/)?.[1]
  ?.trim()
  .replace(/\n+$/, '') // 末尾の余分な改行を除去
  ?? '';
```

`parseOS1` / `parseOS1Instagram` / `parseOS1Threads` の `案A`・`案B` 取得箇所を
**すべて同じ修正パターンで置き換える。** 関数が3つあるので3箇所全部。

継続接触OSパーサー（`parseTouchOutput` 等）の `提案文A`・`提案文B` も同様に修正する。

---

## Step 3｜Tab3.tsx の修正（OS③パーサー呼び出し）

### 3-1. handleSubmit を修正

```typescript
// Tab3.tsx の handleSubmit (49-68付近) を修正

import { parseOS3Output } from '../utils/parser';
// ↑ すでにparserをimportしている場合は parseOS3Output を追加するだけ

const handleSubmit = async () => {
  if (!rawOutput.trim() || !selectedCaseId) return;

  setIsSubmitting(true);
  try {
    // ─── OS③パース処理（新規追加）───
    const os3Result = parseOS3Output(rawOutput);

    // ─── Firestoreに構造化フィールドを書き込む（既存のrawOutput保存に追加）───
    await updateDoc(doc(db, 'cases', selectedCaseId), {
      // 既存フィールド（変更なし）
      os3RawOutput:   rawOutput,
      status:         'closed',
      // ─── 新規追加フィールド ───
      closeType:       os3Result.closeType,
      closeTypeReason: os3Result.closeTypeReason,
      hypothesisResult: os3Result.hypothesisResult,
      hypothesisNote:  os3Result.hypothesisNote,
      timingVerdict:   os3Result.timingVerdict,
      timingNote:      os3Result.timingNote,
      bestTiming:      os3Result.bestTiming,
      reapproachScore: os3Result.reapproachScore,
      reapproachWait:  os3Result.reapproachWait,
      reapproachHow:   os3Result.reapproachHow,
      reapproachNever: os3Result.reapproachNever,
      closeSummary:    os3Result.closeSummary,
      maxLearning:     os3Result.maxLearning,
      nextTypeAction:  os3Result.nextTypeAction,
      learningValue:   os3Result.learningValue,
      os3ProcessedAt:  os3Result.os3ProcessedAt,
      updatedAt:       new Date().toISOString(),
    });

    // ─── パース結果の確認用トースト（開発確認用・動作確認後に削除可）───
    const parsed = os3Result.closeType || '（未取得）';
    toast.success(`OS③保存完了 — クローズタイプ: ${parsed}`);

    setRawOutput('');
  } catch (err) {
    console.error('OS③保存エラー:', err);
    toast.error('保存に失敗しました');
  } finally {
    setIsSubmitting(false);
  }
};
```

### 3-2. パース失敗の検知

`os3Result.closeType` が空文字列の場合、AI出力のフォーマットが崩れている可能性がある。
その場合は保存を続けるが、警告トーストを出す：

```typescript
// handleSubmit の updateDoc の前に追加
if (!os3Result.closeType) {
  toast.warn(
    'クローズタイプが取得できませんでした。AI出力の【クローズタイプ】セクションを確認してください。',
    { autoClose: 5000 }
  );
  // ※ 保存は続行する（rawOutputは保存される）
}
```

---

## Step 4｜Tab1.tsx の修正（OS⓪重複登録防止）

### 4-1. handleSubmit に重複チェックを追加

```typescript
// Tab1.tsx の handleSubmit (46-68付近) を修正

const handleSubmit = async () => {
  if (!rawOutput.trim()) return;

  // 既存のパース処理
  const parsed = parseOS0Output(rawOutput); // 既存の関数名に合わせる
  if (!parsed) {
    toast.error('AI出力の解析に失敗しました');
    return;
  }

  // ─── 重複チェック（新規追加）───
  // handle または accountName が一致するものが既に存在するか確認
  const isDuplicate = os0List.some(item => {
    const sameHandle = parsed.handle &&
      item.handle?.toLowerCase() === parsed.handle.toLowerCase();
    const sameName = parsed.accountName &&
      item.accountName === parsed.accountName;
    return sameHandle || sameName;
  });

  if (isDuplicate) {
    const identifier = parsed.handle
      ? `@${parsed.handle}`
      : parsed.accountName;
    toast.error(
      `${identifier} は既に登録されています。同じAI出力を2回貼り付けていませんか？`,
      { autoClose: 4000 }
    );
    return; // ここで処理を止める
  }

  // ─── 以降は既存の登録処理（変更なし）───
  setIsSubmitting(true);
  try {
    await addDoc(collection(db, 'os0cases'), {
      ...parsed,
      createdAt: new Date().toISOString(),
    });
    toast.success('登録しました');
    setRawOutput('');
  } catch (err) {
    console.error('登録エラー:', err);
    toast.error('登録に失敗しました');
  } finally {
    setIsSubmitting(false);
  }
};
```

### 4-2. 重複チェックの参照先

`os0List` はコンポーネントが既にFirestoreから取得しているリストを使う。
もしコンポーネントがリストをローカルstateで持っていない場合は、
`handleSubmit` 実行前に `getDocs(collection(db, 'os0cases'))` で取得してチェックする：

```typescript
// os0List が存在しない場合のフォールバック
const snapshot = await getDocs(collection(db, 'os0cases'));
const existingItems = snapshot.docs.map(d => d.data());
const isDuplicate = existingItems.some(item =>
  (parsed.handle && item.handle?.toLowerCase() === parsed.handle.toLowerCase()) ||
  (parsed.accountName && item.accountName === parsed.accountName)
);
```

---

## 動作確認チェックリスト

実装後、以下の順番で確認する：

```
□ TypeScript コンパイルエラーがゼロになること（npm run build で確認）

□ OS③パーサー
  1. OS③のAI出力サンプルを Tab3 の入力欄に貼り付けて送信
  2. Firestore Console で該当caseドキュメントを開き、
     closeType / maxLearning / learningValue が書き込まれていることを確認
  3. Tab4（集計ダッシュボード）を開き、クローズタイプ分布が表示されることを確認

□ OS①接触文パーサー
  1. 2行以上の接触文（改行含む）をAI出力に含めて、タッチ追加フォームから貼り付け
  2. 保存後、タッチ履歴に接触文が全行表示されることを確認（2行目が切れないこと）

□ 重複登録防止
  1. OS⓪の同じAI出力を2回貼り付けて送信
  2. 2回目に「既に登録されています」トーストが出て、リストに追加されないことを確認
```

---

## 注意事項

- `parseOS3Output` は既存のOS③出力に対してのみ機能する。
  過去に保存された `rawOutput` の再パースは別タスク（今回対象外）。
- `learningValue: -1` はパース失敗を示す。Tab4の集計では `-1` を除外して平均を計算すること
  （Tab4.tsx側は今回変更しないが、既存コードが0として扱っている場合のみ確認が必要）。
- OS①パーサーの修正は「接触文が必ず複数行になる」という前提ではなく、
  「1行でも複数行でも正しく取れる」ようにする。1行の場合に壊れないことを確認すること。
