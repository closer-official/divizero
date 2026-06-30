# `meeting_scheduled` 追加 実装ガイド

## 背景・設計思想

現状、「面談確定済み＝今すぐDMを送らなくてよい」案件が `active` と同列に並び、
`homeCalculators.ts` がテキストの regex で無理やり識別している（不安定）。

`meeting_scheduled` を正式な state として追加することで：
- AIに急かされる誤動作を防ぐ
- ホーム画面の「今日やること」から自動除外
- 面談日カウントダウンを表示

将来的な拡張ステートの最初の一手。

---

## 状態一覧（実装後）

```
active            → 今すぐ動く
waiting           → 再接触日まで待つ（既存）
meeting_scheduled → 面談日まで待つ（新規）
sleeping          → 低頻度監視（既存）
archived          → 長期保管（既存）
closed            → 終了（既存）
```

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/types.ts` | union型に追加、`meeting_date` フィールド追加 |
| `src/components/tabs/Tab2.tsx` | badge・label・フィルタ・カンバン・UI |
| `src/App.tsx` | 起動時チェックに追加 |
| `src/services/home/homeCalculators.ts` | regex判定を state 判定に置き換え |

---

## 1. `src/types.ts`

### 1-1. `PipelineItem.state` の union 型を拡張

```ts
// 変更前
state?: 'active' | 'waiting' | 'sleeping' | 'archived' | 'closed';

// 変更後
state?: 'active' | 'waiting' | 'meeting_scheduled' | 'sleeping' | 'archived' | 'closed';
```

### 1-2. `PipelineItem` に `meeting_date` フィールドを追加

```ts
// S∞ループ構造フィールドのブロックに追記
state?: 'active' | 'waiting' | 'meeting_scheduled' | 'sleeping' | 'archived' | 'closed';
recontact_date?: string;   // waiting/sleeping/archived で使用
meeting_date?: string;     // meeting_scheduled で使用（ISO date: 'YYYY-MM-DD'）
```

> `recontact_date` と `meeting_date` は用途を分離する。
> 面談日は `meeting_date` にのみ書き込む。`recontact_date` には触れない。

---

## 2. `src/components/tabs/Tab2.tsx`

### 2-1. `stateBadgeStyle` 関数（119行目付近）

```ts
function stateBadgeStyle(s?: string): string {
  if (!s || s === 'active') return 'bg-emerald-100 text-emerald-700'
  if (s === 'waiting') return 'bg-amber-100 text-amber-700'
  if (s === 'meeting_scheduled') return 'bg-sky-100 text-sky-700'   // ← 追加
  if (s === 'sleeping') return 'bg-slate-100 text-slate-500'
  if (s === 'archived') return 'bg-purple-100 text-purple-600'
  return 'bg-rose-100 text-rose-600'
}
```

### 2-2. `stateLabel` 関数（126行目付近）

```ts
function stateLabel(s?: string): string {
  if (!s || s === 'active') return 'active'
  if (s === 'meeting_scheduled') return '面談待ち'   // ← 追加
  return s
}
```

### 2-3. `getColKey` 関数（443行目付近）

`meeting_scheduled` はカンバン列をステップに基づかせる（現在のステップ列に留まらせる）。
`waiting`/`sleeping` と同じ `s1l` 列にまとめるのではなく、**ステップ列に表示しつつ badge で識別**する方針。

```ts
function getColKey(item: PipelineItem): KanbanColKey {
  if (item.state === 'archived') return 'archived'
  // meeting_scheduled は sleeping/waiting と分離してステップ列に留める
  if (item.state === 'waiting' || item.state === 'sleeping') return 's1l'
  if (item.currentStep === 'S1') return 's1'
  if (item.currentStep === 'S2') return 's2'
  return 's3plus'
}
```

> `meeting_scheduled` は `waiting`/`sleeping` のケースに**含めない**。
> そのまま currentStep 判定に流れ、適切な S1/S2/S3+ 列に表示される。

### 2-4. カンバンカード内の面談日表示（KanbanCard コンポーネント内、2130行目付近）

再接触日表示ブロックの直下に追加：

```tsx
{/* 再接触日（waiting / sleeping / archived） */}
{daysUntilRecontact !== null && (item.state === 'waiting' || item.state === 'sleeping' || item.state === 'archived') && (
  <p className={`text-[11px] font-semibold mt-1 ${daysUntilRecontact < 0 ? 'text-rose-600' : item.state === 'archived' ? 'text-purple-600' : 'text-amber-600'}`}>
    <i className="fa-solid fa-clock-rotate-left mr-1 text-[10px]" />
    {daysUntilRecontact < 0 ? `再接触 ${Math.abs(daysUntilRecontact)}日超過` : `再接触まであと${daysUntilRecontact}日`}
  </p>
)}

{/* 面談日カウントダウン（meeting_scheduled） */}   {/* ← 追加ブロック */}
{item.state === 'meeting_scheduled' && item.meeting_date && (() => {
  const daysUntilMeeting = Math.round(
    (new Date(item.meeting_date).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000
  )
  return (
    <p className={`text-[11px] font-semibold mt-1 ${daysUntilMeeting < 0 ? 'text-rose-600' : 'text-sky-600'}`}>
      <i className="fa-solid fa-calendar-check mr-1 text-[10px]" />
      {daysUntilMeeting < 0
        ? `面談 ${Math.abs(daysUntilMeeting)}日経過（要フォロー）`
        : daysUntilMeeting === 0
        ? '本日面談'
        : `面談まであと${daysUntilMeeting}日`}
    </p>
  )
})()}
```

### 2-5. stateフィルタ select（1133行目付近）

```tsx
<select className="input-base text-xs py-1.5" style={{ maxWidth: 110 }} value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
  <option value="all">全state</option>
  <option value="active">active</option>
  <option value="waiting">waiting</option>
  <option value="meeting_scheduled">面談待ち</option>   {/* ← 追加 */}
  <option value="sleeping">sleeping</option>
  <option value="archived">archived</option>
</select>
```

### 2-6. 展開パネルに「面談セット」UIを追加

展開パネル内のアクションバー（トラック変更・チャネル変更ボタンの並び）に追加する。

**位置**: `Tab2.tsx` の展開パネル（2170行目付近）の `flex-wrap items-center gap-2` ブロック内。

```tsx
{/* 面談セット / 解除 */}
{role === 'admin' && (
  item.state === 'meeting_scheduled' ? (
    <button
      className="text-[10px] px-2 py-1 rounded bg-sky-100 text-sky-700 hover:bg-sky-200 transition shrink-0"
      onClick={e => {
        e.stopPropagation()
        saveData(prev => ({
          ...prev,
          pipeline: prev.pipeline.map(p =>
            p.id === item.id ? { ...p, state: 'active' as const, meeting_date: undefined } : p
          ),
        }))
        toast.show('面談待ちを解除しました')
      }}
    >
      <i className="fa-solid fa-calendar-xmark mr-1" />面談解除
    </button>
  ) : (
    <button
      className="text-[10px] px-2 py-1 rounded bg-sky-50 text-sky-600 hover:bg-sky-100 transition shrink-0"
      onClick={e => {
        e.stopPropagation()
        const dateStr = prompt('面談日を入力（YYYY-MM-DD）', new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10))
        if (!dateStr) return
        saveData(prev => ({
          ...prev,
          pipeline: prev.pipeline.map(p =>
            p.id === item.id ? { ...p, state: 'meeting_scheduled' as const, meeting_date: dateStr } : p
          ),
        }))
        toast.show(`面談日を ${dateStr} に設定しました`)
      }}
    >
      <i className="fa-solid fa-calendar-check mr-1" />面談セット
    </button>
  )
)}
```

> `prompt()` でシンプルに実装する。将来的に日付ピッカーに差し替え可能。

---

## 3. `src/App.tsx`

### 起動時チェック（102〜142行目付近）

`meeting_scheduled` は **面談日を過ぎたら `active` に自動遷移**する。
`recontact_date` ではなく `meeting_date` を参照する。

```ts
// 変更前: waiting / sleeping / archived のみチェック
const recontactDue = (data.pipeline || []).filter(
  p => (p.state === 'waiting' || p.state === 'sleeping' || p.state === 'archived') && p.recontact_date && new Date(p.recontact_date) <= now
)

// 変更後: meeting_scheduled も含める
const recontactDue = (data.pipeline || []).filter(
  p =>
    ((p.state === 'waiting' || p.state === 'sleeping' || p.state === 'archived') &&
      p.recontact_date && new Date(p.recontact_date) <= now) ||
    (p.state === 'meeting_scheduled' && p.meeting_date && new Date(p.meeting_date) <= now)
)
```

saveData 内の map も同様に拡張：

```ts
pipeline: prev.pipeline.map(p => {
  let updated = { ...p }

  // 既存: waiting / sleeping / archived → active
  if (
    (p.state === 'waiting' || p.state === 'sleeping' || p.state === 'archived') &&
    p.recontact_date && new Date(p.recontact_date) <= now
  ) {
    updated = { ...updated, state: 'active' as const }
  }

  // 追加: meeting_scheduled → 面談日経過後 active
  if (p.state === 'meeting_scheduled' && p.meeting_date && new Date(p.meeting_date) <= now) {
    updated = { ...updated, state: 'active' as const }
  }

  // 48h 未反応チェック（既存・変更なし）
  const latestTouch = (p.touches ?? []).slice().sort((a, b) => b.date.localeCompare(a.date))[0]
  if (latestTouch && latestTouch.status === 'awaiting_reaction' && new Date(latestTouch.date) <= h48ago) {
    if (!p.last_reaction || p.last_reaction_at !== latestTouch.date) {
      updated = { ...updated, last_reaction: 'none' as const, last_reaction_at: now.toISOString() }
    }
  }

  return updated
}),
```

---

## 4. `src/services/home/homeCalculators.ts`

### `isMeetingWaitingItem` を state 判定に置き換え（79行目）

```ts
// 変更前（regex で不安定に識別）
export function isMeetingWaitingItem(item: PipelineItem): boolean {
  const latestTouch = [...(item.touches || [])]
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const statusText = [
    item.judgment,
    item.nextAction,
    item.deadline,
    item.todayTask?.action,
    latestTouch?.os2Judgment,
    latestTouch?.os2NextAction,
    latestTouch?.reactionJudgment,
    latestTouch?.reactionNextStep,
  ].filter(Boolean).join(' ')

  return /(?:面談|商談|打ち合わせ|アポ)(?:.{0,8})(?:確定|予定|予約|待ち|設定済|取得済)|日程(?:.{0,6})(?:確定|決定|調整済|合意済)/.test(statusText)
}

// 変更後（state で確実に判定）
export function isMeetingWaitingItem(item: PipelineItem): boolean {
  return item.state === 'meeting_scheduled'
}
```

> 関数名・シグネチャは変えない。呼び出し側（`getDMReplyNeeded` 等）は変更不要。

---

## 実装後の動作確認チェックリスト

- [ ] Tab2 展開パネルに「面談セット」ボタンが表示される
- [ ] 面談日入力後、カードに `面談まであとN日` が表示される
- [ ] state バッジが `面談待ち`（水色）で表示される
- [ ] stateフィルタで「面談待ち」を選ぶと対象案件だけ絞れる
- [ ] カンバン列は currentStep に応じた列（S1/S2/S3+）に表示される（s1l 列には入らない）
- [ ] 「面談解除」ボタンで `active` に戻る
- [ ] 面談日を過ぎた翌日の起動時に自動で `active` に遷移する
- [ ] ホーム画面の「今日やること」から `meeting_scheduled` 案件が除外される
- [ ] `isMeetingWaitingItem` が regex ではなく state で判定される

---

## 実装しない（スコープ外）

- 日付ピッカーUI（`prompt()` で暫定対応）
- 面談完了後の自動クローズ提案
- `proposal_pending` 等の次のステート追加
