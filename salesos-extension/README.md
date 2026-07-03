# SalesOS Assistant (W2)

`salesos-extension` は、X の一覧取得から Gemini 下書き、divizero 取込までを半自動化する MV3 拡張です。Gemini の送信と出力コピーは常に人間が行います。

## Build

1. [divizero.vercel.app](https://divizero.vercel.app) または `http://localhost:5173` を開き、W1 ブリッジが応答する状態にします。
2. このフォルダで `npm run build` を実行します。
3. Chrome の拡張機能画面でデベロッパーモードを有効化し、`dist/` を読み込みます。

## Test

`npm test` は `shared/xExtract.ts` を headless Chrome 上で実行し、保存フィクスチャに対して一覧抽出とプロフィール抽出を検証します。

## E2E

1. divizero を開き、拡張の popup で `divizero接続: OK` を確認します。
2. X の検索結果またはフォロワー一覧を開いて `OS①まで実行` を押します。
3. Gemini タブへ自動で移動したら、下書きを確認して人間が送信します。
4. Gemini のコピーボタンを押したあと、拡張パネルの `取込` を押します。
5. OS⓪完了後、同じ流れで OS① を順次処理します。
6. divizero 側で `screenings` と `targets` が生成されることを確認します。

## 壊れたときの点検順序

1. `npm test` を実行して `xExtract` が落ちていないか確認します。
2. X の DOM が変わった場合は `test/fixtures/*.html` を最新スナップショットに差し替え、`shared/xExtract.ts` を修正してから再度 `npm test` を実行します。
3. divizero 接続が失敗する場合は、[extensionBridge.ts](/C:/Users/tduka/divizero/src/services/extensionBridge.ts) の `APP_PING` / `GET_PROMPT` / `OS0_IMPORT` / `OS1_IMPORT` が生きているかを確認します。
4. Gemini 側で下書きが入らない場合も、送信自動化は行わず、`Ctrl+V` とパネルの `取込` だけで継続できます。
