# Claude Code向け：Gemini接続不具合の調査・修正指示書

## 目的

現在の `salesos-extension` は、X の取得から Gemini 下書き作成までは進むものの、**Gemini 画面上で下書き反映が安定せず、取込後も次工程へ進まない**状態です。

この依頼では、まず原因を特定し、必要最小限の修正で「OS①まで実行 → Geminiへ移動 → 下書きが見える/貼れる → 送信 → 取込」の流れを安定させてください。

**修正はしてよいですが、Git commit / push / deploy はしないでください。**

---

## 対象リポジトリ

`C:\Users\tduka\divizero`

---

## 現在の観測事実

### 1. `localhost` 側

- 開発サーバーは再起動で止まることがあり、`http://localhost:5173/` が `ERR_CONNECTION_REFUSED` になることがある
- ただし `npm run dev` を再起動すると復帰する

### 2. popup 側

- `divizero接続: OK` は表示される
- `OS0取得` 件数も増える
- `OS①まで実行` 自体は押せる

### 3. Gemini 側

- Gemini タブへは飛ぶ
- 右下の拡張パネルは出る
- ただし、**下書きが見えない / `下書き文字数` が出ない / 実際に入力欄へ反映された感じが薄い**
- `取込` を押すと、主に「出力のコピーボタンを押してから取込してください」という趣旨のメッセージになる
- つまり、**Gemini の回答を取り込む前の段階で止まっている**

### 4. これまでの対処歴

- Gemini content script の再注入
- listener 二重登録防止
- popup の X ページ警告
- Gemini パネルの draft 表示強化
- Gemini タブ再利用時の reload 追加
- `salesos-extension/dist` の再生成

それでもまだ不安定です。

---

## まず読むファイル

1. `C:\Users\tduka\divizero\salesos-extension\src\background.ts`
2. `C:\Users\tduka\divizero\salesos-extension\src\content\gemini.ts`
3. `C:\Users\tduka\divizero\salesos-extension\src\content\divizero.ts`
4. `C:\Users\tduka\divizero\salesos-extension\src\popup\popup.ts`
5. `C:\Users\tduka\divizero\src\services\extensionBridge.ts`
6. `C:\Users\tduka\divizero\src\App.tsx`
7. `C:\Users\tduka\divizero\salesos-extension\src\shared\protocol.ts`
8. `C:\Users\tduka\divizero\salesos-extension\src\shared\storage.ts`

---

## 最優先の確認ポイント

### A. Gemini へ渡している下書きが本当に存在するか

- `background.ts` の `state.currentDraft` が空でないか
- `GET_PROMPT` が空文字を返していないか
- `GEMINI_PREPARE` に送っている `draftText` が本当に入っているか
- `prepareGemini()` 実行時に、Gemini タブへ送る内容が失われていないか

### B. Gemini content script が正しく動いているか

- `chrome.tabs.sendMessage()` が届いているか
- content script が古いまま残っていないか
- `ensureTab()` で再利用したタブに対して `reload()` が必要か
- `document.querySelectorAll('div[contenteditable="true"], textarea, input[type="text"]')` が Gemini 画面に合っているか
- `insertDraft()` の結果が false になっていないか

### C. 取込フローが正しく進んでいるか

- `GEMINI_CAPTURED` が background に届いているか
- `phase` が `OS0_GEMINI → OS0_IMPORT` または `OS1_GEMINI → OS1_IMPORT` に遷移しているか
- `OS0_IMPORT` / `OS1_IMPORT` の前提条件で止まっていないか

### D. localhost 停止の扱い

- `localhost:5173` が止まっていたら、まず開発サーバーを再起動してから作業すること
- `divizero.vercel.app` に飛んでしまう場合は、ローカル側の確認を優先すること

---

## 期待する最終状態

1. `http://localhost:5173/` を開ける
2. X の検索結果かフォロワー一覧から `OS①まで実行` を押せる
3. Gemini へ移動したとき、右下パネルに
   - 下書き本文が見える
   - もしくは少なくとも `下書き文字数: ...` が見える
4. Gemini の入力欄に下書きが反映される
5. 人間が送信した後、拡張の `取込` で次工程へ進める
6. OS⓪ / OS① のどちらでも同じ流れで安定する

---

## 変更してよい範囲

- `salesos-extension/src/background.ts`
- `salesos-extension/src/content/gemini.ts`
- `salesos-extension/src/content/divizero.ts`
- `salesos-extension/src/popup/popup.ts`
- `salesos-extension/src/shared/protocol.ts`
- `salesos-extension/src/shared/storage.ts`
- `salesos-extension/esbuild.config.mjs`
- `salesos-extension/tsconfig.json`
- 必要なら `src/services/extensionBridge.ts` と `src/App.tsx` の最小修正

---

## 変更しないでほしい範囲

- Firestore / localStorage / Auth の仕様
- プロンプト本文の大きな見直し
- 既存データの保存形式
- `dist/` の手編集
- commit / push / deploy
- 送信自動化や Gemini API 呼び出しの追加

---

## 調査の進め方

### 1. 再現

実際に以下を通して、どこで止まるかを確認してください。

1. `http://localhost:5173/` を開く
2. X の検索結果かフォロワー一覧を開く
3. 拡張の `OS①まで実行` を押す
4. Gemini に飛ぶ
5. 右下パネルの状態を確認する
6. `取込` を押した後の挙動を確認する

### 2. ログ・状態確認

必要なら一時的にログを入れてかまいません。確認したいのは以下です。

- background が何を受け取っているか
- Gemini content script が本当に注入されているか
- 下書き文字列が途中で空になっていないか
- タブ再利用時に古い listener が残っていないか

### 3. 最小修正

修正は大きく広げず、まずは以下のどれかに絞ってください。

- タブ再利用時の強制再読込
- Gemini content script の再初期化条件の見直し
- `draftText` の受け渡しと表示の見直し
- `取込` の前提条件の見直し

### 4. 検証

最低限、次を確認してください。

```bash
& 'C:\\Program Files\\nodejs\\npm.cmd' run build
node C:\\Users\\tduka\\divizero\\salesos-extension\\test\\run-tests.mjs
```

`localhost` が落ちていたら、開発サーバーも再起動して確認してください。

---

## 報告してほしい内容

修正後は、以下を短く報告してください。

- どこが原因だったか
- どのファイルを直したか
- Gemini 画面で何が改善したか
- まだ残る不安要素があるか
- build / test の結果

---

## いちばん大事な判断基準

この作業で重視したいのは、「見た目だけではなく、**次に何を押せば進むかが毎回わかる**こと」です。
Gemini の自動送信はしないままで、**人間が送信ボタンを押す運用**は維持してください。

