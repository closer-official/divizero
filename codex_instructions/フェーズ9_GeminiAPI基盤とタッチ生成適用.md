# フェーズ9: Gemini API基盤（スイッチ＋フォールバック）とタッチ生成への適用

> 先に `00_共通ルール.md` を読むこと。前提: フェーズ8適用済み（投稿原文がプロンプトに入ること）。
> **設計原則（ユーザー要求・絶対厳守）**:
> 1. トップバーのスイッチが**OFFのときは現行と完全に同一動作**（コードパスも既存のまま通る）
> 2. スイッチONでも、**API呼び出しに何か問題があれば（上限・エラー・タイムアウト・パース不能）現行動作へ自動フォールバック**する
>
> 対象: `api/gemini.js`（新規）/ `api/auth.js` / `vercel.json` / `src/hooks/useAuth.ts` / `src/services/aiRun.ts`（新規）/ `src/App.tsx` / `src/services/extensionBridge.ts` / `src/components/tabs/Tab2.tsx` / `chrome-extension/background/service_worker.js` / `chrome-extension/content/webapp_bridge.js` / `chrome-extension/content/s1_touch_scanner.js` / `CLAUDE.md` / `AGENTS.md`

## 全体アーキテクチャ

```
Webアプリ(Tab2) ──┐
                  ├─ runAi(prompt) ─→ POST /api/gemini（Vercel関数・GEMINI_API_KEY は環境変数）
拡張(S1フロー) ─ bridge RUN_AI ─┘        └─ 失敗/OFF → 呼び出し元が現行フローへフォールバック
```

- APIキーはVercel環境変数 `GEMINI_API_KEY`（ユーザーが設定する。コードに書かない）
- モデルは環境変数 `GEMINI_MODEL`（未設定時 `gemini-2.5-flash`）
- スイッチ状態はWebアプリの `localStorage('os_ai_mode_v1')` のみに持つ。拡張はスイッチ状態を知らず、常に `RUN_AI` ブリッジを試み、OFF時はWebアプリが `AI_MODE_OFF` を返す → 拡張がフォールバック（拡張側に状態同期を持たない＝単一情報源）

---

## 9-1: サーバーレス関数 `api/gemini.js`（新規）

`api/auth.js` と同じ形式（default export handler / CORSヘッダー / OPTIONS対応）で作成:

```js
import crypto from 'crypto'

const MODEL_ALLOWLIST = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite']

export default async function handler(req, res) {
  // CORS/OPTIONS/POST検証は api/auth.js と同様（Allow-Headers に 'Content-Type, X-OS-AI-Token' を含める）

  // ── 認証ガード ──
  const adminPass = process.env.ADMIN_PASSWORD
  if (adminPass) {
    const expected = crypto.createHash('sha256').update(adminPass + '::os_ai_v1').digest('hex')
    if (req.headers['x-os-ai-token'] !== expected) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
    }
  } // ADMIN_PASSWORD未設定（ローカル等）ならガードなし

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return res.status(503).json({ ok: false, code: 'NO_API_KEY' })

  const { prompt, model } = req.body || {}
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ ok: false, code: 'INVALID_PAYLOAD' })
  }
  const useModel = MODEL_ALLOWLIST.includes(model) ? model
    : (MODEL_ALLOWLIST.includes(process.env.GEMINI_MODEL) ? process.env.GEMINI_MODEL : 'gemini-2.5-flash')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 55000)
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: controller.signal,
      },
    )
    if (!upstream.ok) {
      return res.status(upstream.status === 429 ? 429 : 502)
        .json({ ok: false, code: `UPSTREAM_${upstream.status}` })
    }
    const data = await upstream.json()
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
    if (!text.trim()) return res.status(502).json({ ok: false, code: 'EMPTY_RESPONSE' })
    return res.status(200).json({ ok: true, text, model: useModel })
  } catch (err) {
    const code = err?.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED'
    return res.status(504).json({ ok: false, code })
  } finally {
    clearTimeout(timer)
  }
}
```

`vercel.json` に関数のタイムアウト設定を**既存設定を壊さずマージ**で追加:

```json
"functions": { "api/gemini.js": { "maxDuration": 60 } }
```

## 9-2: 認証トークンの発行 — `api/auth.js` / `src/hooks/useAuth.ts`

- `api/auth.js`: admin成功時のレスポンスに `aiToken` を追加:
  `crypto.createHash('sha256').update(adminPass + '::os_ai_v1').digest('hex')`
  （viewer成功時と、ADMIN_PASSWORD未設定のdevログイン時は `aiToken` なし）
- `useAuth.ts`: `login()` 成功時、`localStorage('os_auth_v1')` のJSONに `aiToken` も保存する。フックの戻り値に `aiToken: string | null` を追加（storedからも読む）
- **既ログインユーザーはトークンを持っていない** → `runAi` は `NO_TOKEN` を返してフォールバックする（エラーにしない）。再ログインで解消する旨をトーストで一度だけ案内（`sessionStorage` でdedup）

## 9-3: Webアプリ側AIサービス — `src/services/aiRun.ts`（新規）

```ts
export type AiRunResult = { ok: true; text: string } | { ok: false; code: string }

const AI_MODE_KEY = 'os_ai_mode_v1'
export function isAiModeEnabled(): boolean          // localStorage === 'on'
export function setAiModeEnabled(on: boolean): void // 'on' / 'off' を保存

export async function runAi(prompt: string): Promise<AiRunResult> {
  if (!isAiModeEnabled()) return { ok: false, code: 'AI_MODE_OFF' }
  const aiToken = /* localStorage os_auth_v1 から読む */
  if (!aiToken) return { ok: false, code: 'NO_TOKEN' }
  // fetch('/api/gemini', POST, headers: {'Content-Type':'application/json','X-OS-AI-Token':aiToken},
  //   body: {prompt}) を AbortController 90秒 で実行
  // レスポンスの ok/code をそのまま返す。fetch例外は {ok:false, code:'NETWORK'}
}
```

すべての失敗は例外を投げず `{ok:false, code}` で返す（呼び出し元のフォールバックを簡潔にするため）。

## 9-4: トップバーのスイッチ — `src/App.tsx`

- ヘッダー（BUILD_LABELバッジとリフレッシュボタンの間あたり）にトグルスイッチを追加:
  - ラベル: `🤖 AI直接実行`（ON時は緑系・OFF時はグレー系。既存の `role-badge-*` に近い見た目でよい）
  - `role === 'admin'` のときだけ表示
  - クリックで `setAiModeEnabled` を呼び、`useState` で即時反映。ON にしたとき `aiToken` が無ければ「AI直接実行には再ログインが必要です」とトースト
  - title属性: 「ON: プロンプトをGemini APIで直接実行（失敗時は自動でGemini画面にフォールバック）/ OFF: 従来どおりGemini画面で手動実行」

## 9-5: ブリッジ `RUN_AI` — `src/services/extensionBridge.ts` / `chrome-extension/content/webapp_bridge.js`

**extensionBridge.ts** に追加:

```ts
case 'RUN_AI': {
  if (role !== 'admin') { respond(message.requestId, 'AI_RESULT', { ok: false, code: 'READONLY' }); return }
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
  if (!prompt) { respond(message.requestId, 'ERROR', { code: 'INVALID_PAYLOAD' }); return }
  const result = await runAi(prompt)   // aiRun.ts からimport
  respond(message.requestId, 'AI_RESULT', result)
  return
}
```

注意: `dispatch` は `processing` チェーンで直列実行されるため、AI実行中（最大90秒）は他のブリッジ呼び出しが待たされる。単独ユーザー運用では許容（コメントで明記しておく）。

**webapp_bridge.js**: タイムアウトが12秒固定でAI実行に足りない。`message.timeoutMs`（数値・上限120000）があればそれを使い、なければ従来の12000にする（1行の変更＋ガード）。

**service_worker.js の `callWebAppBridge`**: 第4引数 `timeoutMs` を追加し、メッセージに載せて送る（既存呼び出しは無指定のまま）。

## 9-6: Tab2タッチ生成への適用 — `Tab2.tsx`（CaseCard）

`handleCopyAndOpenGemini()` を次の構造に変更（**OFF時・失敗時は既存コードがそのまま実行される**こと）:

```ts
async function handleCopyAndOpenGemini() {
  setAutoFillError(null)
  try {
    const prompt = /* 既存のプロンプト組み立て（フェーズ8のtargetPost込み） */

    if (isAiModeEnabled()) {
      setAiGenerating(true)                       // 新規state。ボタンを「🤖 AI生成中…」表示に
      const result = await runAi(prompt)
      setAiGenerating(false)
      if (result.ok) {
        setAiOutput(result.text)
        const parsed = handleAutoFill(result.text)   // フェーズ6で bool を返すようになっている
        if (parsed) {
          toast.show('🤖 AIで生成しました', 3000)
          return                                   // Geminiは開かない
        }
        toast.show('AI出力の形式が不正のためGemini画面で続行します', 3500)
      } else if (result.code !== 'AI_MODE_OFF') {
        toast.show(`APIエラー(${result.code})のためGemini画面で続行します`, 3500)
      }
      // ↓ フォールバック: 以下の既存処理へそのまま落ちる
    }

    /* ここから下は既存コードを一切変えない（copyText → setGeminiPrompt → window.open） */
  } catch { ... }
}
```

ボタンラベル: `isAiModeEnabled()` がtrueなら「🤖 AIで生成」、falseなら従来の文言。`aiGenerating` 中はdisabled。

## 9-7: S1接触フローへの適用 — `service_worker.js` / `s1_touch_scanner.js`

`handleS1TouchStart()` の変更（`GET_TOUCH_PROMPT` 成功後）:

```js
// 3. ストレージにコンテキスト保存（既存のまま。フォールバック時に必要）
await chrome.storage.local.set({ [S1_TOUCH_KEY]: ctx })

// 3b. AI直接実行を試す
let aiResp = null
try {
  aiResp = await callWebAppBridge(webappTabId, 'RUN_AI', { prompt: promptText }, 95000)
} catch (_) { aiResp = null }

if (aiResp?.ok && aiResp.payload?.ok && aiResp.payload.text) {
  // API成功 → Geminiを開かず、既存の取込処理をそのまま再利用
  sendResponse({ ok: true, accountName, mode: 'api' })   // ※sendResponseはRUN_AI前に先行返却する。下記注意参照
  await handleS1GeminiCaptured(aiResp.payload.text, undefined)
  return
}

// AI_MODE_OFF・失敗・タイムアウト → 従来どおり Gemini を開く
await openOrFocusGemini()
sendResponse({ ok: true, accountName, mode: 'web' })
```

**実装上の注意（重要）**:
- X側のボタンはsendResponseを待って表示を変えるため、**RUN_AIに入る前に `sendResponse({ ok: true, accountName, mode: 'api_trying' })` を先に返し**、以降は非同期で続行する構成にすること（AI実行は10〜60秒かかる。sendResponseを待たせるとscanner側のコールバックが長時間ブロックされる）。その場合:
  - API成功 → `handleS1GeminiCaptured(text)` が既存処理でXタブをフォーカスしA/Bパネルを出す（追加実装不要）
  - API失敗 → `openOrFocusGemini()` を実行し、Xタブへ `chrome.tabs.sendMessage(xTabId, { type: 's1_info', message: 'APIエラーのためGemini画面で続行します' })` を送る
- 上記2案（先行返却 or 待たせる）のうち**先行返却案を採用**する。`mode: 'api_trying'` を受けたscanner側はボタンを「🤖 AI生成中…」にする
- `RUN_AI` が `AI_MODE_OFF` を返した場合はエラートーストを出さず静かにGeminiフローへ（OFFは正常系）

**s1_touch_scanner.js**:
- `sendStart` の成功コールバック: `resp.mode === 'api_trying'` ならボタンを「🤖 AI生成中…」、それ以外は従来の「✓ Gemini起動中」表示
- `s1_info` メッセージタイプを追加し、`s1Toast(message, false)` で表示（`s1_error` の非エラー版）
- A/Bパネル表示（`s1_ab_ready`）が来たらボタン表示は既存のままでよい

## 9-8: ドキュメント更新

`CLAUDE.md` と `AGENTS.md` の冒頭「**アプリ自体はAI APIを呼ばない。**」の記述を更新:

> AI実行は既定では手動ループ（ユーザーが外部AIで実行）。トップバーの「AI直接実行」スイッチON時のみ `/api/gemini`（Vercel関数、`GEMINI_API_KEY` 環境変数）経由でGemini APIを呼び、失敗時は手動ループへ自動フォールバックする。

「Chrome extension」セクションのbridge type一覧に `RUN_AI` を、API endpointsの表に `POST /api/gemini` を追記。

## 仕上げ

- `manifest.json` の `version` を `2.5.0` に上げる
- `npm run build` 成功を確認

## 受け入れ基準

1. **スイッチOFF時**: S1接触・Tab2タッチ生成とも従来と完全に同一動作（Geminiタブが開く）
2. **スイッチON + 正常時**:
   - S1接触ボタン → 「🤖 AI生成中…」→ Geminiタブを開かずに10〜60秒でA/Bパネルが表示される → 返信・記録まで完走
   - Tab2「🤖 AIで生成」→ AI出力欄と解析結果が自動で埋まり、Geminiタブは開かない
3. **フォールバック**: `GEMINI_API_KEY` を未設定にして（またはトークン無しで）ON状態で実行 → トーストで理由が示され、従来のGeminiフローが**そのまま**動く
4. viewerロールでは `RUN_AI` がREADONLYで拒否され、スイッチ自体が表示されない
5. ADMIN_PASSWORD未設定のローカル環境でも `/api/gemini` がガードなしで動く
6. `npm run build` 成功

## コミット

```
Gemini API直接実行: /api/geminiプロキシ・トップバースイッチ・S1/Tab2タッチ生成適用（失敗時は現行フローへ自動フォールバック）
```

完了報告の末尾に `npm run deploy --m="Gemini API直接実行基盤とタッチ生成適用（自動フォールバック付き）"` を出力すること。
