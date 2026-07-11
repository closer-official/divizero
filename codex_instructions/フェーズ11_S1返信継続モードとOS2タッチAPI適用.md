# フェーズ11: S1接触の返信継続モードと、Tab2タッチ生成へのAPI適用

> 先に `00_共通ルール.md` を読むこと。前提: フェーズ9/10適用済み（`RUN_AI` ブリッジ・`src/services/aiRun.ts` が存在する）。
> また2026-07-10のClaude Code修正（`parseTouchOutput` の最終ブロック採用・gemini_filler のDOM抽出厳格化・TTL 10分化）が main に入っている。これらと矛盾する変更をしないこと。
>
> 対象: `chrome-extension/content/s1_touch_scanner.js` / `chrome-extension/background/service_worker.js` / `src/services/extensionBridge.ts` / `src/components/tabs/Tab2.tsx` / `chrome-extension/manifest.json`

## 解決する2つの問題

### 問題A: S1接触が「会話の継続」として記録されない

相手が自分のリプに返信してきたツイートに対して「💬 S1接触」を押すと、現在は**常に新規タッチ**として処理される:

- `GET_TOUCH_PROMPT`（`extensionBridge.ts:401`）は常に新規タッチ用プロンプト（`buildTouchPromptFromTemplate`）を組み立てる
- `RECORD_TOUCH`（`extensionBridge.ts:455`）は無条件に新しい `Touch` を push する

その結果、会話A（既存タッチ）の `reactionType` は `未記録` のまま放置され、返信が独立した別タッチとして並ぶ。会話Aの反応記録と `conversationTurns`（会話スレッド）が正しく育たない。

### 問題B: Tab2の「コピーしてGeminiを開く」がAPIを使わない

S1接触はフェーズ9で `RUN_AI` API直行に対応済みだが、Tab2（CaseCard）のタッチ生成は今も無条件に Gemini タブを開く。フェーズ9-6で指示した Tab2 側の適用が**未実装のまま**になっている（`Tab2.tsx` に `runAi` / `isAiModeEnabled` の import が無いことを確認済み）。

---

## 11-1: 拡張側 — 返信ツイートの検出 `s1_touch_scanner.js`

ツイートが「誰かへの返信」である場合、返信先ハンドルを抽出して background へ渡す。

```js
// article から返信先ハンドルを抽出（返信でなければ null）
function s1GetReplyToHandle(article) {
  // X の DOM: 返信ツイートは本文上部に「返信先: @xxx」(en: "Replying to @xxx") の行があり、
  // その中の a[href^="/"] がハンドルへのリンクになっている
  const divs = article.querySelectorAll('div')
  for (const div of divs) {
    const t = (div.textContent || '').trim()
    if (!t.startsWith('返信先') && !t.startsWith('Replying to')) continue
    const a = div.querySelector('a[href^="/"]')
    if (!a) return null
    const href = a.getAttribute('href') || ''
    const handle = href.replace(/^\//, '').split(/[/?]/)[0].toLowerCase()
    return handle || null
  }
  return null
}
```

実装上の注意:
- `startsWith` 判定は最も内側の該当divを拾うよう、ループは `article.querySelectorAll('div')` の**先頭から**見て最初の一致で確定してよい（返信先行は本文より上にあり1箇所のみ）
- ツイート詳細ページ（`/status/` 直下）ではスレッド表示のため返信先行が出ないことがある。**検出できなければ null（＝新規タッチ扱い）でよい**。無理に推測しない

`sendStart` の `s1_touch_start` メッセージに追加:

```js
chrome.runtime.sendMessage(
  { type: 's1_touch_start', handle: '@' + authorHandle, tweetUrl, tweetText,
    replyToHandle: s1GetReplyToHandle(article),   // ← 追加
    force: !!force },
  ...
)
```

レスポンス処理に追加: `resp.touchMode === 'reply'` のとき
`s1Toast('会話の継続として処理します（前回タッチの反応も記録されます）', false)` を表示する。
`resp.needsMyHandle === true` のとき
`s1Toast('設定（Tab2上部）で自分のXハンドルを登録すると、返信を会話の継続として記録できます', false)` を表示する（エラーではなく案内）。

## 11-2: background — コンテキストへのモード保持 `service_worker.js`

`handleS1TouchStart`:

1. `GET_TOUCH_PROMPT` の payload に `replyToHandle: params.replyToHandle || ''` を追加（`s1_touch_start` の message から受け取り、関数パラメータにも追加する）
2. ブリッジ応答の `payload` から `mode`（`'reply' | 'new'`）と `touchId`（継続対象タッチのID、reply時のみ）を受け取り、S1コンテキスト `ctx` に保存する:

```js
const { promptText, pipelineItemId, accountName, mode, touchId, needsMyHandle } = bridgeResp.payload
// ctx に mode / touchId / needsMyHandle を追加（API成功時の updatedCtx にも忘れず含める）
```

3. `sendResponse` に `touchMode: mode` と `needsMyHandle` を含める（11-1のトースト用）

`handleS1TouchSent`:

`RECORD_TOUCH` の payload に追加:

```js
await callWebAppBridge(webappTabId, 'RECORD_TOUCH', {
  pipelineItemId: ctx.pipelineItemId,
  postUrl: ctx.tweetUrl,
  postText: ctx.tweetText,
  sentText: message.sentText,
  aiSuggestedText: message.aiSuggestedText || '',
  mode: ctx.mode || 'new',        // ← 追加
  touchId: ctx.touchId || '',     // ← 追加
  replyText: ctx.tweetText || '', // ← 追加（相手の返信本文＝接触対象ツイート本文）
})
```

## 11-3: Webアプリ — `GET_TOUCH_PROMPT` の返信継続分岐 `extensionBridge.ts`

`buildInboundTouchPrompt` を `../utils/touchPrompt` から追加 import する。

`GET_TOUCH_PROMPT` case に以下のロジックを追加:

```ts
const replyToHandle = typeof payload.replyToHandle === 'string' ? extractHandleOnly(payload.replyToHandle) : ''
const myHandle = extractHandleOnly(data.settings?.myXHandle || '')

// 返信継続モードの判定:
//   (a) ツイートが返信であり (b) 返信先が自分のハンドルに一致し (c) 継続対象タッチが存在する
let mode: 'reply' | 'new' = 'new'
let continuationTouch: Touch | undefined
let needsMyHandle = false

if (replyToHandle) {
  if (!myHandle) {
    needsMyHandle = true   // ハンドル未設定 → 新規扱い + 案内フラグ
  } else if (replyToHandle === myHandle) {
    const touches = item.touches || []
    continuationTouch =
      [...touches].reverse().find(t => t.status === 'awaiting_reaction') ||
      [...touches].reverse().find(t => t.threadStatus === 'active') ||
      touches[touches.length - 1]
    if (continuationTouch) mode = 'reply'
  }
}
```

プロンプト組み立ての分岐:

```ts
const promptText = mode === 'reply'
  ? await buildInboundTouchPrompt(item, item.touches || [], {
      ownPostText: continuationTouch!.actualSentText,      // 相手が反応したのは自分の返信文
      ownPostRawText: continuationTouch!.actualSentText,
      inboundMemo: tweetText,                              // 相手の返信本文
      inboundReactions: ['テキスト返信'],
      inboundChannel: 'リプ',
    })
  : buildTouchPromptFromTemplate(item, item.touches || [], template, targetPost)
```

注意: reply モードでは template の fetch は `buildInboundTouchPrompt` 内部で行われるため、既存の `fetch('/prompts/...')` は new モードのときだけ実行する構成にしてよい（両モードで fetch しても害はないので、コードが簡潔になる方を選ぶ）。

レスポンスに追加:

```ts
respond(message.requestId, 'TOUCH_PROMPT', {
  found: true, promptText, pipelineItemId: item.id, accountName: item.accountName,
  mode,                                        // ← 追加
  touchId: continuationTouch?.id ?? '',        // ← 追加
  needsMyHandle,                               // ← 追加
})
```

## 11-4: Webアプリ — `RECORD_TOUCH` の返信継続分岐 `extensionBridge.ts`

payload に `mode` / `touchId` / `replyText` を受け取る。`mode === 'reply'` かつ `touchId` が pipeline item の touches に存在する場合、**新規Touchを作らず既存タッチを更新**する。更新内容は Tab2 の会話継続処理（`Tab2.tsx` の `conversationTurns` 追記パターン、3600行・4028行付近）と揃える:

```ts
if (mode === 'reply' && touchId) {
  const result = await commit(prev => {
    const itemIdx = prev.pipeline.findIndex(p => p.id === pipelineItemId)
    if (itemIdx === -1) return { next: prev, result: { ok: false, code: 'NOT_FOUND', touchId: '' } }
    const target = prev.pipeline[itemIdx]
    const touches = target.touches || []
    const tIdx = touches.findIndex(t => t.id === touchId)
    if (tIdx === -1) return { next: prev, result: { ok: false, code: 'TOUCH_NOT_FOUND', touchId: '' } }

    const touch = touches[tIdx]
    const now = new Date().toISOString()
    const partnerTurn: ConversationTurn = {
      id: uid(), role: '相手', text: replyText || '相手から返信あり',
      timestamp: now, channel: 'リプ', sentStatus: 'sent',
    }
    const selfTurn: ConversationTurn = {
      id: uid(), role: '自分', text: sentText,
      timestamp: now, channel: 'リプ', sentStatus: 'sent', sentAt: now,
    }
    const baseTurns = (touch.conversationTurns && touch.conversationTurns.length > 0)
      ? touch.conversationTurns
      : [{
          id: uid(), role: '自分' as const, text: touch.actualSentText,
          timestamp: touch.date, channel: 'リプ' as const, sentStatus: 'sent' as const, sentAt: touch.date,
        }]

    const existingReactions = Array.isArray(touch.reactionType)
      ? touch.reactionType : (touch.reactionType === '未記録' ? [] : [touch.reactionType])
    const reactionType = existingReactions.includes('テキスト返信')
      ? existingReactions : [...existingReactions, 'テキスト返信' as const]

    const updatedTouch: Touch = {
      ...touch,
      status: 'reacted',
      reactionType,
      reactionNote: touch.reactionNote ? touch.reactionNote : (replyText || ''),
      reactionReplyMode: 'text',
      touchMode: 'conversation',
      threadStatus: 'active',
      conversationTurns: [...baseTurns, partnerTurn, selfTurn],
      repExchangeCount: (touch.repExchangeCount || 0) + 1,
    }

    const newTouches = [...touches]
    newTouches[tIdx] = updatedTouch
    const currentStep = target.currentStep === 'S1' ? 'S2' : target.currentStep  // S2以上は維持
    const pipeline = prev.pipeline.map((p, i) =>
      i === itemIdx ? { ...p, touches: newTouches, lastContactDate: today, currentStep, state: 'active' as const } : p,
    )
    return { next: { ...prev, pipeline }, result: { ok: true, code: '', touchId: touch.id } }
  })
  respond(message.requestId, 'RECORD_TOUCH_RESULT', result)
  return
}
// mode が 'new' またはtouchId不明 → 既存の新規Touch追加処理をそのまま実行（一切変更しない）
```

型 import: `ConversationTurn` を `../types` から追加。`repCount` は**増やさない**（会話継続はTab2でも `repExchangeCount` のみ加算している）。

## 11-5: Tab2 — タッチ生成へのAPI適用（フェーズ9-6の完遂）`Tab2.tsx`

CaseCard 内の「コピーしてGeminiを開く」ハンドラ（2380行付近、`copyText(prompt)` → `setGeminiPrompt(...)` → `window.open('https://gemini.google.com/')` の並びがある関数）を、フェーズ9-6の仕様どおりに変更する:

```ts
// 冒頭に追加 import
import { runAi, isAiModeEnabled } from '../../services/aiRun'

// ハンドラ内・プロンプト組み立て直後に挿入:
if (isAiModeEnabled()) {
  setAiGenerating(true)                     // 新規 state: const [aiGenerating, setAiGenerating] = useState(false)
  const result = await runAi(prompt)
  setAiGenerating(false)
  if (result.ok) {
    setTOutput(result.text)                 // AI出力欄のstate（既存の出力貼り付けstateを使う。名称は実装時に確認）
    const parsed = handleAutoFillFromText(result.text)  // 既存の自動解析関数（2400行付近、boolを返す）
    if (parsed) {
      toast.show('🤖 AIで生成しました', 3000)
      return                                // Geminiは開かない
    }
    toast.show('AI出力の形式が不正のためGemini画面で続行します', 3500)
  } else if (result.code !== 'AI_MODE_OFF') {
    toast.show(`APIエラー(${result.code})のためGemini画面で続行します`, 3500)
  }
  // ↓ フォールバック: 既存処理へそのまま落ちる
}
/* 既存の copyText → setGeminiPrompt → window.open は一切変更しない */
```

- ボタン表示: `aiGenerating` 中は「🤖 AI生成中…」+ disabled。`isAiModeEnabled()` が true のときのラベルは「🤖 AIで生成」、false のときは従来文言
- **インバウンドモード（`tTouchMode === 'inbound'`）でも同じ分岐が効くこと**（プロンプト組み立てが `buildInboundTouchPrompt` になるだけで、後続は共通）
- AI実行中にユーザーがフォームを閉じた場合に setState しないよう、実行前後で `addingTouch` 等の生存チェックを入れるか、コンポーネントアンマウント時の setState 警告が出ない構成にする

## 11-6: 仕上げ

- `manifest.json` の `version` を `2.7.0` に上げる
- `npm run build` 成功を確認

## 受け入れ基準

1. **返信継続（メインシナリオ）**: 案件Aにタッチ済み（`awaiting_reaction`）→ 相手が自分のリプに返信 → その返信ツイートで「💬 S1接触」→「会話の継続として処理します」トースト → A/B選択 → 返信送信 → 記録後、Tab2で:
   - 新規タッチが**増えていない**
   - 既存タッチが `reacted`・`reactionType` に「テキスト返信」・会話スレッドに相手ターンと自分ターンが追加されている
   - `currentStep` が S1→S2 に進んでいる（S2以上だった場合は維持）
2. **新規タッチ（回帰）**: 相手の通常投稿（返信でないツイート）への S1接触は従来どおり新規Touchとして記録される
3. **ハンドル未設定**: `settings.myXHandle` 未設定で返信ツイートに S1接触 → 新規タッチとして動作しつつ、設定を促すトーストが出る
4. **Tab2 API適用**: AIスイッチON時、「🤖 AIで生成」→ Geminiタブを開かずにフォームが自動入力される。OFF時・APIエラー時は従来どおりGeminiタブが開く（コピー・自動挿入も従来どおり）
5. **S1側とTab2側の両方**でreplyモード/newモードのプロンプトが正しく切り替わる（replyモードのプロンプト冒頭に「インバウンド反応への返信作成です」の行が入る）
6. viewerロールでは `RECORD_TOUCH` がREADONLYのまま
7. `npm run build` 成功

## コミット

```
S1返信継続モード（会話スレッド追記・反応記録）とTab2タッチ生成へのAPI適用
```

完了報告の末尾に `npm run deploy --m="S1返信継続モードとTab2タッチ生成API適用"` を出力すること。
