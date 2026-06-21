# 会話スレッド機能実装指示書 v2

## この指示書の位置づけ

既存の `ClaudeCode_会話スレッド指示書.md` を完全に置き換える。
アーキテクチャを以下に変更する：

**旧：** OS②が判定と文生成（案A/案B）を両方担当
**新：**
- DM文生成OS → 毎ターンの文を書く（判定しない）
- OS② → チェックポイントのみ判定する（案A/案Bは廃止）

---

## 設計の全体像

```
タッチ（S1/S1-L）            会話スレッド（S2〜）
─────────────────────────────────────────────────
新規投稿モード               会話スレッドモード
・接触した投稿               ・チャットUI（ターン積み上げ）
・投稿種別                   ・[DM文生成プロンプトをコピー]（毎ターン）
・対象妥当性                 ・[OS②で判定]（チェックポイントのみ）
                             ・下書き欄 → 送信完了で追加
                             ・[＋ 相手の返信を追加]
```

会話スレッドに入る3つのエントリー：
1. **S1-L昇格**：既存タッチでテキスト返信を選択した時点でスレッドに昇格
2. **S3直行**（IGストーリー返信起点）：新規スレッドを直接作成（S1タッチなし）
3. **ログ復元**：TSX移行等でログが失われた案件を手入力で再構築

---

## データモデル

### Touch の追加・変更フィールド

```typescript
interface Touch {
  // ─── 既存フィールド（変更なし）───
  id: string;
  caseId: string;
  date: Timestamp;
  targetPostText: string;
  targetPostType: string;
  targetValidity: '◯' | '△' | '✕' | '未評価';
  suggestedTextA?: string;
  suggestedTextB?: string;
  provisionalJudgmentA?: string;
  provisionalJudgmentB?: string;
  actualSentText: string;
  editReason?: string;
  messageValidity: '◯' | '△' | '✕' | '未判定';
  reactionType?: string;
  reactionNote?: string;
  // ─── 廃止フィールド ───
  // os2Judgment, os2NextAction → ConversationTurn に移動
  // ─── 追加フィールド ───
  touchMode: 'post' | 'conversation';
  // 'post'       = S1/S1-L 新規投稿タッチ（既存挙動）
  // 'conversation' = 会話スレッド（S2〜）
  threadEntry?: 's1l_promotion' | 's3_direct' | 'log_restore';
  // s1l_promotion = 既存タッチのテキスト返信でスレッドに昇格
  // s3_direct     = IGストーリー返信起点でS3直行
  // log_restore   = 消えたログを手入力で復元
  threadStatus?: 'inactive' | 'active' | 'closed';
  conversationTurns?: ConversationTurn[];
  repExchangeCount?: number;  // リプ往復数（会話スレッドが集計）
  dmExchangeCount?: number;   // DM往復数（会話スレッドが集計）
}

interface ConversationTurn {
  id: string;
  role: '自分' | '相手';
  text: string;
  timestamp: Timestamp;
  channel: 'リプ' | 'DM';
  sentStatus: 'sent' | 'draft' | 'skipped';
  sentAt?: Timestamp;
  // 自分ターンのみ：DM文生成OS結果
  dmConversationState?: '質問あり' | 'クローズ型' | '深掘り余地あり';
  dmSuggestedA?: string;
  dmSuggestedB?: string;
  dmNextAim?: string;
  dmOs2Recommended?: boolean;   // OS②起動推奨フラグ
  dmRawOutput?: string;
  // 自分ターンのみ：OS②結果（チェックポイントのみ記録）
  os2Judgment?: string;         // 前進/維持/休眠/クローズ
  os2NextAction?: string;
  os2Warning?: string;          // 今やってはいけないこと
  os2RawOutput?: string;
}
```

---

## エントリー別の初期化処理

### エントリー①：S1-L昇格（既存タッチ → スレッドへ）

既存の「タッチの反応を記録」フローで「テキスト返信」を選んだ時に起動。

```typescript
async function promoteTouchToThread(
  touchId: string,
  replyText: string,
  channel: 'リプ' | 'DM'
) {
  const touch = await getTouch(touchId);

  // 既存の自分ターン（actualSentText）を初回ターンとして登録
  const selfTurn: ConversationTurn = {
    id: generateId(),
    role: '自分',
    text: touch.actualSentText,
    timestamp: touch.date,
    channel,
    sentStatus: 'sent',
    sentAt: touch.date,
  };

  // 相手の返信を相手ターンとして登録
  const replyTurn: ConversationTurn = {
    id: generateId(),
    role: '相手',
    text: replyText,
    timestamp: serverTimestamp(),
    channel,
    sentStatus: 'sent',
  };

  await updateDoc(touchRef, {
    touchMode: 'conversation',
    threadEntry: 's1l_promotion',
    threadStatus: 'active',
    conversationTurns: [selfTurn, replyTurn],
    repExchangeCount: channel === 'リプ' ? 1 : 0,
    dmExchangeCount: channel === 'DM' ? 1 : 0,
    reactionType: 'テキスト返信',
    status: 'reacted',
  });
}
```

### エントリー②：S3直行（IGストーリー返信起点）

案件カードまたはタッチ追加UIに「DM会話を開始」ボタンを追加。
IGのストーリー返信はそのままDM受信箱に届くため、S1タッチを経由せずスレッドを直接作成する。

```typescript
async function createS3DirectThread(
  caseId: string,
  firstSelfText: string,    // 自分が送ったストーリー返信の文
  firstReplyText: string,   // 相手の返信テキスト
  selfSentAt: Timestamp,
  replyReceivedAt: Timestamp
) {
  const selfTurn: ConversationTurn = {
    id: generateId(),
    role: '自分',
    text: firstSelfText,
    timestamp: selfSentAt,
    channel: 'DM',
    sentStatus: 'sent',
    sentAt: selfSentAt,
  };

  const replyTurn: ConversationTurn = {
    id: generateId(),
    role: '相手',
    text: firstReplyText,
    timestamp: replyReceivedAt,
    channel: 'DM',
    sentStatus: 'sent',
  };

  // Touchドキュメントを新規作成（S1タッチなし）
  await addDoc(touchesCollection, {
    caseId,
    date: selfSentAt,
    touchMode: 'conversation',
    threadEntry: 's3_direct',
    threadStatus: 'active',
    conversationTurns: [selfTurn, replyTurn],
    repExchangeCount: 0,
    dmExchangeCount: 1,
    // 新規投稿タッチのフィールドは空（このモードでは不要）
    targetPostText: '（ストーリー返信起点・投稿なし）',
    targetPostType: 'ストーリー',
    targetValidity: '◯',
    actualSentText: firstSelfText,
    messageValidity: '未判定',
  });

  // 案件のcurrentStepをS3に更新
  await updateDoc(caseRef, {
    currentStep: 'S3',
    updatedAt: serverTimestamp(),
  });
}
```

### エントリー③：ログ復元

TSX移行・データ消失等で会話ログが失われた案件を手入力で再構築する。

**UIフロー：**
1. 案件カードのメニュー（…ボタン）に「会話ログを復元」を追加
2. タップ → ターン追加フォームが表示される（【自分 / 相手】の切り替え + テキスト + 日時）
3. 全ターンを追加完了 → 「復元を確定」で保存

```typescript
async function createLogRestoreThread(
  caseId: string,
  turns: Array<{ role: '自分' | '相手'; text: string; timestamp: Date; channel: 'リプ' | 'DM' }>,
  restoredCurrentStep: string
) {
  const conversationTurns: ConversationTurn[] = turns.map(t => ({
    id: generateId(),
    role: t.role,
    text: t.text,
    timestamp: Timestamp.fromDate(t.timestamp),
    channel: t.channel,
    sentStatus: 'sent',
  }));

  const repCount = turns.filter(t => t.channel === 'リプ').length / 2;
  const dmCount  = turns.filter(t => t.channel === 'DM').length / 2;

  await addDoc(touchesCollection, {
    caseId,
    date: Timestamp.fromDate(turns[0].timestamp),
    touchMode: 'conversation',
    threadEntry: 'log_restore',
    threadStatus: 'active',
    conversationTurns,
    repExchangeCount: Math.floor(repCount),
    dmExchangeCount: Math.floor(dmCount),
    targetPostText: '（ログ復元）',
    targetPostType: 'その他',
    targetValidity: '◯',
    actualSentText: turns.find(t => t.role === '自分')?.text ?? '',
    messageValidity: '未判定',
  });

  await updateDoc(caseRef, {
    currentStep: restoredCurrentStep,
    updatedAt: serverTimestamp(),
  });
}
```

---

## 会話スレッドUI

### レイアウト

```
┌──────────────────────────────────┐
│ @yxxgom | IG | S3                │  ← 案件ヘッダー
│ DM継続中 · 4往復                 │
├──────────────────────────────────┤
│                                  │
│  決断を先にして…       木 23:12  │  ← 自分（右・紫バブル）
│                                  │
│  ありがとうございます！          │  ← 相手（左・グレーバブル）
│  僕も最初はそっちでした！        │
│  金 13:59受信                    │
│                                  │
│  そこから抜け出したきっかけって  │  ← 自分
│  何かありましたか？…  金 13:59  │
│                                  │
│  ここの会社入った時ですね！      │  ← 相手・最新ターン
│  土 18:45  ⏱ 既読7時間         │  ← 経過時間バッジ
│                                  │
├──────────────────────────────────┤
│                                  │
│  [📋 DM文生成プロンプトをコピー] │  ← 毎ターン使うボタン（濃色・大）
│  ↓ Claude/ChatGPT等で実行 → 出力を貼る │
│  ┌──────────────────────────────┐ │
│  │ AI出力をここに貼り付け        │ │  ← ===DM_START=== 〜 ===DM_END===
│  └──────────────────────────────┘ │
│  [⚡ 取り込む]                    │
│                                  │
│  ─────── 取り込み結果 ────────  │
│                                  │
│  提案文A：…           [使う]    │
│  提案文B：…           [使う]    │
│                                  │
│  次の狙い：…                     │
│                                  │
│  ⚠ OS②判定を推奨               │  ← dmOs2Recommended=true のときのみ表示
│  [🔍 OS②で判定する]             │  ← チェックポイントのみ・淡色・小
│                                  │
│  ─────────────────────────────  │
│                                  │
│  下書き                          │
│  ┌──────────────────────────────┐ │
│  │（「使う」で入る・手編集可）   │ │
│  └──────────────────────────────┘ │
│  [✈ 送信完了として追加]          │
│                                  │
│  ─────────────────────────────  │
│  [＋ 相手の返信を追加]           │  ← 送信後に相手返信が来たら
└──────────────────────────────────┘
```

### UIルール

- **[DM文生成プロンプトをコピー]** は常に表示・常に使える（毎ターンの標準動作）
- **[OS²で判定する]** は `dmOs2Recommended: true` のときのみ表示（チェックポイント）。
  それ以外は非表示（DMのOS²ボタンはエラー感を与えないよう目立たせない）。
  ただし案件メニューから「OS²を手動実行」は常に可能にする（隠しオプション）。
- **⚠ OS²判定を推奨** バナーが出たら、ユーザーは無視してDM文生成だけ進めてもよい
  （推奨であって強制ではない）。

### 既読経過時間バッジ

相手の最新ターンに表示：

```typescript
function getReadAgoLabel(timestamp: Timestamp): string {
  const diffMs = Date.now() - timestamp.toMillis();
  const diffH  = diffMs / (1000 * 60 * 60);
  if (diffH < 1)  return `既読${Math.floor(diffH * 60)}分`;
  if (diffH < 24) return `既読${Math.floor(diffH)}時間`;
  return `既読${Math.floor(diffH / 24)}日`;
}

// R4警告（既読48h以上）→ バッジを赤にする
const isR4Warning = diffH >= 48;
```

---

## プロンプト生成（DM文生成OS）

`src/utils/dmPrompt.ts` を作成：

```typescript
export async function buildDMPrompt(
  caseData: Case,
  touch: Touch
): Promise<string> {
  const template = await fetch('/prompts/OS_DM文生成_latest.md').then(r => r.text());

  const turns = touch.conversationTurns ?? [];
  const selfTurns  = turns.filter(t => t.role === '自分');
  const replyTurns = turns.filter(t => t.role === '相手');

  // エントリー種別
  const entryLabel: Record<string, string> = {
    s1l_promotion: 'S1-L昇格',
    s3_direct:     'S3直行（IGストーリー返信起点）',
    log_restore:   'ログ復元',
  };
  const entryType = entryLabel[touch.threadEntry ?? 's1l_promotion'];

  // 会話ログのフォーマット
  const conversationLog = turns.map(turn => {
    const selfIdx  = selfTurns.indexOf(turn);
    const replyIdx = replyTurns.indexOf(turn);
    const label = turn.role === '自分'
      ? `【自分｜送信${selfIdx + 1}（${formatDate(turn.timestamp)}）】`
      : `【相手｜返信${replyIdx + 1}（${formatDate(turn.timestamp)}）】`;
    return `${label}\n${turn.text}`;
  }).join('\n\n');

  // テンプレートに変数を埋め込む
  return template
    .replace('{{accountName}}', caseData.accountName)
    .replace('{{handle}}',      `@${caseData.handle}`)
    .replace('{{channel}}',     caseData.channel)
    .replace('{{track}}',       caseData.track)
    .replace('{{currentStep}}', caseData.currentStep)
    .replace('{{hypothesis}}',  caseData.hypothesis)
    .replace('{{entryType}}',   entryType)
    .replace('{{conversationLog}}', conversationLog);
}
```

---

## 出力パース（DM文生成OS）

`src/utils/dmPrompt.ts` に追加：

```typescript
export interface DMGenerationResult {
  entryType:          string;
  currentStep:        string;
  conversationState:  '質問あり' | 'クローズ型' | '深掘り余地あり' | string;
  suggestedA:         string;
  suggestedB:         string;
  nextAim:            string;
  os2Recommended:     boolean;
  os2Reason:          string;
  rawOutput:          string;
}

export function parseDMOutput(raw: string): DMGenerationResult | null {
  const block = raw.match(/===DM_START===([\s\S]*?)===DM_END===/)?.[1];
  if (!block) return null;

  const pick = (label: string): string => {
    const m = block.match(new RegExp(`${label}:\\s*(.+)`));
    return m ? m[1].trim() : '';
  };

  const os2Field = pick('OS②起動推奨');
  const os2Recommended = os2Field.startsWith('はい');
  const os2Reason = os2Field.replace(/^(はい|いいえ)\s*[—-]\s*/, '').trim();

  return {
    entryType:         pick('エントリー種別'),
    currentStep:       pick('現在ステップ'),
    conversationState: pick('会話状態') as DMGenerationResult['conversationState'],
    suggestedA:        pick('提案文A'),
    suggestedB:        pick('提案文B'),
    nextAim:           pick('次の狙い'),
    os2Recommended,
    os2Reason,
    rawOutput:         raw,
  };
}
```

---

## OS②の呼び出し（チェックポイント）

### チェックポイントとして使うタイミング

アプリがOS②を表示するのは以下のいずれかの場合のみ：
- DM文生成OSの出力で `OS②起動推奨: はい` が出た
- ユーザーが案件メニューから「OS²を手動実行」を選んだ

### OS②プロンプト生成（会話スレッドモード）

`src/utils/os2Prompt.ts` を更新：

```typescript
export async function buildOS2ConversationPrompt(
  caseData: Case,
  touch: Touch
): Promise<string> {
  const template = await fetch('/prompts/OS2_行動判定_latest.md').then(r => r.text());

  const turns = touch.conversationTurns ?? [];
  const selfTurns  = turns.filter(t => t.role === '自分' && t.sentStatus === 'sent');
  const replyTurns = turns.filter(t => t.role === '相手');
  const lastTurn   = turns[turns.length - 1];
  const lastReply  = replyTurns[replyTurns.length - 1];

  const repCount   = touch.repExchangeCount ?? 0;
  const dmCount    = touch.dmExchangeCount ?? 0;

  const daysSince = lastTurn?.timestamp
    ? Math.floor((Date.now() - lastTurn.timestamp.toMillis()) / 86400000)
    : 0;

  const lastReplyText = lastReply?.text ?? '';
  const hasQuestion   = /[？?]/.test(lastReplyText);
  const reactionQuality = hasQuestion ? '質問あり' : '受け答えのみ';

  const conversationLog = turns.map(turn => {
    const selfIdx  = selfTurns.indexOf(turn);
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
【赤信号】（会話ログからR1〜R5を自動検出してください）
【相手の最新反応タイプ】テキスト返信
【相手反応の質】${reactionQuality}
【事前仮説との照合】不明
【会話ログ】
${conversationLog}
`.trim();

  return template.replace('【入力情報】：', `【入力情報】：\n${inputBlock}`);
}
```

### OS②出力パース（会話スレッドモード）

**案A・案Bはパースしない**（DM文生成OSが担当）。
判定・次アクション・警告のみ抽出する。

```typescript
export interface OS2CheckpointResult {
  judgment:   string;   // 前進/維持/休眠/クローズ
  nextAction: string;
  deadline:   string;
  warning:    string;   // 今やってはいけないこと
  logLine:    string;   // [LOG]行
  rawOutput:  string;
}

export function parseOS2CheckpointOutput(raw: string): OS2CheckpointResult | null {
  const pick = (label: string): string => {
    const m = raw.match(new RegExp(`【${label}】([\\s\\S]*?)(?=【|$)`));
    return m ? m[1].trim() : '';
  };

  const logLine = raw.match(/\[LOG\].+/)?.[0] ?? '';
  const judgment = pick('判定');
  if (!judgment) return null;

  return {
    judgment,
    nextAction: pick('次アクション'),
    deadline:   pick('実行期限'),
    warning:    pick('今やってはいけないこと'),
    logLine,
    rawOutput:  raw,
  };
}
```

---

## 「使う」→「送信完了として追加」フロー

```typescript
// DM文生成の「使う」ボタン
function handleUseDMSuggestion(text: string) {
  setDraftText(text); // 下書き欄に入れる（手編集可）
}

// 「✈ 送信完了として追加」
async function handleAddSelfTurn(
  touchId: string,
  text: string,
  dmResult: DMGenerationResult,
  os2Result?: OS2CheckpointResult  // チェックポイントを踏んだ場合のみ
) {
  const newTurn: ConversationTurn = {
    id: generateId(),
    role: '自分',
    text,
    timestamp: serverTimestamp(),
    channel: determineChannel(touch),
    sentStatus: 'sent',
    sentAt: serverTimestamp(),
    dmConversationState: dmResult.conversationState,
    dmSuggestedA:        dmResult.suggestedA,
    dmSuggestedB:        dmResult.suggestedB,
    dmNextAim:           dmResult.nextAim,
    dmOs2Recommended:    dmResult.os2Recommended,
    dmRawOutput:         dmResult.rawOutput,
    // OS²チェックポイントを踏んだ場合のみ記録
    os2Judgment:   os2Result?.judgment,
    os2NextAction: os2Result?.nextAction,
    os2Warning:    os2Result?.warning,
    os2RawOutput:  os2Result?.rawOutput,
  };

  const isRep = newTurn.channel === 'リプ';
  await updateDoc(touchRef, {
    conversationTurns:  arrayUnion(newTurn),
    repExchangeCount:   isRep ? increment(1) : touch.repExchangeCount,
    dmExchangeCount:    !isRep ? increment(1) : touch.dmExchangeCount,
    lastTouchedAt:      serverTimestamp(),
  });

  // OS²で「前進」判定が出た場合のみステップを進める
  if (os2Result?.judgment === '前進') {
    await updateDoc(caseRef, {
      currentStep: advanceStep(caseData.currentStep),
      updatedAt: serverTimestamp(),
    });
  }
}

// 「＋ 相手の返信を追加」
async function handleAddReplyTurn(
  touchId: string,
  text: string,
  channel: 'リプ' | 'DM'
) {
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
    lastTouchedAt:     serverTimestamp(),
    status:            'awaiting_reaction',
  });
}

// ステップ進行ロジック
function advanceStep(current: string): string {
  const ladder: Record<string, string> = {
    S1: 'S2', 'S1-L': 'S2', S2: 'S3', S3: 'S4', S4: 'S5',
  };
  return ladder[current] ?? current;
}
```

---

## タッチUI：2モードの切り替え

### 案件カードのタッチ追加ボタン

```
[＋ 新規投稿タッチを追加]     ← S1/S1-L用（既存のフォーム）
[💬 DM会話を開始]             ← S3直行 / ログ復元用（新規スレッド作成）
```

### 「DM会話を開始」のフォーム

```
エントリー種別
  ● IGストーリー返信起点（S3直行）
  ○ 会話ログを復元

─────（S3直行の場合）─────
自分が送ったストーリー返信：
  [テキスト入力]
送信日時：
  [日時ピッカー]
相手の最初の返信：
  [テキスト入力]
受信日時：
  [日時ピッカー]
[💬 スレッドを作成]

─────（ログ復元の場合）─────
現在のステップ：[プルダウン S2/S3/S4/S5]
ターンを追加：
  役割 [自分 / 相手] チャネル [リプ / DM]
  テキスト：[入力]
  日時：[日時ピッカー]
  [このターンを追加]
（繰り返し）
[✅ 復元を確定]
```

### 既存タッチの「新規投稿タッチ」モード

touchMode: 'post' の場合は現在のフォーム（接触した投稿/投稿種別/対象妥当性）をそのまま表示。
スレッドモードとは同一案件内で共存しない（1案件1スレッド）。

---

## MDエクスポートへの反映

`src/utils/mdExport.ts` の `exportCaseMd` 関数に会話スレッドを追加：

```typescript
touches.forEach((touch, i) => {
  if (touch.touchMode === 'conversation') {
    // ─── 会話スレッドモードの出力 ───
    md += `### 会話スレッド${i + 1}`;
    if (touch.threadEntry) {
      const entryLabel: Record<string, string> = {
        s1l_promotion: 'S1-L昇格',
        s3_direct:     'S3直行（IGストーリー）',
        log_restore:   'ログ復元',
      };
      md += ` — ${entryLabel[touch.threadEntry] ?? touch.threadEntry}`;
    }
    md += '\n\n';

    (touch.conversationTurns ?? []).forEach(turn => {
      const prefix = turn.role === '自分' ? '▶ 自分' : '◀ 相手';
      md += `**${prefix}**（${formatDate(turn.timestamp)}）\n${turn.text}\n\n`;

      if (turn.dmSuggestedA) {
        md += `　DM提案A：${turn.dmSuggestedA}\n`;
        md += `　DM提案B：${turn.dmSuggestedB}\n`;
        md += `　次の狙い：${turn.dmNextAim}\n`;
        if (turn.dmOs2Recommended) md += `　⚠ OS²起動推奨あり\n`;
      }
      if (turn.os2Judgment) {
        md += `　OS②判定：${turn.os2Judgment} ／ 次アクション：${turn.os2NextAction}\n`;
      }
      md += '\n';
    });

    md += `---\n\n`;
  } else {
    // ─── 新規投稿タッチモードの出力（既存処理）───
    // ... 既存コード変更なし
  }
});
```

---

## OS②プロンプトの修正（/prompts/OS2_行動判定_latest.md）

会話スレッドでOS②を呼ぶ場合、案A/案Bは使わない（DM文生成OSが担当）。
ただし、OS②プロンプト自体から案A/案Bを削除すると、S1-Lの「次の接触条件」出力まで消えるリスクがある。
→ **OS②プロンプトは変更しない**。アプリ側のパース（parseOS2CheckpointOutput）で案A/案Bを無視する。

UIでも、会話スレッドのOS²結果表示には「判定・次アクション・今やってはいけないこと」だけを表示し、案A/案Bの欄は出さない。

---

## 実装順

1. `ConversationTurn` 型定義・`Touch` の `touchMode / threadEntry / threadStatus` フィールド追加
2. `createS3DirectThread` 関数（エントリー②）
3. `createLogRestoreThread` 関数 + UIフォーム（エントリー③）
4. `promoteTouchToThread` 関数を既存「テキスト返信選択」フローに組み込む（エントリー①）
5. `src/utils/dmPrompt.ts` 作成（`buildDMPrompt` / `parseDMOutput`）
6. 会話スレッドUIの実装（チャットバブル・既読バッジ・R4警告）
7. [DM文生成プロンプトをコピー] ボタン + 貼り付け → `parseDMOutput` 取り込み
8. 提案文A/B の「使う」ボタン → 下書き欄
9. [✈ 送信完了として追加] → `handleAddSelfTurn`
10. [＋ 相手の返信を追加] → `handleAddReplyTurn`
11. OS²推奨バナー（`dmOs2Recommended: true` のときのみ表示）
12. [OS²で判定する] ボタン → `buildOS2ConversationPrompt` → `parseOS2CheckpointOutput`
13. OS²結果表示（判定・次アクション・警告のみ）
14. 案件カードの [💬 DM会話を開始] ボタン追加
15. `src/utils/mdExport.ts` に会話スレッド出力を追加
16. 旧「分岐A：会話ログ手入力フォーム」の削除

---

## 注意事項

- 1案件につき会話スレッドは1つ（スレッドが複数存在する状態にしない）
- `conversationTurns` は追記のみ（削除・編集は別途検討）
- R4（既読48h）はUIの警告表示とDM文生成OS²推奨フラグのみ。自動クローズしない
- S3直行（IGストーリー）の案件は、案件のcurrentStepを作成時点でS3に設定する
- ログ復元で入力したターンに `dmOs2Recommended / os2Judgment` は記録しない（復元データのため）
- `advanceStep` でステップが S5 を超えた場合は S5 のまま保持する
