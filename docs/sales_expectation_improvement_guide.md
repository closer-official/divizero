# 営業期待値スコア改善 実装指示書

## 背景と目的

現状の営業期待値スコア（0〜40点）は以下の問題を抱えている：
- AIが「確認済み事実」と「仮説・可能性」を区別せず加点する
- UTAGEがスコア表に定義されていない
- 根拠が1行しか保存されない（parser制約）
- 内訳を見る手段がない

本修正では「スコア数値は変えず、内訳を保存・表示できるようにする」ことを最小ゴールとする。

---

## スコープ外（触らないこと）

- Chrome拡張 / ReceiveService / clipboard / Gemini遷移
- Home / Tab2連続処理 / meeting_scheduled
- 既存の `salesExpectation`（数値）フィールドの削除・変更
- 既存データのマイグレーション（新フィールドは optional なので不要）

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `public/prompts/OS1_X_接触スクリーニング_latest.md` | スコア表・根拠フォーマット更新 |
| `public/prompts/OS1_Instagram_接触スクリーニング_latest.md` | 同上 |
| `public/prompts/OS1_Threads_接触スクリーニング_latest.md` | 同上 |
| `src/types.ts` | `salesExpectationBreakdown` フィールド追加 |
| `src/utils/parser.ts` | `extractSalesExp()` 内訳取得対応 |
| `src/components/tabs/Tab1.tsx` | 転記処理に `salesExpectationBreakdown` 追加（5箇所） |
| `src/components/tabs/Tab2.tsx` | 案件情報パネルに内訳表示追加、AI再判定プロンプト更新 |

---

## 1. プロンプト修正（3ファイル共通）

### 修正箇所

3つのOS①プロンプトファイルの `【営業期待値スコア（0〜40）】` セクションを以下に差し替える。

### 変更前（現状・3ファイル共通）

```
【営業期待値スコア（0〜40）】
※このスコアはOS①確定後は変動しない。接触を重ねても関係温度とは切り離して管理する。

40点：教育者 ＋ 受講生あり ＋ LINE販売 ＋ 無形商材
35点：教育者 ＋ 受講生あり ＋ 導線あり
25点：教育者 ＋ 商品あり（受講生確認できず）
15点：サービスあり（教育要素なし）
0点：対象外（店舗型・完全無形商材なし）

スコア：◯点
根拠：（教育者か・受講生あり/なし・販売導線の種類・商品種別を箇条書きで）
```

### 変更後（3ファイル共通）

```
【営業期待値スコア（0〜40）】
※このスコアはOS①確定後は変動しない。接触を重ねても関係温度とは切り離して管理する。
※「確認済み事実」のみを強く加点する。「〜かもしれない」「〜の可能性がある」は仮説欄に出すだけで加点しない。

■ ベーススコア（確認済み事実のみ加点）
+8点：教育者（コンサル・講師・コミュニティ運営者）であることが確認済み
+8点：UTAGE利用が確認済み（utage-system.comドメインまたは本人発言で確認）
+8点：受講生・コミュニティ会員・相談者の存在が確認済み
+6点：LINE販売または高単価無形商材の販売が確認済み
+5点：note・ブログ・LP等の販売導線が確認済み
+4点：無形商材販売（上記以外）

■ 減点
−3点：LP・HPが既に存在する（制作需要が下がる）
−2点：受講生の存在が未確認（教育者だが証拠なし）
−2点：販売導線が確認できない（SNSのみで商品・問い合わせ先が見当たらない）

■ UTAGEに関する注意
・UTAGE利用を「推測」しているだけ（UTAGEっぽいと思う・らしい）→ 加点しない。不明点に記載。
・UTAGE利用が確認済み（ドメイン・本人発言）→ +8点。さらにUTトラックにも振る。

■ 受講生に関する注意
・「教育者だから受講生がいそう」→ 加点しない。不明点に記載。
・受講生の存在が投稿・プロフ・LP等で確認できる → +8点。

スコア：◯点

確認済み事実：
（+N点 理由、+N点 理由 の形式で箇条書き。確認できた項目のみ）

減点：
（−N点 理由、の形式で箇条書き。該当なければ「なし」）

仮説加点なし（以下は加点しない・参考情報として記載のみ）：
（「〜の可能性」「〜かもしれない」要素を箇条書き。該当なければ省略）

不明点：
（受講生の有無・UTAGEの現状利用・高単価商品の有無など、確認できていない重要項目を箇条書き）
```

### 補足：「案件ログ転記用」セクションは変更しない

`営業期待値スコア：◯点` の1行はそのまま残す。parserがここからもフォールバック取得するため。

---

## 2. `src/types.ts`

### Target（130行付近）に追加

```ts
salesExpectation?: number;
salesExpectationReason?: string;
salesExpectationBreakdown?: string;   // ← 追加（内訳テキスト・複数行）
```

### PipelineItem（256行付近）に追加

```ts
salesExpectation?: number;        // 0-40, set at OS1, does not change
salesExpectationReason?: string;  // なぜこのスコアか（OS1判定時に記録、後から参照用）
salesExpectationBreakdown?: string; // ← 追加（確認済み事実・減点・不明点の内訳テキスト）
```

> `salesExpectationBreakdown` は optional なので既存データへの影響なし。

---

## 3. `src/utils/parser.ts`

### `extractSalesExp()` 関数（87〜104行）を修正

```ts
function extractSalesExp(text: string): {
  salesExpectation?: number;
  salesExpectationReason?: string;
  salesExpectationBreakdown?: string;  // ← 追加
} {
  const expBlock = block(text, '営業期待値スコア（0〜40）');
  let scoreRaw = expBlock ? field(expBlock, 'スコア') : '';
  const reasonRaw = expBlock ? field(expBlock, '根拠') : '';

  // 変更前: 根拠を1行テキストとして保存
  // 変更後: 内訳ブロック全体を複数行テキストとして保存
  const breakdownRaw = expBlock ? extractBreakdownText(expBlock) : undefined;

  if (!scoreRaw) {
    const logBlock = block(text, '案件ログ転記用');
    if (logBlock) scoreRaw = field(logBlock, '営業期待値スコア');
  }
  if (!scoreRaw) {
    const m = text.match(/営業期待値スコア[：:]\s*(\d+)/);
    if (m) scoreRaw = m[1];
  }
  const scoreMatch = scoreRaw.match(/(\d+)/);
  return {
    salesExpectation: scoreMatch ? parseInt(scoreMatch[1], 10) : undefined,
    salesExpectationReason: reasonRaw || undefined,
    salesExpectationBreakdown: breakdownRaw || undefined,
  };
}

// 追加するヘルパー関数
function extractBreakdownText(expBlock: string): string | undefined {
  // 「スコア：」の行を除いた残りの本文を内訳として取得
  const lines = expBlock.split('\n');
  const breakdown = lines
    .filter(l => !/^スコア[：:]/.test(l.trim()) && !/^根拠[：:]/.test(l.trim()))
    .join('\n')
    .trim();
  return breakdown || undefined;
}
```

### 戻り値に `salesExpectationBreakdown` を追加（3つのparse関数）

`parseOS1`、`parseOS1Instagram`、`parseOS1Threads` の `return` 文に追加：

```ts
// 変更前
const { salesExpectation, salesExpectationReason } = extractSalesExp(text);
return {
  ...
  salesExpectation, salesExpectationReason,
  ...
};

// 変更後
const { salesExpectation, salesExpectationReason, salesExpectationBreakdown } = extractSalesExp(text);
return {
  ...
  salesExpectation, salesExpectationReason, salesExpectationBreakdown,
  ...
};
```

---

## 4. `src/components/tabs/Tab1.tsx`

### `salesExpectationBreakdown` の転記（5箇所）

Tab1 の「パイプラインへ移動」処理で PipelineItem を生成しているブロックが5箇所ある。
それぞれで `salesExpectation` / `salesExpectationReason` をコピーしている行の直後に追加：

```ts
salesExpectation: newTarget.salesExpectation,
salesExpectationReason: newTarget.salesExpectationReason,
salesExpectationBreakdown: newTarget.salesExpectationBreakdown,  // ← 追加
```

検索キー：`salesExpectationReason: newTarget.salesExpectationReason` または `salesExpectationReason: tgt.salesExpectationReason`  
変数名は文脈によって `newTarget` / `tgt` が使われているが、同じパターンで追加する。

---

## 5. `src/components/tabs/Tab2.tsx`

### 5-1. 案件情報パネル（2407行付近）の内訳表示追加

現状の `item.salesExpectationReason` 表示ブロックの直後に内訳の折りたたみを追加：

```tsx
{/* 判定根拠（既存・変更なし） */}
{item.salesExpectationReason && (
  <div>
    <p className="text-[10px] text-slate-400 mb-0.5">判定根拠（OS①確定）</p>
    <p className="text-slate-600 text-[11px] leading-relaxed">{item.salesExpectationReason}</p>
  </div>
)}

{/* 内訳テキスト（新規追加） */}
{item.salesExpectationBreakdown && (() => {
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  return (
    <div>
      <button
        className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1 transition"
        onClick={() => setBreakdownOpen(v => !v)}
      >
        <i className={`fa-solid fa-chevron-${breakdownOpen ? 'up' : 'down'} text-[9px]`} />
        内訳を{breakdownOpen ? '閉じる' : '見る'}
      </button>
      {breakdownOpen && (
        <pre className="mt-1 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-lg p-2 border border-slate-100">
          {item.salesExpectationBreakdown}
        </pre>
      )}
    </div>
  )
})()}
```

> `useState` をIIFE内で使うのは Hooks のルール違反。  
> 正しくは、`ItemCard` コンポーネント（またはそれに相当する展開パネルのローカルstate）に `const [breakdownOpen, setBreakdownOpen] = useState(false)` を追加し、JSX内で条件表示する。

### 5-2. AI再判定ミニプロンプト（Tab2:2418〜2434行）の更新

現状のミニプロンプトも旧スコア定義を使っているため、同様に更新する：

```ts
const miniPrompt = `以下の案件情報を元に、OS①の営業期待値（0〜40点）を採点してください。

アカウント名：${item.accountName}
チャネル：${item.channel}
トラック：${item.track}
事前仮説：${item.hypothesis || '未設定'}

【採点基準（確認済み事実のみ加点）】
+8点：教育者であることが確認済み
+8点：UTAGE利用が確認済み（ドメイン・本人発言）
+8点：受講生・コミュニティ会員の存在が確認済み
+6点：LINE販売または高単価無形商材が確認済み
+5点：note・LP等の販売導線が確認済み
+4点：無形商材販売（上記以外）
−3点：LP・HPが既に存在する
−2点：受講生の存在が未確認
−2点：販売導線が確認できない

※「〜かもしれない」「〜の可能性」では加点しない。事実として確認できたもののみ加点。

以下のフォーマットで出力してください（他は書かないこと）：
スコア：N点
確認済み事実：
（+N点 理由、の箇条書き）
減点：
（−N点 理由、の箇条書き、なければ「なし」）
不明点：
（確認できていない重要項目）`
```

### 5-3. AI再判定の保存処理（Tab2:2471〜2487行）

「判定を適用」ボタンの処理で `salesExpectationBreakdown` も保存するよう更新：

```ts
onClick={() => {
  const scoreRaw = field(salesExpAiOutput, 'スコア')
  const scoreMatch = scoreRaw.match(/(\d+)/)
  if (!scoreMatch) {
    setSalesExpAiError('「スコア：N点」の形式が見つかりません。AI出力を確認してください。')
    return
  }
  const score = Math.min(40, Math.max(0, parseInt(scoreMatch[1], 10)))
  const reasonMatch2 = salesExpAiOutput.match(/根拠[：:]\s*([\s\S]*)/)
  const reason = reasonMatch2 ? reasonMatch2[1].trim() : ''
  // 追加: スコア行を除いた残りをbreakdownとして保存
  const breakdown = salesExpAiOutput
    .split('\n')
    .filter(l => !/^スコア[：:]/.test(l.trim()))
    .join('\n')
    .trim()
  setSalesExpInput(String(score))
  setSalesExpReasonInput(reason)
  setSalesExpBreakdownInput(breakdown)   // ← 新しいstate
  setSalesExpAiOpen(false)
  setSalesExpAiOutput('')
  setEditingSalesExp(true)
  toast.show(`${score}点を検出しました。確認して保存してください。`)
}}
```

### 5-4. 編集フォームの保存処理（Tab2:2534〜2546行）

`saveData` で `salesExpectationBreakdown` も保存：

```ts
saveData(prev => ({
  ...prev,
  pipeline: prev.pipeline.map(p =>
    p.id === item.id
      ? {
          ...p,
          salesExpectation: val,
          salesExpectationReason: salesExpReasonInput.trim() || p.salesExpectationReason,
          salesExpectationBreakdown: salesExpBreakdownInput.trim() || p.salesExpectationBreakdown,  // ← 追加
        }
      : p
  ),
}))
```

> `salesExpBreakdownInput` は既存の `salesExpReasonInput` と同様に `useState('')` として追加する。

---

## 動作確認チェックリスト

- [ ] 新スコア定義でOS①を実行し、確認済み事実・減点・不明点が内訳として出力される
- [ ] AI出力を貼り付けると `salesExpectation`（数値）と `salesExpectationBreakdown`（テキスト）が両方保存される
- [ ] Tab2 案件情報パネルに「内訳を見る」が表示され、展開すると内訳テキストが見える
- [ ] 古いデータ（breakdownなし）では「内訳を見る」が表示されない
- [ ] 既存の `salesExpectation` 数値・`salesExpectationReason` テキストが壊れていない
- [ ] Tab1 → Tab2 転記時に `salesExpectationBreakdown` が引き継がれる
- [ ] AI再判定ミニプロンプトが新定義で動作する

---

## 補足：将来的な拡張（今回はやらない）

- `salesExpectationBreakdown` を構造化型（`{ confirmed: string[], deductions: string[], unknowns: string[] }`）に変更する
- Tab4 ダッシュボードで内訳の集計・傾向表示を追加する
- OS②・OS③へ内訳を引き継ぐ
