# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**営業OSワークスペース** — SNS（X/Instagram/Threads）上の見込み客を発掘し、接触・育成・クローズまでを管理する営業支援 Web アプリ。

ユーザーがプロフィールデータや会話ログを貼り付け → アプリがプロンプトを組み立て → ユーザーが外部AI（Gemini等）で実行 → AI出力を貼り付けて記録・管理、という手動ループで動く。**アプリ自体はAI APIを呼ばない。**

## Latest spec sources

この `CLAUDE.md` はリポジトリ全体の案内であり、営業OSの最新仕様そのものは `public/prompts/` を優先してください。

特に次を見れば、現在のOS仕様に追いつけます。

- `public/prompts/OS1_最新仕様一括更新_latest.md`
- `public/prompts/OS2_行動判定_latest.md`
- `public/prompts/OS_S1行動判定_バッチ_latest.md`
- `public/prompts/OS_S1リアクション後行動判定_latest.md`
- `public/prompts/OS_DM文面判定_latest.md`
- `public/prompts/OS_文面再判定_latest.md`

Claude にこのリポジトリの「最新仕様」を渡す場合は、`CLAUDE.md` 単体ではなく、上の最新プロンプト群も併せて参照してください。

## Tech stack

| 項目 | 内容 |
|---|---|
| フレームワーク | React 18 + TypeScript (Vite 6) |
| スタイル | Tailwind CSS v4 (@tailwindcss/vite プラグイン) |
| データ永続化 | Firebase Firestore（メイン）/ localStorage（フォールバック） |
| ホスティング | Vercel（`api/` フォルダのサーバーレス関数も自動デプロイ） |
| アイコン | Font Awesome（CDN、`index.html` で読み込み） |

## Running the app

```bash
npm run dev      # 開発サーバー起動（http://localhost:5173）
npm run build    # TypeScript型チェック + Viteビルド → dist/
npm run deploy -- -m "コミットメッセージ"  # buildInfo更新 → git commit → push → Vercel自動デプロイ
```

### Deploy の仕組み

`deploy.js` が行うこと:
1. `src/buildInfo.ts` に `MM/DD メッセージ` 形式のビルドラベルを書き込む
2. `git add -A && git commit && git push`
3. Vercel が push を検知して `npm run build` → `dist/` を公開

**プロンプトファイルを編集したら `npm run deploy` するだけで本番に反映される**（`public/prompts/` はそのままコミットされる）。

## Project structure

```
src/
  main.tsx                    # ReactDOM.render エントリーポイント
  App.tsx                     # ルートコンポーネント
  types.ts                    # 全型定義（最初にここを読むと全体像がわかる）
  buildInfo.ts                # BUILD_LABEL 定数（deploy.js が自動生成）
  firebase.ts                 # Firebase 初期化（/api/config から設定取得）
  index.css                   # Tailwind + カスタムクラス定義
  hooks/
    useAuth.ts                # 認証状態管理
    useData.ts                # Firestore リアルタイム同期
    usePrompts.ts             # プロンプトファイル読み込み
  components/
    tabs/
      Tab0.tsx                # OS⓪ 一次選別
      Tab1.tsx                # OS① スクリーニング
      Tab2.tsx                # OS② パイプライン管理
      Tab3.tsx                # OS③ 案件検証
      Tab4.tsx                # 集計ダッシュボード
      Tab5.tsx                # 分析履歴
      Tab6.tsx                # SNS人格OS Ver.4（営業OSとは別系統）
      TabHome.tsx             # ホーム（要対応案件への直接遷移）
  services/
    home/homeTypes.ts         # TabId 型など ホームタブ用の型
    StepSelector.tsx          # ステップ選択 UI 部品
    MdPreviewModal.tsx        # Markdown プレビューモーダル
  utils/
    parser.ts                 # AI出力テキストの regex パース（全OSで共通）
    helpers.ts                # uid生成・除外リスト操作・URL生成など汎用ユーティリティ
    clipboard.ts              # クリップボード書き込み
    mdExport.ts               # Markdown エクスポート生成
    os2Prompt.ts              # OS② 行動判定プロンプト組み立て
    judgmentPrompt.ts         # 文面再判定プロンプト組み立て（OS_文面再判定）
    dmPrompt.ts               # DM会話プロンプト組み立て（buildDMPrompt / parseDMOutput）
    dmJudgmentPrompt.ts       # DM文面判定プロンプト組み立て
    touchPrompt.ts            # タッチ接触プロンプト組み立て（OS_継続接触_タッチ生成）
    s1ActionPrompt.ts         # S1リアクション後行動判定プロンプト
    phenomenonFuturePrompt.ts # 現象未来フロープロンプト
    analysisPrompt.ts         # 定期分析プロンプト（失注パターン・文面傾向）
    analysisNotification.ts   # 分析トリガー判定ロジック
api/
  auth.js                     # Vercel サーバーレス: パスワード認証
  config.js                   # Vercel サーバーレス: Firebase 設定を環境変数から返す
public/
  prompts/                    # ← プロンプトファイルの唯一の場所（ここを編集する）
    OS0_一次選別_v2.md        など（下記一覧参照）
```

## The eight tabs

ナビは home / tab0〜tab6 の8タブ（`App.tsx` のナビ配列参照）。営業OSの中核は Tab0〜Tab5。

### TabHome — ホーム (`src/components/tabs/TabHome.tsx`)

要対応案件の一覧と各タブへの導線。パイプライン項目を指定して Tab2 を直接開ける（`onGoToTab2WithItem`）。

### Tab6 — SNS人格OS Ver.4 (`src/components/tabs/Tab6.tsx`)

自アカウントの投稿生成・分析系。営業OS（OS⓪〜③）とは別系統で、営業OSのハンドオフ・監査のスコープ外。

### Tab0 — OS⓪ 一次選別 (`src/components/tabs/Tab0.tsx`)

SNS の検索タイムライン・フォロワー一覧のテキストを丸ごと貼り付け → OS⓪プロンプトをコピー（除外済みアカウントが自動付加される） → AIで実行 → 出力を貼り付け → 通過アカウントを `data.screenings[]` に追加、NG アカウントを `data.excluded[]` に保存。

- 「OS①へ」ボタンで Screening を削除し Tab1 へ遷移
- 除外済みリストは OS⓪プロンプトに自動反映されて二重判定を防ぐ
- 対応SNS: X / Instagram / Threads（モードボタンで切替）

### Tab1 — OS① スクリーニング (`src/components/tabs/Tab1.tsx`)

OS①プロンプト + スクショを外部AI へ → 出力を貼り付け → `parser.ts` が `【見出し】` 形式でパース → `data.targets[]` に Target として保存。

- 詳細パネルで仮説・リプ案A/B・ストーリー返信案・初回DM案を確認・コピー
- 「パイプラインへ移動」で `data.pipeline[]` に PipelineItem を生成、Target の `pipelineId` に ID をセット
- 対応SNS: X / Instagram / Threads（モードで parser を切替）
- ページネーション: 10件ずつ表示

### Tab2 — OS② パイプライン管理 (`src/components/tabs/Tab2.tsx`)

接触中案件の管理。**S∞ループ構造**（後述）に基づき各アカウントの状態・温度・タッチ履歴を管理する。

主な機能:
- Touch 記録（接触投稿・送信テキスト・リアクション・判定結果）
- 会話スレッド（ConversationTurn）管理（リプ↔DM交互）
- OS② 行動判定プロンプト組み立て・実行・結果保存
- DM文生成・文面判定
- 案件クローズ → Tab3（OS③）へ自動遷移（`App.tsx` の `handleCloseCase`）
- 48h 無反応チェック・再接触日通知（App.tsx 起動時に実行）

### Tab3 — OS③ 案件検証 (`src/components/tabs/Tab3.tsx`)

失注・成約案件の深掘り分析。Tab2 のクローズ時に `prefill` で情報が引き継がれる。OS③プロンプト + 会話ログを外部AI へ → 出力を貼り付け → `data.closed[]` に ClosedDeal として保存。

### Tab4 — 集計ダッシュボード (`src/components/tabs/Tab4.tsx`)

`data.pipeline[]` / `data.closed[]` を集計して数値・グラフを表示。Markdown エクスポート機能あり。

### Tab5 — 分析履歴 (`src/components/tabs/Tab5.tsx`)

`data.analyses[]` に蓄積された定期分析レコードの一覧表示。`analysisNotification.ts` が分析トリガー条件を判定し、条件を満たしたらプロンプトを提示する。

## S∞ループ構造（PipelineItem の状態管理）

```
PipelineItem.state: 'active' | 'waiting' | 'meeting_scheduled' | 'sleeping' | 'archived' | 'closed'
PipelineItem.temperature: number (0–100)  # 接触温度
PipelineItem.last_reaction: 'none' | 'heart' | 'temp20' | 'temp50' | 'temp80' | 'negative'
PipelineItem.recontact_date: string (ISO date)  # waiting/sleeping/archived → active への自動遷移日
```

- **active**: 接触アクティブ。再接触日になると自動で active に戻る
- **waiting**: 再接触日まで待機中（7〜30日後が目安）
- **meeting_scheduled**: 商談・面談予定あり。`meetingDate <= now` で自動的に active に戻る（`meetingDate` / `meetingUrl` / `meetingNote` を保持）
- **sleeping**: 低頻度監視（1〜3ヶ月後が目安）。いいね3連続＋フォロー返しなし等で移行
- **archived**: 長期保管（半年以上）。完全無反応3連続 / 30日反応ゼロで移行
- **closed**: クローズ済み

起動時チェック（`App.tsx` の `useEffect`）:
1. `state === 'waiting' | 'sleeping' | 'archived'` かつ `recontact_date <= now`、または `state === 'meeting_scheduled'` かつ `meetingDate <= now` → `state = 'active'` に更新
2. 最新 Touch が `awaiting_reaction` かつ 48h 経過 → `last_reaction = 'none'` に更新
3. 再接触日が来ているアカウントがあればトースト通知

## Data model（`src/types.ts`）

```
AppData
  screenings: Screening[]       # OS⓪通過アカウント
  targets: Target[]             # OS①スクリーニング済みアカウント
  pipeline: PipelineItem[]      # OS②管理中案件
  closed: ClosedDeal[]          # OS③クローズ済み案件
  excluded: ExcludedAccount[]   # 除外済み（再判定不要）アカウント
  trash: TrashItem[]            # ソフトデリート（元に戻す対応）
  logs: LogEntry[]              # 送信ログ（旧機能・Tab4で集計に使用）
  analyses: Analysis[]          # 定期分析履歴
```

全データは Firestore の `workspace/main` ドキュメントの `payload` フィールドに JSON 文字列として保存。

**Step:** S1 → S2 → S3 → S4 → S5  
**Track:** FT（ファストトラック＝優先認知維持）/ NT（通常＝リプ経由）/ UT（UTAGEユーザー＝最優先。ただしDM直行はせずS0→S1リプで認知を取ってからOS②へ）/ SKIP（除外）

## Persistence & Auth

### Firestore

- `initFirebase()` が `/api/config` から Firebase 設定を取得（秘密鍵をクライアントバンドルに含めないため）
- ローカル開発時は `VITE_FIREBASE_*` 環境変数にフォールバック（`.env.local.example` 参照）
- Firestore 未接続時は `localStorage('os_data_v1')` にフォールバック

### Auth（`useAuth.ts`）

- 起動時に `/api/auth` を probe（POST `password: '__probe__'`）
- 404/405 → 認証サーバーなし → 自動で `admin` ロール（ローカル開発）
- 200/401 → ログイン画面を表示
- 認証成功後は `localStorage('os_auth_v1')` にロールを保存
- ロール: `admin`（全操作可）/ `viewer`（閲覧のみ）

### API endpoints（`api/`）

| エンドポイント | ファイル | 役割 |
|---|---|---|
| `POST /api/auth` | `api/auth.js` | パスワード認証。環境変数 `ADMIN_PASSWORD` / `VIEWER_PASSWORD` で設定 |
| `GET /api/config` | `api/config.js` | Firebase 設定を JSON で返す。環境変数 `FIREBASE_*` を読む |

## AI output parsing（`src/utils/parser.ts`）

AI が返すテキストは `【見出し】` 形式のブロック構造。

```ts
block(text, 'アカウント情報')   // 【アカウント情報】〜次の【】まで抽出
field(text, 'アカウント名')     // "アカウント名：xxx" の xxx を抽出
firstLineOf(text, '接触判断')  // ブロックの先頭行のみ
cleanMsg(s)                    // 「」『』の引用符を除去
```

各 OS のパース関数:
- `parseOS0 / parseOS0NG` — OS⓪（Twitter/Instagram/Threads 共通）
- `parseOS1 / parseOS1Instagram / parseOS1Threads` — OS①
- OS②・OS③ の出力は各 util ファイルで独自パース

## Prompt files（`public/prompts/`）

**編集場所: `public/prompts/` のみ。** ここを直接編集して `npm run deploy` すると本番に反映。

`usePrompts.ts` が起動時に `fetch('/prompts/ファイル名')` で全ファイルを読み込み、`Prompts` オブジェクトに集約して各タブに渡す。一部の util ファイル（`analysisPrompt.ts` 等）は直接 `fetch` でプロンプトを取得する。

| ファイル | Prompts キー / fetch先 | 用途 |
|---|---|---|
| `OS0_一次選別_v2.md` | `OS0` | OS⓪ 一次選別（SNS横断） |
| `OS0_X_一次選別_v2.md` | `OS0_X` | OS⓪ X専用 |
| `OS0_Instagram_一次選別_v2.md` | `OS0_IG` | OS⓪ Instagram専用 |
| `OS0_Threads_一次選別_v2.md` | `OS0_TH` | OS⓪ Threads専用 |
| `OS1_X_接触スクリーニング_latest.md` | `OS1_X` | OS① X |
| `OS1_Instagram_接触スクリーニング_latest.md` | `OS1_IG` | OS① Instagram |
| `OS1_Threads_接触スクリーニング_latest.md` | `OS1_TH` | OS① Threads |
| `OS2_行動判定_latest.md` | `OS2` | OS② 行動判定 |
| `OS3_案件検証_latest.md` | `OS3` | OS③ 案件検証 |
| `IG読み取りOCR_latest.md` | `IG_OCR` | Instagram スクショOCR |
| `OS_現象未来_latest.md` | `PHENOMENON_FUTURE` | 現象未来フロー |
| `OS_会話ログOCR_latest.md` | `LOG_OCR` | 会話ログOCR読み取り |
| `OS_S1リアクション後行動判定_latest.md` | `S1_ACTION` | S1リアクション後判定 |
| `OS_DM文面判定_latest.md` | `DM_JUDGE` | DM文面判定 |
| `OS_失注パターン分析_latest.md` | `analysisPrompt.ts` が直接 fetch | 失注パターン定期分析 |
| `OS_文面傾向分析_latest.md` | `analysisPrompt.ts` が直接 fetch | 文面傾向定期分析 |
| `OS_文面再判定_latest.md` | `judgmentPrompt.ts` が直接 fetch | 送信前文面再判定 |
| `OS_継続接触_タッチ生成_latest.md` | `touchPrompt.ts` が直接 fetch | タッチ接触文生成 |

**命名規則**: `_latest.md` は現行版を示す。バージョンを上げるときはファイル名を変えず内容を上書きする。

## Key files to read first

1. `src/types.ts` — データ構造の全体像
2. `src/App.tsx` — タブ管理・Toast・Confirm・起動時チェックロジック
3. `src/hooks/useData.ts` — データ読み書きの仕組み
4. `src/utils/parser.ts` — AI出力のパース方法
