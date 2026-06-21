# 指示書B｜ナビゲーション・パネル制御

## 対象バグ
- #12: 警告バナークリック → 対象カードが別ページにあると展開されない（App.tsx:138-142, Tab2.tsx:416）
- #13: Tab1の詳細パネルがページをまたいでも自動で閉じない（selectedIdがpage切替後も残る）
- #14: ベルアイコンからTab2に遷移しても通知バナーが見えない（スクロール位置が最上部でない）

---

## 必須前提

1. **実装前に読むファイル**
   - `App.tsx`（警告計算・tab切替・expandId受け渡し部分）
   - `Tab1.tsx`（selectedId・currentPage stateの管理方法）
   - `Tab2.tsx`（expandId・currentPage・fullSortedList の実装）

2. **変更するファイル**（これ以外は触らない）
   - `App.tsx`
   - `Tab1.tsx`
   - `Tab2.tsx`

3. **変更しないファイル**
   - `Tab3.tsx` `Tab4.tsx` `Tab5.tsx` `parser.ts` `types.ts` `firebase.ts`

4. **実装順**
   ```
   Step 1: #13（最小変更・副作用なし）
   Step 2: #14（スクロールのみ・副作用なし）
   Step 3: #12（ページ切替 + 展開の連鎖・影響範囲が広い）
   ```

---

## Step 1｜#13 詳細パネルのページまたぎ自動クローズ

**原因:** `selectedId`（Tab1の詳細パネル開閉state）がページ切替時にリセットされない。

**修正:** `currentPage` が変わったら `selectedId` をクリアする `useEffect` を1本追加する。

```typescript
// Tab1.tsx（selectedId と currentPage を管理しているコンポーネント）

// ─── 追加 ───
useEffect(() => {
  setSelectedId(null);
}, [currentPage]);
// currentPageが変わるたびに詳細パネルを閉じる。
// これだけ。既存の selectedId / setSelectedId の使い方は一切変えない。
```

---

## Step 2｜#14 Tab2遷移時の通知バナー自動スクロール

**原因:** ベルアイコン押下でTab2に遷移しても `scrollY` が前のタブの位置のまま。
通知バナーはTab2最上部に描画されているが、案件数が多い場合はビューポート外になる。

**修正:**

### 2-1. 通知バナーにrefを付ける（Tab2.tsx）

```typescript
// Tab2.tsx

// ─── 追加 ───
const notificationBannerRef = useRef<HTMLDivElement>(null);

// JSX内の通知バナーのルート要素に ref を付ける
// 既存の通知バナー要素（warnItems.length > 0 の場合に表示されるdiv）を探して:
<div ref={notificationBannerRef} className="...既存のclassName...">
  {/* 既存の通知バナー内容 */}
</div>
```

### 2-2. 外部からスクロールを起動できるようにrefをexpose（Tab2.tsx）

```typescript
// Tab2.tsx を forwardRef でラップして scrollToBanner を expose する

export interface Tab2Ref {
  scrollToBanner: () => void;
}

const Tab2 = forwardRef<Tab2Ref, Tab2Props>((props, ref) => {
  const notificationBannerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    scrollToBanner: () => {
      notificationBannerRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    },
  }));

  // 以降は既存の実装のまま
  // ...
});
```

### 2-3. ベルアイコンクリック時にスクロールを起動（App.tsx）

```typescript
// App.tsx

// ─── 追加 ───
const tab2Ref = useRef<Tab2Ref>(null);

// ベルアイコンクリックのハンドラ（既存のタブ切替処理に追記）
const handleBellClick = () => {
  setActiveTab(TAB_INDEX.TAB2); // 既存のタブ切替
  // タブ切替後の次のフレームでスクロール
  requestAnimationFrame(() => {
    tab2Ref.current?.scrollToBanner();
  });
};

// JSXでTab2にrefを渡す
<Tab2
  ref={tab2Ref}
  // ...既存props...
/>
```

> **注意:** Tab2が既に `forwardRef` を使っていない場合、この修正で `forwardRef` でラップする必要がある。
> その際、既存の `export default Tab2` を `export default forwardRef(Tab2)` に変更するだけでOK。
> Tab2の内部実装は一切変えない。

---

## Step 3｜#12 警告クリック → 別ページのカードを展開

**原因:** 警告バナーの項目をクリックすると `expandId(item.id)` が呼ばれるが
（Tab2.tsx:416）、そのアイテムが現在表示中のページにない場合、
カードが描画されていないため展開が無効になる。

**修正方針:** ①アイテムが何ページ目にあるかを計算 → ②ページを切替 → ③切替完了後に展開。

### 3-1. pendingExpandId refを追加（Tab2.tsx）

```typescript
// Tab2.tsx

// ─── 追加 ───
const pendingExpandId = useRef<string | null>(null);

// ページ切替完了後に pending の展開を実行
useEffect(() => {
  if (pendingExpandId.current !== null) {
    const id = pendingExpandId.current;
    pendingExpandId.current = null;

    setExpandId(id);

    // 展開したカードにスクロール
    requestAnimationFrame(() => {
      document.getElementById(`case-card-${id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }
}, [currentPage]); // currentPageの変化をトリガーにする
```

### 3-2. 警告クリックハンドラを修正（Tab2.tsx:416付近）

```typescript
// Tab2.tsx（警告バナーの項目クリックハンドラ・既存の expandId(p.id) 呼び出し箇所）

// ─── 修正前 ───
// onClick={() => expandId(p.id)}

// ─── 修正後 ───
const handleWarnItemClick = (itemId: string) => {
  // fullSortedList = ページネーション適用前の全件リスト（既存のstateまたは変数）
  // ITEMS_PER_PAGE = 1ページあたりの表示件数（既存の定数）
  const itemIndex = fullSortedList.findIndex(item => item.id === itemId);
  if (itemIndex === -1) return;

  const targetPage = Math.floor(itemIndex / ITEMS_PER_PAGE);

  if (targetPage !== currentPage) {
    // 別ページ: まずページを切替 → useEffectで展開
    pendingExpandId.current = itemId;
    setCurrentPage(targetPage);
  } else {
    // 同ページ: 即展開 + スクロール
    setExpandId(itemId);
    requestAnimationFrame(() => {
      document.getElementById(`case-card-${itemId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }
};

// JSX側
// onClick={() => expandId(p.id)} を onClick={() => handleWarnItemClick(p.id)} に変更
```

### 3-3. カードのルート要素に id を付与（Tab2.tsx）

スクロール先を `document.getElementById` で取得するため、
各カードのルート要素に id を付ける。

```typescript
// Tab2.tsx の カード描画箇所（map内）

// ─── 追加 ───
<div
  id={`case-card-${item.id}`}
  // ...既存のclassName等...
>
  {/* 既存のカード内容 */}
</div>
```

> **注意:** `fullSortedList` の変数名はコードベース内の実際の名前に合わせること。
> ページネーション前のソート済み全件リストを参照していればOK。

---

## 動作確認チェックリスト

```
□ #13 詳細パネル自動クローズ
  1. Tab1でアイテムをクリックして詳細パネルを開く
  2. ページ送りボタンで次ページに移動
  3. 詳細パネルが自動で閉じること

□ #14 通知バナー自動スクロール
  1. 警告がある状態でヘッダーのベルアイコンをクリック
  2. Tab2に遷移した直後に通知バナーが画面内に見えること

□ #12 警告クリック → 別ページカード展開
  1. 警告バナーに複数件ある状態で、2ページ目以降にあるアイテムの警告をクリック
  2. 自動でそのページに移動し、対象カードが展開されること
  3. 同ページのアイテムをクリックした場合も展開されること（既存動作の維持）
```
