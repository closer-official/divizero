# React移行指示書（Vite + React + Firebase + Vercel）

## 概要

現在 `index.html` 1ファイル（3863行）に全部入っている静的アプリを、
Vite + React に作り直す。既存の機能・デザイン・Firebase連携・promptsフォルダ構造を引き継ぐ。

既存データ（Firebase）は20件程度で消えても可。LocalStorageのデータも移行不要。

---

## 現状の把握（作業前に必ず読む）

### 現在のファイル構成
```
/
├── index.html          ← 全部ここ（HTML + CSS + JS 3863行）
├── index_backup.html   ← 削除してよい
├── index_old.html      ← 削除してよい
├── prompts/            ← OSプロンプトファイル群（重要・そのまま引き継ぐ）
│   ├── OS1_X_接触スクリーニング_latest.md
│   ├── OS1_Instagram_接触スクリーニング_latest.md
│   ├── OS1_Threads_接触スクリーニング_latest.md
│   ├── OS2_行動判定_latest.md
│   ├── OS3_案件検証_latest.md
│   └── IG読み取りOCR_latest.md
├── vercel.json
├── package.json
└── api/                ← 既存のAPI（内容確認して必要なら引き継ぐ）
```

### 現在のアプリの機能（4タブ構成）

| タブ名 | ID | 役割 |
|--------|-----|------|
| 接触可否 | tab-targets-panel | TwitterプロフィールデータをOS①に流し、接触判断・スクリーニング結果を記録 |
| 接触昇格判定 | tab-replies-panel | 返信内容をOS②に流し、次の接触ステップを判定（リプ継続/DM移行/終了） |
| 失注原因ディープ分析 | tab-failures-panel | 会話ログをOS③に流し、失注分析結果をカードで管理 |
| 送信完了履歴 | tab-logs-panel | 送信したDM/コメント文章のログ（TSVエクスポートあり） |

### 共通のデータフロー（全タブ共通）
1. ユーザーが生テキスト（Twitterプロフ / チャットログ等）をtextareaに貼る
2. JSが `/prompts/` のプロンプトファイルと結合してクリップボードにコピー
3. ユーザーが外部AI（ChatGPT / Geminiなど）に貼り付けて実行
4. ユーザーがAIの出力を別のtextareaに貼り付けてインポート
5. JSが出力をregexでパースしてFirestoreに保存、カード/テーブルで表示

### 既存のUIデザイン
- カラー：紫ベース（#7c3aed, #6d28d9, #a78bfa）
- Tailwind CSS（CDNではなくnpmパッケージで）
- Font Awesome 6.6.0
- Google Fonts：Inter + Noto Sans JP
- カードスタイル（白背景・border・border-radius:16px・shadow）
- ダークモードなし

### Firebase構成
- Firebase Firestore をデータストアに使用
- 現在 `index.html` 内にFirebase設定がハードコードされている
- 移行後は `.env` に移動する（後述）

---

## 移行手順

### Step 1：Vite + React プロジェクトのセットアップ

リポジトリのルートで以下を実行：

```bash
npm create vite@latest . -- --template react-ts
```

既存ファイルとの競合確認：
- `package.json` は上書きしてよい
- `index.html` は Vite用に上書きしてよい
- `vercel.json` は後で調整

インストール：
```bash
npm install
npm install firebase
npm install @tailwindcss/vite tailwindcss
```

### Step 2：ディレクトリ構成

```
/
├── src/
│   ├── main.tsx
│   ├── App.tsx                    ← タブナビゲーション
│   ├── firebase.ts                ← Firebase初期化
│   ├── hooks/
│   │   └── usePrompts.ts          ← promptsファイルのfetch
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Card.tsx
│   │   │   ├── Button.tsx
│   │   │   └── Badge.tsx
│   │   └── tabs/
│   │       ├── TargetsTab.tsx     ← 接触可否
│   │       ├── RepliesTab.tsx     ← 接触昇格判定
│   │       ├── FailuresTab.tsx    ← 失注原因ディープ分析
│   │       └── LogsTab.tsx        ← 送信完了履歴
│   └── utils/
│       ├── parser.ts              ← AI出力のregexパーサー
│       └── clipboard.ts           ← クリップボードコピー
├── public/
│   └── prompts/                   ← 既存の /prompts/ をそのままコピー
├── index.html
├── vite.config.js
└── .env                           ← Firebase設定
```

### Step 3：Firebase設定をVercel環境変数から読み込む形に変更

`index.html` 内のFirebase設定（`firebaseConfig` オブジェクト）を探し、
Viteの環境変数（`import.meta.env.VITE_*`）経由で読み込む形に変更する。

ローカル開発はしないため `.env` ファイルは不要。
Vercelダッシュボードの Environment Variables に以下のキーで設定済みの前提で進める（設定値は既存の `index.html` から確認すること）：

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

`src/firebase.ts` の実装：

```js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
```

VercelはViteビルド時に `VITE_` プレフィックスの環境変数を自動でバンドルに注入する。
`.env` ファイルは作らない。`.gitignore` への追記も不要。

**Vercelダッシュボードでの作業（Claude Codeではなく手動）：**
上記6つのキーがまだ設定されていない場合のみ、
既存の `index.html` 内のFirebase設定値を参照してVercelダッシュボードに登録する。

### Step 4：promptsファイルの引き継ぎ

`/prompts/` フォルダを `/public/prompts/` にコピーする（パスそのまま）。
Viteでは `public/` 以下のファイルはビルド後もそのままのパスで配信される。

promptsの読み込みは `fetch('/prompts/OS1_X_接触スクリーニング_latest.md')` でそのまま動く。
`src/hooks/usePrompts.ts` にまとめる：

```js
export async function loadPrompts() {
  const files = {
    OS1_X: '/prompts/OS1_X_接触スクリーニング_latest.md',
    OS1_IG: '/prompts/OS1_Instagram_接触スクリーニング_latest.md',
    OS1_TH: '/prompts/OS1_Threads_接触スクリーニング_latest.md',
    OS2:    '/prompts/OS2_行動判定_latest.md',
    OS3:    '/prompts/OS3_案件検証_latest.md',
    IG_OCR: '/prompts/IG読み取りOCR_latest.md',
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await fetch(path).then(r => r.text())])
  );
  return Object.fromEntries(entries);
}
```

### Step 5：AI出力パーサーを独立ファイルに切り出す

`src/utils/parser.ts` に、現在 `index.html` 内に散在している
`【セクション名】` ベースのregexパース関数をまとめる。

**重要な修正事項（バグ修正を同時に行う）：**

OS③のパーサーで以下を必ず修正する：

```js
// ❌ 修正前（推定）：検証不能 → 学習価値0 になるバグ
// ✅ 修正後：【個別結論】セクションから学習価値を独立して抽出する

function parseOS3Output(text) {
  // 【事前仮説の答え合わせ】と【個別結論】は別セクション・別フィールド
  const hypothesisSection = text.match(/【事前仮説の答え合わせ】([\s\S]*?)(?=【|$)/)?.[1] ?? '';
  const conclusionSection = text.match(/【個別結論】([\s\S]*?)(?=【|$)/)?.[1] ?? '';

  // 仮説結果（的中/部分的中/外れ/検証不能）
  const hypothesisResult = hypothesisSection.match(/(的中|部分的中|外れ|検証不能)/)?.[1] ?? '不明';

  // 学習価値（0〜100の数値）← 必ず【個別結論】から独立して取る
  const learningValue = conclusionSection.match(/学習価値[：:]\s*(\d+)/)?.[1] ?? null;
  // nullの場合はUIで「-」表示（0とは区別する）

  return {
    hypothesisResult,  // カードの「仮説結果」欄に使う
    learningValue,     // カードの「学習価値」欄に使う。nullなら「-」表示
    // ... その他のフィールド
  };
}
```

### Step 6：各タブをReactコンポーネントに移植

`index.html` の既存コードを読みながら、タブごとに1コンポーネントに切り出す。
移植の優先順位：接触可否 → 送信完了履歴 → 接触昇格判定 → 失注原因ディープ分析

### Step 7：送信完了履歴タブに新フィールドを追加（新機能）

`LogsTab.tsx` の実装時に、以下のフィールドを最初から含めて作る
（既存コードの改修ではなく、新規実装時に織り込む）：

**送信ログの各エントリに追加するフィールド：**

```js
// Firestoreのログドキュメント構造
{
  // 既存フィールド（現行から引き継ぐ）
  accountName: '',
  handle: '',
  sentText: '',
  aiGeneratedText: '',
  editReason: '',
  sentAt: Timestamp,
  channel: '',  // Instagram / X / Threads

  // 新規追加フィールド
  targetPostText: '',      // 接触対象の投稿（要約または引用）
  targetPostType: '',      // 課題ツイート / 通常投稿 / 達成・嬉しい報告 / 愚痴・本音 / ネタ
  targetValidity: '',      // ◯ / △ / ✕ / 未評価（対象妥当性）
  messageValidity: '',     // ◯ / △ / ✕ / 未評価（文面妥当性）
}
```

UIは送信ログ入力フォームに以下を追加：
- 「接触対象の投稿（要約または引用）」テキストエリア（任意）
- 「投稿種別」セレクトボックス（課題ツイート / 通常投稿 / 達成・嬉しい報告 / 愚痴・本音 / ネタ）
- 「対象妥当性」セレクトボックス（◯ / △ / ✕ / 未評価）
  - ◯ = 課題・通常投稿・達成報告に乗った
  - △ = グレー（判断が難しかった）
  - ✕ = 愚痴・本音・ネタに営業意図で乗った（要注意）
- 「文面妥当性」セレクトボックス（◯ / △ / ✕ / 未評価）

ログ一覧には「対象妥当性」「文面妥当性」をバッジで表示（◯=緑・△=黄・✕=赤）。

### Step 8：OS③カードに詳細展開ボタンを追加（新機能）

`FailuresTab.tsx` の実装時に最初から組み込む：
- 各カードに「詳細 ▼」ボタンを追加
- 押すとそのカードのOS③フル出力テキストをアコーディオン展開
- Firestoreに `rawOutput: ''` フィールドとしてフル出力テキストを保存しておく

### Step 9：vercel.json の更新

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

---

## 移行後のファイル配置確認チェックリスト

- [ ] `public/prompts/` に全6つのmdファイルが入っている
- [ ] Firebase設定がコードにハードコードされていない（`import.meta.env.VITE_*` 経由になっている）
- [ ] VercelダッシュボードにVITE_FIREBASE_*の環境変数が6つ設定されている
- [ ] `index_backup.html` と `index_old.html` は削除済み
- [ ] `npm run build` でエラーなし（Vercelのビルドログで確認）
- [ ] デプロイ後、4タブが全部動く

---

## 移行しない・触らないもの

- `prompts/` フォルダの中身（`public/prompts/` にコピーするが元も残す）
- Firebaseプロジェクト自体の設定
- `api/` フォルダ（内容確認して必要なら引き継ぐ、不要なら削除してよい）

## 削除してよいもの

- `index_backup.html`（Reactに移行したらHTML版に戻らないため不要。Gitの履歴がバックアップになる）
- `index_old.html`（同上）
