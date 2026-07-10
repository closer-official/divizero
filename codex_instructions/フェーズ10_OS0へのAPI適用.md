# フェーズ10: OS⓪一次選別へのGemini API適用

> 先に `00_共通ルール.md` を読むこと。前提: フェーズ9適用済み（`RUN_AI` ブリッジ・`/api/gemini`・スイッチが稼働していること）。
> 設計原則はフェーズ9と同一: **スイッチOFF時・API失敗時は現行のGeminiタブフローへ自動フォールバック**。
> 対象: `chrome-extension/background/service_worker.js` / `chrome-extension/content/twitter_scraper.js`

## 背景

OS⓪フロー（フェーズ4で自動化済み）は完全テキスト入出力のためAPI適用の相性が最も良い。現行:

```
OS⓪ボタン → os0_start → プロンプト組立（除外リスト込み）→ os0_context保存 → Geminiタブ →
自動挿入 → ユーザーが送信 → 取込 → OS0_IMPORT → 結果バナー
```

API適用後（スイッチON・成功時）:

```
OS⓪ボタン → os0_start → プロンプト組立 → RUN_AI → OS0_IMPORT → Xページ上に結果トースト
```

Geminiタブも「送信」「取込」操作も不要になり、ボタン1回で登録まで完了する。

## 変更1: `service_worker.js` — `handleOS0Start()` にAPI分岐を追加

プロンプト組立（`prepareOS0PromptPayload`）成功後、`os0_context` を保存する**前**に:

```js
// AI直接実行を試す（Webアプリタブがある場合のみ。無ければ従来フローへ）
const webappTabId = await findExistingWebappTabId()
if (webappTabId != null) {
  await repairWebappBridgeIfNeeded(webappTabId)
  // ボタン側へ先行返却（AI実行は長時間かかるため）
  sendResponse({ ok: true, accountCount, excludedApplied: payload.excludedApplied, mode: 'api_trying' })

  let aiResp = null
  try {
    aiResp = await callWebAppBridge(webappTabId, 'RUN_AI', { prompt: payload.promptText }, 95000)
  } catch (_) { aiResp = null }

  if (aiResp?.ok && aiResp.payload?.ok && aiResp.payload.text) {
    // API成功 → OS0_IMPORT（既存の取込処理を流用しつつ、結果通知先をXタブに変える）
    const importResult = await importOS0Output(aiResp.payload.text, {
      channel: 'twitter', sourceContext, webappTabId,
    })
    if (senderTabId) {
      try { chrome.tabs.sendMessage(senderTabId, { type: 'os0_api_result', result: importResult }) } catch (_) {}
    }
    return
  }
  // API失敗（AI_MODE_OFF含む）→ 従来フローへ続行。Xタブへ案内（OFF時は案内なし）
  const offMode = aiResp?.payload?.code === 'AI_MODE_OFF'
  if (!offMode && senderTabId) {
    try { chrome.tabs.sendMessage(senderTabId, { type: 'os0_api_result', result: { ok: false, fallback: true, code: aiResp?.payload?.code || 'BRIDGE_FAILED' } }) } catch (_) {}
  }
  // ↓ そのまま従来フロー（os0_context保存 → openOrFocusGemini）へ落ちる。
  //   sendResponseは既に返しているため、以降のsendResponse呼び出しはスキップするフラグ管理をすること
}
```

実装上の注意:
- **`handleOS0Captured` の取込ロジックを共通化する**: 現在 `handleOS0Captured` 内にある「OS0_IMPORT呼び出し〜result生成」を `importOS0Output(rawText, { channel, sourceContext, webappTabId })` として関数抽出し、従来経路（Gemini取込）とAPI経路の両方から使う。従来経路の動作（Geminiタブへの `os0_import_result` 送信、成功時の `os0_context` 削除）は変えないこと
- API経路では `os0_context` を**保存しない**（Geminiを開かないため。保存すると次回Geminiを開いた時に古いパネルが出る）
- `sendResponse` の二重呼び出しに注意: API分岐に入る場合は先行返却し、フォールバックで従来フローに落ちるときは既存の `sendResponse` をスキップする（`let responded = false` フラグで管理）
- Webアプリタブが存在しない場合（`findExistingWebappTabId()` が null）はAPI分岐に入らず、従来フローをそのまま実行する（従来フローは取込時に `findOrOpenWebappTabId` でタブを開くので整合する）

## 変更2: `twitter_scraper.js` — 結果トーストとボタン表示

1. `chrome.runtime.onMessage` リスナーを追加（このファイルにはまだ無い）:

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'os0_api_result') return false
  const btn = document.getElementById('os-ext-send-btn')
  const r = message.result
  if (r?.ok) {
    const passed = Array.isArray(r.passed) ? r.passed.length : 0
    if (btn) {
      btn.textContent = `✓ 取込完了: 通過${passed} / NG${r.ngCount ?? 0} / 重複${r.skippedDuplicates ?? 0}`
      btn.style.background = '#22c55e'
      setTimeout(() => resetBtn(btn, null), 6000)
    }
  } else if (r?.fallback) {
    if (btn) btn.textContent = '⚠ APIエラー → Geminiで続行'
    // openOrFocusGeminiで画面が切り替わるため、表示は簡潔でよい
  } else if (btn) {
    btn.textContent = `⚠ 取込失敗: ${(r?.missing || []).join('/') || r?.code || '不明'}`
    btn.style.background = '#ef4444'
    setTimeout(() => resetBtn(btn, null), 6000)
  }
  return false
})
```

2. `buildAndSendToAI()` の成功表示: `startResp.mode === 'api_trying'` の場合はボタンを「🤖 AI選別中…（そのままお待ちください）」表示にし、`resetBtn` のタイマーは張らない（結果は `os0_api_result` で更新される）。従来モード（`mode` なし）は現行表示のまま
3. `resetBtn(btn, null)` が `originalText` null でも正しく既定文言に戻ることを確認（現行実装は `📋 OS0プロンプトを生成 (n件)` に戻す分岐があるはず。無ければ対応する）

## 変更3: 誤操作ガード

API経路は1クリックで登録まで走るため、連打防止を確認する:
- `buildAndSendToAI()` 冒頭の `btn.disabled` チェック（既存）で二重実行は防がれるが、「🤖 AI選別中…」の間もdisabledが維持されることを確認する
- `os0_api_result` 受信後にdisabled解除する

## 仕上げ

- `manifest.json` の `version` を `2.6.0` に上げる
- Webアプリ側の変更はないはずだが、`RUN_AI` の直列実行（フェーズ9の注意）により、OS⓪のAI実行中にS1接触のAI実行を同時に走らせると待ち行列になる点は仕様として許容

## 受け入れ基準

1. **スイッチOFF時**: OS⓪ボタン → 従来どおりGeminiタブが開き、自動挿入→送信→取込→結果バナーの流れ（回帰確認）
2. **スイッチON + 正常時**: フォロワー一覧/検索結果でOS⓪ボタン → 「🤖 AI選別中…」→ Geminiタブを開かずに、ボタンが「✓ 取込完了: 通過n / NGn / 重複n」になる → Tab0に通過アカウントが登録されている
3. 除外済みアカウントがプロンプトに含まれた状態でAPI実行される（フェーズ4の除外リスト付加がAPI経路でも効いている）
4. `GEMINI_API_KEY` 未設定でON実行 → 「⚠ APIエラー → Geminiで続行」表示ののち従来フローが完走する
5. Webアプリタブを閉じた状態でON実行 → API分岐に入らず従来フローで完走する
6. viewerロール（Webアプリ側）では `RUN_AI` が拒否され従来フローへフォールバックする

## コミット

```
OS⓪一次選別にGemini API直接実行を適用（1クリックで取込完了・失敗時は現行フローへ）
```

完了報告の末尾に `npm run deploy --m="OS⓪一次選別にGemini API直接実行を適用"` を出力すること。
