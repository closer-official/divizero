# 指示書C｜ステップ管理・フロー連携

## 対象バグ・機能欠如
- #24: ステップ手動変更UIが存在しない → OS②なし接触では永遠にS1のまま（TouchItem.tsx:1617）
- #3:  OS①→OS②送客でverdict/reason/仮説が引き継がれない
- #4:  OS①クローズ→OS③への自動遷移がフィードバックなしで突然飛ぶ（App.tsx:119）
- #6:  ゴミ箱復元がOS⓪・OS①のみ対応。OS③/closed/pipelineは復元不可（Tab4.tsx:86-91）

---

## 必須前提

1. **実装前に読むファイル**
   - `types.ts`（Case型の currentStep フィールド定義を確認）
   - `TouchItem.tsx`（またはケースカードコンポーネント。行1617付近の advanceStep 呼び出しを確認）
   - `App.tsx`（OS①クローズ時の Tab3 遷移処理・行119付近）
   - `Tab4.tsx`（handleRestoreFromTrash・行86-91）
   - `src/utils/os2Prompt.ts`（OS②プロンプト生成関数）
   - **`ClaudeCode_会話スレッド指示書_v2.md`**（advanceStep の定義・スレッドモードとの整合確認）

2. **変更するファイル**
   - `src/components/TouchItem.tsx`（またはケースカードコンポーネント）
   - `src/utils/os2Prompt.ts`
   - `App.tsx`
   - `Tab4.tsx`

3. **変更しないファイル**
   - `Tab1.tsx` `Tab2.tsx` `Tab3.tsx` `Tab5.tsx`
   - `parser.ts` `types.ts` `firebase.ts`

4. **実装順**
   ```
   Step 1: #6 ゴミ箱復元拡張（影響範囲が Tab4 のみ・最小）
   Step 2: #4 クローズ遷移フィードバック（App.tsx 1箇所）
   Step 3: #3 OS②引き継ぎ情報追加（os2Prompt.ts）
   Step 4: #24 ステップ手動変更UI（最も影響範囲が広い）
   ```

---

## Step 1｜#6 ゴミ箱復元の拡張（Tab4.tsx:86-91）

**原因:** `handleRestoreFromTrash` の分岐が `_trashSource === 'OS0'` と `'target'` の2種類のみ。
OS③完了・パイプライン案件をゴミ箱に入れた場合、復元先が存在しない。

**修正:** `_trashSource` の分岐を網羅する。

```typescript
// Tab4.tsx handleRestoreFromTrash（86-91付近）を以下に置き換える

const handleRestoreFromTrash = async (item: TrashItem) => {
  const source = item._trashSource;

  try {
    // _trashSource を除いたデータ
    const { _trashSource, ...restData } = item;

    if (source === 'OS0') {
      // ─── 既存：OS⓪リストへ復元 ───
      await addDoc(collection(db, 'os0cases'), restData);

    } else if (source === 'target') {
      // ─── 既存：OS①スクリーニングリストへ復元 ───
      await addDoc(collection(db, 'cases'), {
        ...restData,
        status: 'screening',
      });

    } else if (source === 'pipeline' || source === 'active') {
      // ─── 新規追加：パイプライン案件（進行中）へ復元 ───
      await addDoc(collection(db, 'cases'), {
        ...restData,
        status: 'active',
      });
      toast.success('パイプライン案件を復元しました');

    } else if (source === 'closed' || source === 'os3') {
      // ─── 新規追加：OS③完了・クローズ案件へ復元 ───
      await addDoc(collection(db, 'cases'), {
        ...restData,
        status: 'closed',
      });
      toast.success('クローズ案件を復元しました（ステータス: closed）');

    } else {
      // ─── 不明なソース：エラートーストのみ（復元しない）───
      toast.error(
        `復元できません。_trashSource が不明です: "${source ?? '未設定'}"`,
        { autoClose: 5000 }
      );
      return; // deleteDoc しない
    }

    // ゴミ箱から削除
    await deleteDoc(doc(db, 'trash', item.id));
    toast.success('復元しました');

  } catch (err) {
    console.error('復元エラー:', err);
    toast.error('復元に失敗しました');
  }
};
```

> **確認事項:** ゴミ箱に保存するとき（削除時）に `_trashSource` フィールドを何という値でセットしているかを
> 既存の削除ハンドラで確認し、上記の分岐の文字列と一致させること。
> 文字列が異なる場合は上記の `source ===` の値を実際の値に合わせる。

---

## Step 2｜#4 クローズ→OS③遷移のフィードバック追加（App.tsx:119付近）

**原因:** クローズ確定と同時に無通知でTab3に自動遷移する。
ユーザーが何が起きたか分からず混乱する。

**修正:** トースト通知 + 2秒の遅延遷移に変更する。ユーザーは通知を読んでから移動できる。

```typescript
// App.tsx の OS①クローズ処理（行119付近）

// ─── 修正前（おそらくこういう形）───
// setActiveTab(TAB_INDEX.TAB3);
// setOs3Prefill(caseData);

// ─── 修正後 ───
// ① まずトーストで通知
toast.info(
  `「${caseData.accountName}」をクローズしました。OS③（案件検証）に引き継ぎます...`,
  { autoClose: 2500 }
);

// ② 2秒後に遷移（ユーザーがトーストを読める時間）
setTimeout(() => {
  setOs3Prefill(caseData);   // 既存のprefillセット
  setActiveTab(TAB_INDEX.TAB3); // Tab3へ遷移
}, 2500);
```

> **確認事項:** `TAB_INDEX.TAB3` はプロジェクト内の定数名に合わせること。
> `setOs3Prefill` も実際の関数名に合わせること。

---

## Step 3｜#3 OS②プロンプトへの引き継ぎ情報追加（os2Prompt.ts）

**原因:** OS②プロンプト生成時に、OS①で判定した
`track`（FT/NT/UT）・`hypothesis`（事前仮説）・`os1ParsedResult`（提携候補フラグ等）
がプロンプトに渡されていない。OS②がゼロから文脈を再推定させる羽目になる。

**修正:** `buildOS2ConversationPrompt`（または既存のOS②プロンプト生成関数）に
OS①引き継ぎブロックを追加する。

```typescript
// src/utils/os2Prompt.ts

// buildOS2ConversationPrompt の inputBlock 生成部分に追加

const inputBlock = `
【案件名】${caseData.accountName}（@${caseData.handle}）
【チャネル】${caseData.channel}
【トラック】${caseData.track ?? '不明'}
【現在ステップ】${caseData.currentStep}

// ─── 追加：OS①引き継ぎ情報 ───
【OS①スクリーニング結果】
提携候補フラグ：${caseData.partnerFlag ? '有' : '無'}
事前仮説：${caseData.hypothesis ?? '未記録'}
接触開始日：${caseData.startDate ?? '不明'}
// ─── ここまで追加 ───

【往復回数】リプ往復：${repCount}回　DM往復：${dmCount}回
【S1接触数】${caseData.s1Count ?? 0}回
【相手の微反応】いいね返り：${caseData.likeReturnCount ?? 0}回（うち直近連続${caseData.likeReturnStreak ?? 0}回）／フォロー返し：${caseData.followReturned ? '有' : '無'}
【最終接触からの経過】${daysSince}日
【会話ログ】
${conversationLog}
`.trim();
```

> **確認事項:**
> - `caseData.partnerFlag` のフィールド名は実際の型定義に合わせること（`isPartnerCandidate` 等）
> - `caseData.hypothesis` が Case 型に存在するか確認する。なければ `os1Hypothesis` 等の実際名に合わせる
> - 会話スレッドなしの通常OS②呼び出し（`buildOS2Prompt`）がある場合は同じ引き継ぎブロックを追加する

---

## Step 4｜#24 ステップ手動変更UI（TouchItem.tsx またはケースカードコンポーネント）

**原因:** OS②の `advanceStep` は「前進」判定時のみ自動実行される（TouchItem.tsx:1617）。
OS②を踏まない接触パターン（ IGストーリー直入り・感触が良くて自己判断で進む等）では
ステップが永遠に S1 のまま固定される。

**修正:** ケースカードのステップバッジを編集可能にし、手動変更UIを追加する。

### 4-1. ステップ選択ドロップダウンコンポーネント（新規作成）

```typescript
// src/components/StepSelector.tsx（新規ファイル）

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import toast from 'react-hot-toast';

const STEPS = ['S0', 'S1', 'S1-L', 'S2', 'S3', 'S4', 'S5'] as const;
type Step = typeof STEPS[number];

interface StepSelectorProps {
  caseId:       string;
  currentStep:  string;
  onStepChange: (newStep: string) => void; // 親の表示更新用
}

export function StepSelector({ caseId, currentStep, onStepChange }: StepSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleSelect = async (newStep: Step) => {
    if (newStep === currentStep) {
      setIsOpen(false);
      return;
    }

    setIsUpdating(true);
    try {
      await updateDoc(doc(db, 'cases', caseId), {
        currentStep:         newStep,
        stepChangedManually: true,
        updatedAt:           new Date().toISOString(),
      });
      onStepChange(newStep);
      toast.success(`ステップを ${currentStep} → ${newStep} に変更しました`);
    } catch (err) {
      console.error('ステップ更新エラー:', err);
      toast.error('ステップ変更に失敗しました');
    } finally {
      setIsUpdating(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative inline-block">
      {/* ステップバッジ（クリックで開く）*/}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        disabled={isUpdating}
        className={`
          inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium
          bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors
          ${isUpdating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        {currentStep}
        <span className="text-indigo-400">▾</span>
      </button>

      {/* ドロップダウン */}
      {isOpen && (
        <>
          {/* オーバーレイ（外クリックで閉じる）*/}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[80px]">
            {STEPS.map(step => (
              <button
                key={step}
                onClick={() => handleSelect(step)}
                className={`
                  w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 transition-colors
                  ${step === currentStep
                    ? 'text-indigo-600 font-medium bg-indigo-50'
                    : 'text-gray-700'}
                `}
              >
                {step}
                {step === currentStep && <span className="ml-1 text-indigo-400">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

### 4-2. ケースカードに StepSelector を組み込む（TouchItem.tsx またはケースカードコンポーネント）

```typescript
// ステップバッジが表示されている箇所を探し、StepSelector に置き換える

import { StepSelector } from './StepSelector';

// ─── 修正前（既存のステップ表示）───
// <span className="...">{item.currentStep}</span>

// ─── 修正後 ───
<StepSelector
  caseId={item.id}
  currentStep={item.currentStep}
  onStepChange={(newStep) => {
    // ローカルstateの表示を即時更新（Firestoreの反映を待たない）
    // 親コンポーネントのstate更新方法に合わせて実装
    // 例: setCases(prev => prev.map(c => c.id === item.id ? { ...c, currentStep: newStep } : c))
  }}
/>
```

### 4-3. advanceStep との整合確認

`ClaudeCode_会話スレッド指示書_v2.md` の `advanceStep` 関数は
OS②「前進」判定時のみ呼ばれる。`StepSelector` は**それとは独立した手動変更**であり、
`advanceStep` を呼ばない。両者は競合しない。

ただし、OS②「前進」とほぼ同時に手動変更した場合の競合（last-write-wins）は許容する。
Firestoreはlast-write-winsのため、最後に書き込んだ方が優先される。これで十分。

---

## 動作確認チェックリスト

```
□ #6 ゴミ箱復元
  1. パイプライン案件をゴミ箱に移動し、復元する → cases コレクションに status: 'active' で復元されること
  2. クローズ案件をゴミ箱に移動し、復元する → cases コレクションに status: 'closed' で復元されること
  3. 不明な _trashSource のアイテムはエラートーストが出て復元されないこと

□ #4 クローズ遷移フィードバック
  1. OS①でアイテムをクローズする
  2. 「〜をクローズしました。OS③に引き継ぎます...」トーストが表示されること
  3. 約2.5秒後に Tab3 に遷移し、案件情報がprefillされていること

□ #3 OS②引き継ぎ情報
  1. 事前仮説・トラックが入力済みの案件でOS②プロンプトをコピー
  2. プロンプト内に【OS①スクリーニング結果】セクションが含まれていること
  3. 事前仮説のテキストが正しく入っていること

□ #24 ステップ手動変更
  1. ケースカードのステップバッジ（例: S1）をクリック → ドロップダウンが開くこと
  2. 別のステップを選択 → Firestoreが更新され、バッジの表示が即時変わること
  3. 「ステップを S1 → S3 に変更しました」トーストが出ること
  4. 同じステップを選択した場合はドロップダウンが閉じるだけで更新されないこと
  5. OS②の「前進」判定による自動ステップ変更が引き続き動作すること（既存動作の維持）
```
