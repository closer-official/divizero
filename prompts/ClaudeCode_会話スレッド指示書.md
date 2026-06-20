# 会話スレッド機能実装指示書（S2以降の会話継続）

## 背景・解決する問題

現在のタッチ設計はS1-L（一方向接触→反応待ち）専用。
テキスト返信が来て会話が成立した場合（S2以降）の複数往復を記録・管理する機能がない。

例）
- 自分：「決断を先にして不安と戦う…刺さりました」（IG ストーリー返信）
- 相手：「ありがとうございます！僕も最初はそっちでした！」
- 自分：「そこから抜け出したきっかけって何かありましたか？…」
- 相手：「ここの会社入った時ですね！」← 既読7時間前、次どうする？

この状態でOS②を回したいが、会話ログを入力する場所がない。

---

## 設計方針

テキスト返信が来た瞬間、タッチが「会話スレッド」に昇格する。
スレッドは自分/相手が交互に積み重なるチャットUIで、ターンごとにOS②プロンプトを生成できる。
OS②の出力から返信案A/Bをパースして、「使う」ボタンで次の自分ターンの下書きにする。

```
タッチ（S1-L）
　↓ テキスト返信選択で昇格
会話スレッド（S2〜）
　├ [自分] S1で送った文
　├ [相手] テキスト返信（昇格のきっかけ）
　├ [自分] 次に送った文
　└ [相手] 最新の返信 ← 既読〇時間
　
　[OS②プロンプトをコピー] ← 会話ログが自動埋め込まれる
　↓ AI出力を貼り付け
　[⚡ 返信案を取り込む]
　
　返信案 A（前進案）：…  [使う]
　返信案 B（安全案）：…  [使う]
　
　判定：前進　今やってはいけないこと：…
```

---

## データモデル

### Touch への追加フィールド

```typescript
interface Touch {
  // ...既存フィールド

  // 会話スレッド（テキスト返信が来た時点で初期化）
  threadStatus: 'inactive' | 'active' | 'closed';
  conversationTurns: ConversationTurn[];

  // スレッド集計（OS②入力フィールドの自動算出に使う）
  repExchangeCount: number;    // リプ往復数
  dmExchangeCount: number;     // DM往復数
}

interface ConversationTurn {
  id: string;
  role: '自分' | '相手';
  text: string;
  timestamp: Timestamp;
  channel: 'リプ' | 'DM';     // この返信はリプかDMか

  // 自分ターンのみ：OS②結果
  os2Judgment?: string;        // 前進/維持/休眠/クローズ/対象再選定
  os2SuggestedA?: string;      // 返信案A（前進案）
  os2SuggestedB?: string;      // 返信案B（安全案）
  os2NextAction?: string;      // 次アクション
  os2Warning?: string;         // 今やってはいけないこと
  os2RawOutput?: string;       // フル出力

  // 自分ターンのみ：送信管理
  sentStatus: 'draft' | 'sent' | 'skipped';
  sentAt?: Timestamp;
}
```

---

## スレッド昇格フロー

### トリガー：タッチの反応選択で「テキスト返信」を選んだとき

現在の「反応を記録」分岐A（テキスト返信 → OS②展開）を拡張する。

1. `threadStatus: 'active'` にセットする
2. 最初の自分ターンを追加する（このタッチのactualSentTextが初回自分ターン）
3. テキスト返信の内容を入力するフィールドを表示する
4. 入力された相手の返信を最初の相手ターンとして追加する
5. スレッドUIに切り替える

```typescript
// テキスト返信を選択したときの処理
async function handleTextReplySelected(touchId: string, replyText: string) {
  // 既存の自分ターン（actualSentText）を初回ターンとして登録
  const selfTurn: ConversationTurn = {
    id: generateId(),
    role: '自分',
    text: touch.actualSentText,
    timestamp: touch.date,
    channel: touch.channel === 'DM' ? 'DM' : 'リプ',
    sentStatus: 'sent',
  };

  // 相手の返信を相手ターンとして登録
  const replyTurn: ConversationTurn = {
    id: generateId(),
    role: '相手',
    text: replyText,
    timestamp: serverTimestamp(),
    channel: touch.channel === 'DM' ? 'DM' : 'リプ',
    sentStatus: 'sent', // roleが相手の場合は使わないが一貫性のため
  };

  await updateDoc(touchRef, {
    threadStatus: 'active',
    conversationTurns: [selfTurn, replyTurn],
    repExchangeCount: touch.channel !== 'DM' ? 1 : 0,
    dmExchangeCount: touch.channel === 'DM' ? 1 : 0,
    reactionType: 'テキスト返信',
    status: 'reacted',
  });
}
```

---

## スレッドUI

### 表示レイアウト

タッチカードを展開したとき、スレッドがある場合はタッチ履歴の代わりに会話スレッドを表示する。

```
┌──────────────────────────────────┐
│ @yxxgom | DM | S3               │
│ 会話継続中 · 4往復               │
├──────────────────────────────────┤
│                                  │
│  決断を先にして不安と戦う…      │  ← 自分（右寄せ・紫）
│  木 23:12                        │
│                                  │
│  ありがとうございます！          │  ← 相手（左寄せ・グレー）
│  僕も最初はそっちでした！        │
│  金 13:59受信                    │
│                                  │
│  そこから抜け出したきっかけって  │  ← 自分
│  何かありましたか？…             │
│  金 13:59                        │
│                                  │
│  ここの会社入った時ですね！      │  ← 相手
│  土 18:45 ⏱ 既読7時間          │  ← 既読経過時間
│                                  │
├──────────────────────────────────┤
│ [OS②プロンプトをコピー]         │
│ ↓ ChatGPT等で実行 → 出力を貼る  │
│ ┌──────────────────────────────┐ │
│ │ AI出力をここに貼り付け        │ │
│ └──────────────────────────────┘ │
│ [⚡ 返信案を取り込む]            │
│                                  │
│ ─────────────────────────────── │
│                                  │
│ 返信案（タップで下書きにコピー） │
│ A 前進案：…          [使う]     │
│ B 安全案：…          [使う]     │
│                                  │
│ 判定：前進                        │
│ 今やってはいけないこと：…        │
│                                  │
│ ─────────────────────────────── │
│                                  │
│ 下書き                           │
│ ┌──────────────────────────────┐ │
│ │（「使う」で文が入る・手編集可）│ │
│ └──────────────────────────────┘ │
│ [✈ 送信完了として追加]          │
│                                  │
│ ─────────────────────────────── │
│ [+ 相手の返信を追加]             │  ← 送信後に相手の返信が来たら
└──────────────────────────────────┘
```

### 既読経過時間の表示

相手の最新ターンに「既読経過時間」を表示する：
- 既読 < 1時間：「既読○分」
- 既読 1〜24時間：「既読○時間」
- 既読 > 24時間：「既読○日」→ R4（既読スルー48h）の警告バッジを出す

```typescript
function getReadAgoLabel(timestamp: Timestamp): string {
  const diffMs = Date.now() - timestamp.toMillis();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return `既読${Math.floor(diffH * 60)}分`;
  if (diffH < 24) return `既読${Math.floor(diffH)}時間`;
  return `既読${Math.floor(diffH / 24)}日`;
}

// R4警告：既読から48時間以上経過
const isR4 = diffH >= 48;
```

---

## OS②プロンプト生成（会話モード）

### `src/utils/os2Prompt.ts` を作成

```typescript
export async function buildOS2ConversationPrompt(
  caseData: Case,
  touch: Touch
): Promise<string> {
  const template = await fetch('/prompts/OS2_行動判定_latest.md').then(r => r.text());

  const turns = touch.conversationTurns ?? [];
  const replyTurns = turns.filter(t => t.role === '相手');
  const selfTurns = turns.filter(t => t.role === '自分' && t.sentStatus === 'sent');
  const lastTurn = turns[turns.length - 1];
  const lastReply = replyTurns[replyTurns.length - 1];

  // 往復数の算出
  const repCount = touch.repExchangeCount ?? 0;
  const dmCount = touch.dmExchangeCount ?? 0;

  // 最終接触からの経過日数
  const lastTimestamp = lastTurn?.timestamp;
  const daysSince = lastTimestamp
    ? Math.floor((Date.now() - lastTimestamp.toMillis()) / (1000 * 60 * 60 * 24))
    : 0;

  // 相手の最新反応の質を推定
  const lastReplyText = lastReply?.text ?? '';
  const hasQuestion = /[？?]/.test(lastReplyText);
  const reactionQuality = hasQuestion ? '質問あり' : '受け答えのみ';

  // 会話ログのフォーマット（OS②入力の末尾に追加）
  const conversationLog = turns.map((turn, i) => {
    const label = turn.role === '自分'
      ? `【自分｜送信${selfTurns.indexOf(turn) + 1}（${formatDate(turn.timestamp)}）】`
      : `【相手｜返信${replyTurns.indexOf(turn) + 1}（${formatDate(turn.timestamp)}）】`;
    return `${label}\n${turn.text}`;
  }).join('\n\n');

  // OS②の入力フィールドを自動組み立て
  const inputBlock = `
【案件名】${caseData.accountName}（@${caseData.handle}）
【現在ステップ】${caseData.currentStep}
【往復回数】リプ往復：${repCount}回　DM往復：${dmCount}回
【S1接触数】${caseData.s1Count}回
【相手の微反応】いいね返り：${caseData.likeReturnCount}回（うち直近連続${caseData.likeReturnStreak}回）／ フォロー返し：${caseData.followReturned ? '有' : '無'}
【最終接触からの経過】${daysSince}日
【赤信号】（AIが下記会話ログから判定する）
【相手の最新反応タイプ】テキスト返信
【相手反応の質】${reactionQuality}
【事前仮説との照合】不明
【会話ログ】
${conversationLog}
`.trim();

  // テンプレートの【入力情報】：の後に inputBlock を挿入
  return template.replace('【入力情報】：', `【入力情報】：\n${inputBlock}`);
}
```

---

## OS②出力パース（会話モード）

```typescript
export interface OS2ConversationResult {
  judgment: string;          // 前進/維持/休眠/クローズ/対象再選定
  nextAction: string;
  deadline: string;
  suggestedA: string;        // 案A（前進案）
  suggestedB: string;        // 案B（安全案）
  warning: string;           // 今やってはいけないこと
  rawOutput: string;
}

export function parseOS2Output(raw: string): OS2ConversationResult | null {
  const pick = (label: string): string => {
    const m = raw.match(new RegExp(`【${label}】([\\s\\S]*?)(?=【|$)`));
    return m ? m[1].trim() : '';
  };

  const replyBlock = raw.match(/【次の返信案】([\s\S]*?)(?=【今やってはいけない|$)/)?.[1] ?? '';
  const suggestedA = replyBlock.match(/案A[（(]前進案[）)]\s*[：:]\s*(.+)/)?.[1]?.trim() ?? '';
  const suggestedB = replyBlock.match(/案B[（(]安全案[）)]\s*[：:]\s*(.+)/)?.[1]?.trim() ?? '';

  const judgment = pick('判定');
  if (!judgment) return null;

  return {
    judgment,
    nextAction: pick('次アクション'),
    deadline: pick('実行期限'),
    suggestedA,
    suggestedB,
    warning: pick('今やってはいけないこと'),
    rawOutput: raw,
  };
}
```

---

## 「使う」→「送信完了として追加」フロー

```typescript
// 返信案を選択して「使う」
function handleUseSuggestion(text: string) {
  setDraftText(text); // 下書き欄に入れる（手編集可）
}

// 「✈ 送信完了として追加」
async function handleAddSelfTurn(touchId: string, text: string, os2Result: OS2ConversationResult) {
  const newTurn: ConversationTurn = {
    id: generateId(),
    role: '自分',
    text,
    timestamp: serverTimestamp(),
    channel: determineChannel(caseData), // リプかDMか
    sentStatus: 'sent',
    sentAt: serverTimestamp(),
    os2Judgment: os2Result.judgment,
    os2SuggestedA: os2Result.suggestedA,
    os2SuggestedB: os2Result.suggestedB,
    os2NextAction: os2Result.nextAction,
    os2Warning: os2Result.warning,
    os2RawOutput: os2Result.rawOutput,
  };

  // 往復数を更新
  const isRep = newTurn.channel === 'リプ';
  await updateDoc(touchRef, {
    conversationTurns: arrayUnion(newTurn),
    repExchangeCount: isRep ? increment(1) : touch.repExchangeCount,
    dmExchangeCount: !isRep ? increment(1) : touch.dmExchangeCount,
    lastTouchedAt: serverTimestamp(),
  });

  // 案件のcurrentStepも更新
  await updateDoc(caseRef, {
    currentStep: os2Result.judgment === '前進' ? advanceStep(caseData.currentStep) : caseData.currentStep,
    updatedAt: serverTimestamp(),
  });
}

// 「+ 相手の返信を追加」
async function handleAddReplyTurn(touchId: string, text: string, channel: string) {
  const replyTurn: ConversationTurn = {
    id: generateId(),
    role: '相手',
    text,
    timestamp: serverTimestamp(),
    channel,
    sentStatus: 'sent',
  };
  await updateDoc(touchRef, {
    conversationTurns: arrayUnion(replyTurn),
    lastTouchedAt: serverTimestamp(),
    status: 'awaiting_reaction', // また自分の番待ち状態に戻す
  });
}
```

---

## 既存の「分岐A（テキスト返信→OS②）」との統合

現在の実装（タッチOS2統合指示書で実装済み）：
- テキスト返信を選ぶ → 会話ログ欄＋OS②プロンプトが展開

これを以下に置き換える：
- テキスト返信を選ぶ → **相手の返信テキストを入力させる** → スレッドを初期化 → スレッドUIに切り替える

旧の「会話ログ欄をそのままテキストで貼る」フォームは削除する。
スレッドUIがそのまま会話ログになるため、手入力不要。

---

## MDエクスポートへの反映

ClaudeCode_MDエクスポート指示書の `exportCaseMd` 関数に会話スレッドを追加する：

```typescript
// タッチセクションに会話スレッドを追加
if (touch.threadStatus === 'active' && touch.conversationTurns?.length) {
  md += `\n#### 会話スレッド\n\n`;
  touch.conversationTurns.forEach(turn => {
    const prefix = turn.role === '自分' ? '▶ 自分' : '◀ 相手';
    md += `**${prefix}**（${formatDate(turn.timestamp)}）\n${turn.text}\n\n`;
    if (turn.os2Judgment) {
      md += `　OS②判定：${turn.os2Judgment} / 次アクション：${turn.os2NextAction}\n`;
      md += `　返信案A：${turn.os2SuggestedA}\n`;
      md += `　返信案B：${turn.os2SuggestedB}\n\n`;
    }
  });
}
```

---

## 実装順

1. `ConversationTurn` 型定義・Touchデータモデル更新
2. テキスト返信選択時の「相手返信入力フィールド」表示
3. `handleTextReplySelected`：スレッド初期化
4. スレッドUI（チャットバブル・既読経過時間・R4警告）
5. `src/utils/os2Prompt.ts`：OS②プロンプト生成（会話モード）
6. `parseOS2Output`：返信案A/B・判定のパース
7. 返信案A/Bの選択UI（「使う」ボタン）・下書き欄
8. `handleAddSelfTurn`：送信完了として自分ターン追加
9. `handleAddReplyTurn`：相手ターン追加（「+ 相手の返信を追加」）
10. `currentStep` の自動更新（前進判定時）
11. MDエクスポートへの会話スレッド反映
12. 旧「分岐A：会話ログ手入力フォーム」の削除

---

## 注意事項

- 会話スレッドは1タッチに1つだけ（S1の接触が1つの案件の会話の起点）
- `conversationTurns` は追記のみ（削除・編集は別途検討）
- R4（既読スルー48h）はUIの警告表示のみ。自動でクローズしない
- `advanceStep` の実装：S1→S2、S2→S3、S3→S4、S4→S5、S5は変更しない
- OS②プロンプトの【赤信号】はAI側に判定させる（会話ログからR1〜R5を自動検出させる）
