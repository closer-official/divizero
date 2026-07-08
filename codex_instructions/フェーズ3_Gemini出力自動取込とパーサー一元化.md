# フェーズ3: Gemini出力のDOM自動取込 + タッチパーサー一元化（B1 / A9）

> 先に `00_共通ルール.md` を読むこと。前提: フェーズ1・2適用済み。
> 対象: `chrome-extension/content/gemini_filler.js` / `chrome-extension/background/service_worker.js` / `src/services/extensionBridge.ts`
> このフェーズは後続フェーズ4（OS⓪）・6（OS②）でも再利用する**汎用取込機構**を作る。設計はそれを前提にすること。

## 背景（現状の無駄・欠陥）

- S1接触フローで、Geminiの応答をユーザーが「全選択(Ctrl+A) → コピー(Ctrl+C) → 取込ボタン」の3手動ステップで渡している。プロンプト全文まで一緒にコピーされる・コピー漏れ等の失敗も多い。Geminiの応答は**ページDOMから直接読める**ので、この3ステップは不要。
- タッチ出力のパースが二重実装: `service_worker.js` の `parseTouchOutputBasic()`（簡易regex版）と、Webアプリ `src/utils/touchPrompt.ts` の `parseTouchOutput()`（正規版）。プロンプト仕様を変えると片方だけ壊れる。**Webアプリ側を唯一の実装にする。**

## 変更1: Gemini応答のDOM抽出 — `gemini_filler.js`

### 1-a. 応答抽出関数（汎用）

```js
// Geminiの会話内で「マーカー文字列を含む最後のモデル応答」のテキストを返す。見つからなければ null
function extractLastModelResponse(marker) {
  // Gemini のDOMは変わりやすいので候補セレクタを順に試す
  const selectors = [
    'model-response',                 // カスタム要素（現行）
    '[data-test-id="model-response"]',
    '.model-response-text',
    'message-content',
  ]
  for (const sel of selectors) {
    const nodes = Array.from(document.querySelectorAll(sel))
    for (let i = nodes.length - 1; i >= 0; i--) {
      const text = nodes[i].innerText || ''
      if (!marker || text.includes(marker)) return text.trim()
    }
  }
  // 最終フォールバック: body全文からマーカー区間を検索（プロンプト側にも同マーカーが含まれ得るため最後の出現を使う）
  if (marker) {
    const body = document.body.innerText || ''
    const lastIdx = body.lastIndexOf(marker)
    if (lastIdx !== -1) return body.slice(Math.max(0, lastIdx - 200), lastIdx + 20000)
  }
  return null
}
```

注意: **実装時に実際のGeminiのDOMを確認し、現行UIで確実に取れるセレクタを最優先に並べ替えること**（DevToolsで `model-response` 系のタグ名/クラスを確認）。セレクタは配列定数 `GEMINI_RESPONSE_SELECTORS` としてファイル冒頭に切り出し、将来のDOM変更時に1箇所で直せるようにする。

### 1-b. 取込ボタンの動作変更 — `showS1CapturePanel()`

「📋 取込」押下時の処理を次の順に変える:

1. `extractLastModelResponse('TOUCH_START')` を試す（`===TOUCH_START===` の `=` の数はブレるため `'TOUCH_START'` で検索）
2. 取れたらそれを `s1_gemini_captured` として background へ送る
3. 取れなければ従来どおり `navigator.clipboard.readText()` にフォールバック。その際ステータス表示を「クリップボードから読み取りました」/失敗時は従来のエラーメッセージにする

パネルの手順書き（①〜④）も更新する: 「③ AIの出力を全選択→コピー」の行を「③ 応答が完了したら下の【取込】を押す（コピー不要）」に変更。

### 1-c. 応答完了の自動検知（自動取込）

1. `showS1CapturePanel()` 表示中、`MutationObserver`（`document.body`, `{childList:true, subtree:true, characterData:true}`）で監視し、1秒間隔のポーリングと組み合わせて以下を判定する:
   - `extractLastModelResponse('TOUCH_END')` が非nullを返し、
   - その戻り値が**2回連続の判定で同一**（=ストリーミングが止まった）
2. 条件成立で自動的に取込処理（1-bの2）を実行し、パネルに「✓ 自動取込しました。Xに戻ります…」と表示して閉じる。
3. パネルに自動取込のトグルを付ける: `<label><input type="checkbox" id="s1-auto-capture" checked> 応答完了で自動取込</label>`。状態は `chrome.storage.local` の `s1_auto_capture_enabled`（既定 true）に保存し、次回以降も引き継ぐ。OFFのときは手動ボタンのみ。
4. 監視はパネルのremove時（取込完了・中止・新コンテキスト差し替え）に必ず `observer.disconnect()` とポーリング解除を行うこと。多重起動ガードも入れる。
5. 誤爆防止: 監視開始時点で既に `TOUCH_END` を含む応答が存在する場合（前回の会話が残っている等）は、**監視開始時のマッチテキストを記録しておき、それと異なる内容になったときのみ**自動取込を発火する。

## 変更2: パーサー一元化 — `extensionBridge.ts` + `service_worker.js`

### 2-a. Webアプリ側にパース用ブリッジタイプを追加 — `src/services/extensionBridge.ts`

`dispatch` の switch に追加:

```ts
case 'PARSE_TOUCH_OUTPUT': {
  const raw = typeof payload.raw === 'string' ? payload.raw : ''
  if (!raw) {
    respond(message.requestId, 'ERROR', { code: 'INVALID_PAYLOAD' })
    return
  }
  const parsed = parseTouchOutput(raw)   // src/utils/touchPrompt.ts からimport
  if (!parsed) {
    respond(message.requestId, 'TOUCH_OUTPUT_PARSED', { ok: false })
    return
  }
  respond(message.requestId, 'TOUCH_OUTPUT_PARSED', {
    ok: true,
    optionA: { text: parsed.suggestedTextA ?? '', judge: parsed.preJudgmentA ?? '' },
    optionB: { text: parsed.suggestedTextB ?? '', judge: parsed.preJudgmentB ?? '' },
  })
  return
}
```

注意: `parseTouchOutput` の実際の戻り値フィールド名を `src/utils/touchPrompt.ts` で**必ず確認**して合わせること（上記の `suggestedTextA` 等は仮名）。A/B案のテキストと仮判定に対応するフィールドをマッピングする。読み取り専用処理なので `role` チェックは不要。

### 2-b. background側 — `service_worker.js`

`handleS1GeminiCaptured()` を変更:

1. `parseTouchOutputBasic(clipboardText)` の呼び出しを、webapp_bridge経由の `PARSE_TOUCH_OUTPUT` 呼び出しに置き換える:
   - `ctx.webappTabId`（無ければ `findOrOpenWebappTabId()`）→ `repairWebappBridgeIfNeeded()` → `callWebAppBridge(tabId, 'PARSE_TOUCH_OUTPUT', { raw: clipboardText })`
   - リトライは `handleS1TouchStart` と同様に最大3回・1200ms間隔
2. `resp.payload.ok === false` の場合は従来と同じエラートースト（「AIの出力形式を認識できませんでした…」）をXタブへ送る
3. ブリッジ呼び出し自体が失敗した場合（Webアプリタブが応答しない等）のみ、**フォールバックとして** `parseTouchOutputBasic` を使う（完全削除はしない。関数の先頭コメントに「フォールバック専用。正規実装は src/utils/touchPrompt.ts」と明記する）
4. 成功時のフロー（コンテキスト更新→Xタブフォーカス→`s1_ab_ready`）は変えない

## 仕上げ

- `manifest.json` の `version` を `1.9.0` に上げる。
- `npm run build` が通ることを確認（extensionBridge.ts変更のため）。

## 受け入れ基準

1. S1接触 → Geminiで送信 → **何もコピーせず**応答完了を待つだけで、自動的にXタブに戻りA/Bパネルが表示される
2. 自動取込チェックをOFFにすると自動発火せず、「取込」ボタン押下でDOMから取得して同様に完了する
3. Geminiの応答が形式不正（TOUCH_START無し）の場合、Xタブに従来のエラートーストが出る
4. Webアプリの `parseTouchOutput` が返すA/B・仮判定と、A/Bパネルの表示内容が一致する（従来の簡易regex版との差異が出るケース: 複数行の提案文で確認）
5. 前回の会話に TOUCH_END が残っているGeminiタブで新規S1接触をしても、古い応答を誤って取り込まない
6. `npm run build` 成功

## コミット

```
Gemini出力のDOM自動取込（コピー操作廃止）・タッチパースをWebアプリ側に一元化
```

完了報告の末尾に `npm run deploy --m="Gemini出力のDOM自動取込（コピー操作廃止）・タッチパースをWebアプリ側に一元化"` を出力すること。
