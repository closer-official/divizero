# 承認済み修正の適用ガイド（P1 → P2 → CLAUDE.md矛盾修正）

## 同梱ファイルと適用先

| 同梱ファイル | 適用先 | 適用方法 |
|---|---|---|
| OS2_行動判定_latest.md | public/prompts/OS2_行動判定_latest.md | 上書き → `npm run deploy -- -m "OS2分岐を適合度+セグメント基準へ"` |
| parser.ts | src/utils/parser.ts | 上書き（追加のみ・既存関数のシグネチャ不変） |
| CLAUDE.md | リポジトリ直下 CLAUDE.md | 上書き |

## 各修正の内容と証拠

### P1: OS2_行動判定_latest.md（プロンプトのみ・コード変更不要）
- 【営業期待値スコア】入力欄を削除（供給源が消滅していたため。parser.ts extractSalesExp は常に undefined）
- S1-L「判定値の対応」5行をスコア閾値（35点/34点/80点）から「UTAGE優先/案件適合度」基準へ書き換え。同ファイル冒頭の【DM移行新基準】（条件式）およびループ上限節と完全整合
- 検証：`grep 営業期待値\|80点` → 残存ゼロ

### P2: parser.ts
- 追加：`parseOS2StateDirective()` — [SLEEP]/[ARCHIVE]/[CLOSE] 行から state・契機・再接触トリガー・案件IDを抽出し、再接触日を自動算出（休眠=+30日、保管=+180日。CLAUDE.mdの目安 sleeping 1〜3ヶ月 / archived 半年以上 の下限に準拠）
- 追加：`parseOS2()` の戻り値に `stateDirective`（該当なしは null）。既存フィールドは一切変更なし
- 検証：テストハーネス16件 ALL PASS（休眠/保管/クローズ/前進の4系統＋既存フィールド非破壊）、`tsc --noEmit --strict` エラーゼロ

### CLAUDE.md（矛盾3件のみ・200行化は未承認のため未実施、現在254行）
1. state に `meeting_scheduled` を追記＋状態説明＋起動時チェック記述を App.tsx L117/L131 に整合
2. Track に `UT` を追記。あわせて旧記述「FT＝DM直行」が現行 OS1_X プロンプト（L69: UTでもDM直行禁止、L75: FT=優先認知維持）と矛盾していたため同一行内で修正
3. 「The six tabs」→「The eight tabs」。TabHome / Tab6 / services/home/homeTypes.ts を構造図と節に追記

## 残作業（未承認・Claude Code への委譲指示案）

### Tab2 への stateDirective 配線（P2の後半・承認後に実施）
- 対象：src/components/tabs/Tab2.tsx（OS2出力の貼付保存処理）
- やること：保存時に `parsed.stateDirective` が非null なら確認ダイアログ（confirm API）で
  「判定=休眠です。state を sleeping に変更し、再接触日を 2026-08-02 に設定しますか？（日付は変更可）」
  を表示し、承認で `item.state` と `item.recontact_date` を更新。closed の場合は既存の handleCloseCase 経路に合流
- やらないこと：既存の手動 state 変更UIの削除・判定ロジックの変更
- 完了条件：休眠判定の貼付→承認→App.tsx 起動時チェックでトースト通知が発火すること
- 担当モデル：Sonnet（実装）。os2Prompt.ts が独自に [SLEEP] を拾っていないかの事前確認は Haiku
- 注意：os2Prompt.ts の入力テンプレートに「営業期待値スコア」行が残っていれば削除（P1との整合）

### 未着手のまま残っている監査指摘（承認待ち）
- T3: parseOS2 replyA の「次の接触条件」誤キャプチャ修正
- Firestore セキュリティルール確認（監査2-A2・最優先の要確認）
- CLAUDE.md の200行化、OS0/OS3 の Human-Check 削除、除外リスト圧縮 ほか
