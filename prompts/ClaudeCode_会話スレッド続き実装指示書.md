# 会話スレッド続き実装指示書（手順5〜9）

## 前提・現状確認

`ClaudeCode_会話スレッド指示書.md` の手順1〜4は実装済み。
- conversationTurns にデータが入っている
- チャットバブルUI（自分：右紫／相手：左グレー）が表示されている
- 「会話スレッド リプ1往復」バッジが出ている

**未実装（今回の対象）：手順5〜9**

スレッドの最後のターンが「相手」の場合に、自分が次の返信を作れるUIが存在しない。
以下を実装する。

---

## 実装前に必ず読むこと

1. 既存コードを読んでから書く
2. 変更ファイルを明示する
3. データモデルは変更しない（ConversationTurn型はすでに定義済みのはず。なければ指示書から転記）

---

## 手順5：OS②プロンプト生成ユーティリティ

### 作成ファイル：`src/utils/os2Prompt.ts`

```typescript
import { Case, Touch, ConversationTurn } from '../types';
import { Timestamp } from 'firebase/firestore';

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return '日時不明';
  return ts.toDate().toLocaleDateString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

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

  const repCount = touch.repExchangeCount ?? 0;
  const dmCount = touch.dmExchangeCount ?? 0;

  const lastTimestamp = lastTurn?.timestamp;
  const daysSince = lastTimestamp
    ? Math.floor((Date.now() - lastTimestamp.toMillis()) / (1000 * 60 * 60 * 24))
    : 0;

  const lastReplyText = lastReply?.text ?? '';
  const hasQuestion = /[？?]/.test(lastReplyText);
  const reactionQuality = hasQuestion ? '質問あり' : '受け答えのみ';

  const conversationLog = turns.map((turn) => {
    const selfIdx = selfTurns.indexOf(turn);
    const replyIdx = replyTurns.indexOf(turn);
    const label = turn.role === '自分'
      ? `【自分｜送信${selfIdx + 1}（${formatDate(turn.timestamp)}）】`
      : `【相手｜返信${replyIdx + 1}（${formatDate(turn.timestamp)}）】`;
    return `${label}\n${turn.text}`;
  }).join('\n\n');

  const inputBlock = `
【案件名】${caseData.accountName}（@${caseData.handle}）
【現在ステップ】${caseData.currentStep}
【往復回数】リプ往復：${repCount}回　DM往復：${dmCount}回
【S1接触数】${caseData.s1Count ?? 0}回
【相手の微反応】いいね返り：${caseData.likeReturnCount ?? 0}回（うち直近連続${caseData.likeReturnStreak ?? 0}回）／ フォロー返し：${caseData.followReturned ? '有' : '無'}
【最終接触からの経過】${daysSince}日
【赤信号】（AIが下記会話ログから判定する）
【相手の最新反応タイプ】テキスト返信
【相手反応の質】${reactionQuality}
【事前仮説との照合】不明
【会話ログ】
${conversationLog}
`.trim();

  return template.replace('【入力情報】：', `【入力情報】：\n${inputBlock}`);
}
```

---

## 手順6：OS②出力パース

### 追記ファイル：`src/utils/os2Prompt.ts`（上記ファイルに追記）

```typescript
export interface OS2ConversationResult {
  judgment: string;       // 前進/維持/休眠/クローズ/対象再選定
  nextAction: string;
  deadline: string;
  suggestedA: string;
  suggestedB: string;
  warning: string;
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

## 手順7〜9：スレッドUI下部の実装

### 変更ファイル：会話スレッドを表示しているコンポーネント（既存を読んで特定する）

スレッドのチャットバブル表示の**直下**に以下のブロックを追加する。

### 表示条件

`turns[turns.length - 1]?.role === '相手'` のときのみ表示する。
（最後のターンが自分の場合は「相手の返信待ち」なので表示しない）

### 追加するUI構造

```
────────────────────────────────
[OS②プロンプトをコピー]

AI出力をここに貼り付け
┌─────────────────────────────┐
│                             │
└─────────────────────────────┘
[⚡ 返信案を取り込む]

────────────────────────────────

（取り込み後に表示）
返信案 A（前進案）
{suggestedA のテキスト}          [使う]

返信案 B（安全案）
{suggestedB のテキスト}          [使う]

判定：{judgment}　期限：{deadline}
今やってはいけないこと：{warning}

────────────────────────────────

下書き
┌─────────────────────────────┐
│（「使う」で入る・手編集可）   │
└─────────────────────────────┘
[✈ 送信完了として追加]

────────────────────────────────
[+ 相手の返信を追加]
```

### Reactコンポーネント実装

```typescript
// スレッド下部に追加するブロック（コンポーネント内のローカルstate）

const [aiRawOutput, setAiRawOutput] = useState('');
const [os2Result, setOs2Result] = useState<OS2ConversationResult | null>(null);
const [draftText, setDraftText] = useState('');
const [addReplyText, setAddReplyText] = useState('');
const [showAddReply, setShowAddReply] = useState(false);

// OS②プロンプトをコピー
async function handleCopyOS2Prompt() {
  const prompt = await buildOS2ConversationPrompt(caseData, touch);
  await navigator.clipboard.writeText(prompt);
  // コピー完了トースト等を表示
}

// 返信案を取り込む
function handleParseOutput() {
  const result = parseOS2Output(aiRawOutput);
  if (result) {
    setOs2Result(result);
  } else {
    // パース失敗のエラー表示
  }
}

// 「使う」ボタン
function handleUseSuggestion(text: string) {
  setDraftText(text);
}

// 「✈ 送信完了として追加」
async function handleAddSelfTurn() {
  if (!draftText.trim()) return;

  const newTurn: ConversationTurn = {
    id: crypto.randomUUID(),
    role: '自分',
    text: draftText.trim(),
    timestamp: Timestamp.now(),
    channel: touch.channel === 'DM' ? 'DM' : 'リプ',
    sentStatus: 'sent',
    sentAt: Timestamp.now(),
    os2Judgment: os2Result?.judgment,
    os2SuggestedA: os2Result?.suggestedA,
    os2SuggestedB: os2Result?.suggestedB,
    os2NextAction: os2Result?.nextAction,
    os2Warning: os2Result?.warning,
    os2RawOutput: os2Result?.rawOutput,
  };

  const isRep = newTurn.channel === 'リプ';
  await updateDoc(touchRef, {
    conversationTurns: arrayUnion(newTurn),
    repExchangeCount: isRep ? increment(1) : (touch.repExchangeCount ?? 0),
    dmExchangeCount: !isRep ? increment(1) : (touch.dmExchangeCount ?? 0),
    lastTouchedAt: Timestamp.now(),
  });

  // 案件のcurrentStepを更新（前進判定のとき）
  if (os2Result?.judgment === '前進') {
    const nextStep = advanceStep(caseData.currentStep);
    await updateDoc(caseRef, {
      currentStep: nextStep,
      updatedAt: Timestamp.now(),
    });
  }

  // stateリセット
  setDraftText('');
  setAiRawOutput('');
  setOs2Result(null);
  setShowAddReply(true); // 送信完了後に「+ 相手の返信を追加」を出す
}

// 「+ 相手の返信を追加」
async function handleAddReplyTurn() {
  if (!addReplyText.trim()) return;

  const replyTurn: ConversationTurn = {
    id: crypto.randomUUID(),
    role: '相手',
    text: addReplyText.trim(),
    timestamp: Timestamp.now(),
    channel: touch.channel === 'DM' ? 'DM' : 'リプ',
    sentStatus: 'sent',
  };

  await updateDoc(touchRef, {
    conversationTurns: arrayUnion(replyTurn),
    lastTouchedAt: Timestamp.now(),
  });

  setAddReplyText('');
  setShowAddReply(false);
}

// ステップ進行ヘルパー
function advanceStep(current: string): string {
  const order = ['S1', 'S1-L', 'S2', 'S3', 'S4', 'S5'];
  const idx = order.indexOf(current);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : current;
}
```

---

## 動作確認チェックリスト

実装後、以下を順番に確認する：

- [ ] タッチカードを展開すると会話スレッドが表示される
- [ ] 最後のターンが「相手」のとき、スレッド下部に「OS②プロンプトをコピー」ボタンが出る
- [ ] コピーしたプロンプトにcaseData・会話ログが正しく埋め込まれている
- [ ] AI出力を貼り付けて「返信案を取り込む」を押すと、案A・案Bが分離して表示される
- [ ] 「使う」を押すと下書き欄に文章が入る（手編集可能）
- [ ] 「送信完了として追加」を押すと、新しい自分ターンがスレッドに追加される
- [ ] 前進判定のとき、案件のcurrentStepが1つ進む
- [ ] 「+ 相手の返信を追加」で相手ターンを追加できる
- [ ] 追加後、再びスレッド下部に「OS②プロンプトをコピー」が出る（次の往復ができる）
- [ ] 最後のターンが「自分」のとき、OS②ブロックは表示されない（相手返信待ち状態）

---

## 注意事項

- `touchRef` と `caseRef` は既存コードの参照をそのまま使う
- `arrayUnion` と `increment` は `firebase/firestore` からインポート
- パース失敗時はエラーメッセージを表示する（サイレント失敗しない）
- `os2Result` がない状態で「送信完了として追加」を押せてしまわないよう、ボタンを非活性にするか確認ダイアログを出す
