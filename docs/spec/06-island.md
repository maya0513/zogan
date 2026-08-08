# §6 Island

## 6.1 マークアップ契約

```html
<div data-island="CartBadge"
     data-props='{"variant":"compact"}'
     data-trigger="load">
  <span>3</span>   <!-- SSR 済み。ハイドレート前もそのまま見える -->
</div>
```

trigger：`load` / `idle`(requestIdleCallback) / `visible`(IntersectionObserver) / `media:(...)` / `none`

EC でのデフォルト指針：

| 用途 | trigger |
|---|---|
| カートバッジ、ヘッダ | `load` |
| 商品画像ギャラリー、バリアント選択 | `visible` |
| レビュー、レコメンド、フッタ | `visible` |
| 検索サジェスト | `idle` |

trigger の名前と意味論は **Astro の `client:*` ディレクティブをそのまま採用**しています。独自の呼び方を作らないこと。

### 6.1.1 属性の規則

| 属性 | 必須 | 値 |
|---|---|---|
| `data-island` | ○ | 登録済みコンポーネント名。`^[A-Za-z][A-Za-z0-9_]*$` |
| `data-props` | — | JSON オブジェクト。省略時は `{}` |
| `data-trigger` | — | 下表のいずれか。省略時は `load` |
| `data-fragment` | — | Fragment の取得先 URL（§6.1.5）。省略時は取得しない |

`data-props` は HTML 属性値なので、**属性値としてのエスケープが必要**です（`"` → `&quot;` 等）。Store snapshot（`<script type="application/json">`）とエスケープ規則が違う点に注意してください。

> **`data-props` に秘密や巨大なデータを入れないこと。**
> 属性値は HTML のソースにそのまま出ます。加えて、SSR 済みの HTML と重複するので、**同じ情報を 2 回配ることになります**。`data-props` は「その Island の描画に必要な最小の入力」に留め、表示用の値は SSR 済みの中身に任せてください。

### 6.1.2 trigger の一覧

| trigger | 発火条件 | 実装 |
|---|---|---|
| `load` | 即座 | 走査した時点でハイドレート |
| `idle` | ブラウザが暇になったら | `requestIdleCallback`（未対応環境は `setTimeout(…, 1)` にフォールバック） |
| `visible` | 要素がビューポートに入ったら | `IntersectionObserver`。既定 `rootMargin: '200px'` |
| `media:(...)` | メディアクエリが真になったら | `matchMedia`。例 `media:(min-width: 768px)` |
| `none` | 発火しない | SSR 済みの中身を静的に表示するのみ |

`none` は「SSR だけしたい」場合に使います。**Island として登録せず普通のコンポーネントにするのが本来正しい**ので、`none` を多用しているなら設計を疑ってください。用途は「条件によってハイドレートするか変えたい」ケースに限られます。

### 6.1.3 ハイドレートの手順

**引数は Element ではなく、ノードの配列です。** 理由と走査の形は [§5.2.3](05-store.md) と同一で、`querySelectorAll` だけではノード自身を取り逃がします。

```
collect(nodes, selector):                  // §5.2.3 と同じ
  found = []
  for node of nodes:
    if node.nodeType !== ELEMENT_NODE: continue
    if node.matches(selector): found.push(node)
    found.push(...node.querySelectorAll(selector))
  return found

hydrateIslands(nodes):                     // nodes = 今回挿入された範囲
  for el of collect(nodes, '[data-island]'):
    if el に既にハイドレート済みマークがある: continue

    name = el.dataset.island
    Component = registry.get(name)
    if !Component: 警告して continue        // 未登録でも SSR 済みの中身は残る

    props = el.dataset.props ? JSON.parse(el.dataset.props) : {}

    trigger に応じて待機してから:
      if el.dataset.fragment:                // ★ §6.1.5
        html = await fetchFragment(el.dataset.fragment)
        成功 → el の中身を html で置換
        失敗 → 警告のみ。SSR 済みの中身を残す
        mergeSnapshots([...el.childNodes])   // ★ hydrate より先（§7.2）

      hydrate(<Component {...props} />, el)
      el にハイドレート済みマークを付ける
```

`mergeSnapshots` に渡すのは `el` ではなく **`el` の子ノード列**です。置換後の中身が「今回挿入された範囲」であり、`el` 自身は挿入されていません（[§5.2.3](05-store.md)）。

規則：

- **未登録・JSON 破損・Fragment 取得失敗は警告して継続。** SSR 済みの中身が残るので、画面は壊れません。Island の登録漏れでページ全体が落ちるのは過剰です
- 走査対象は**今回挿入された範囲のみ**。ページ全体を毎回走査しない
- **差し替えで置換された古い Island の後始末をすること。** `IntersectionObserver` / `matchMedia` のリスナと、未発火の `requestIdleCallback` を解除する。これを忘れるとソフトナビゲーションのたびにリスナが積み上がります
- `hydrate` は Preact のもの。**`render` ではありません。** SSR 済みの DOM を再利用します

### 6.1.4 中身は SSR する

```html
<div data-island="ProductGallery" data-trigger="visible">
  <img src="/img/abc-123-1.jpg" alt="…">   <!-- ← これが LCP を担う -->
</div>
```

Island の中身を空にして JS の到着を待つと、**LCP がハイドレートまで遅れます**。

- `visible` / `idle` trigger の Island は、SSR 済みの中身が**実際に長時間表示される**
- したがって SSR 済みの中身は「仮の姿」ではなく、**そのまま完成品として成立している必要がある**

例外は 2 つ、**どちらもプレースホルダに留める**ものです。

| 例外 | 理由 | 参照 |
|---|---|---|
| **Store を読む Island** | サーバは `pending` を知らないので確定値しか出せず、ハイドレート後に値が飛ぶ。加えてコンポーネントをサーババンドルに入れると client-only 検証で落ちる | [§5.4](05-store.md) / [§5.3.2](05-store.md) |
| **Fragment を取得する Island** | 中身が殻と別のキャッシュ規則を持つため殻に焼き込めない | 次節 |

**この 2 つは実際にはほぼ重なります。** カートバッジは Store を読み、かつ cart Fragment から中身を得ます。

> **SSR する Island と、children にコンポーネントを置く Island は同じものです。**
>
> サーバ側の `<Island>` はコンポーネントを import せず、`name` と `children` だけを受け取ります（[付録 A](appendix-a-api.md)）。上の例外に当たる Island では、children にプレースホルダのマークアップだけを書き、**コンポーネントを import しないこと**。これが [§5.3](05-store.md) の不変条件をビルドで守る条件そのものになります。

### 6.1.5 Fragment を取得する Island

`data-fragment` を持つ Island は、trigger 発火時に**その URL を取得して自身の中身を置き換えます**。[§2.3](02-architecture.md)(c) の経路がこれにあたります。

```html
<div data-island="CartBadge"
     data-fragment="/_f/cart-badge"
     data-trigger="load">
  <span>—</span>   <!-- 取得までのプレースホルダ -->
</div>
```

規則：

| 項目 | 規則 |
|---|---|
| 値 | **単一の URL。** SSR 時にサーバが書いたものだけを使い、クライアントが組み立てない（[§4.3.3](04-fragment.md)）。複数指定はできない（中身を丸ごと置換するため） |
| 取得の契機 | `data-trigger` に従う。`none` なら取得しない |
| 取得の回数 | trigger 発火時に **1 回だけ**。ポーリングしない |
| 差し込み先 | その Island 要素の中身を丸ごと置換する |
| snapshot | 応答内の `[data-store]` を**ハイドレートより先に**マージする（[§7.2](07-client-runtime.md)） |
| 失敗時 | 警告して SSR 済みの中身を残す。ページを落とさない |
| AbortController | ナビゲーション用とは**別に管理する**（[§7.3.2](07-client-runtime.md)） |

**この属性が [§4.3](04-fragment.md) の不変条件を構造的に守っています。** クライアントに URL を組み立てる口が無く、Fragment に渡る値はサーバが SSR 時に書いたものだけになります。`data-fragment` を JS から書き換える API を作らないこと。

`data-fragment` を持つ Island は、SSR 済みの中身が**取得までのプレースホルダになります**。理由は Fragment の中身が殻と別のキャッシュ規則を持つ（＝殻に焼き込めない）ためです。したがって **Fragment 島に LCP を担わせないこと。**

#### Fragment の HTML と Island の描画結果を一致させる

上の手順を追うと、**同じ領域が 2 回描画されます**。

```
1. Fragment の応答で中身が置換される       ← サーバが getCart(c) から描画
2. hydrate(<Component {...props} />, el)   ← クライアントが cart.value から描画
```

**この 2 つは同じ HTML でなければなりません。** ずれていると、`hydrate` が DOM を再利用できずに描き直し、ハイドレート直後に表示が飛びます。

[§5.5](05-store.md) により、カートのようなユーザ固有の確定値は **Fragment の応答でしか運べません**。したがって「Fragment の HTML」と「Island の描画結果」が一致することは、**選択肢ではなく要件**です。

実装上は次の形になります。

| 描画する側 | 入力 | 例 |
|---|---|---|
| Fragment ハンドラ（サーバ） | props（`getCart(c)` の結果） | `<CartBadgeView count={cart.count} />` |
| Island（クライアント） | Store（`cart.value`） | `<CartBadge />` → 内部で `<CartBadgeView count={cart.value.count} />` |

**表示部分を共有の presentational コンポーネントに切り出し、値の取り方だけを変える**のが素直です。`CartBadgeView` は Store を import しないのでサーババンドルに入ってよく、`CartBadge` は Store を読むので入れられません（[§5.3.2](05-store.md)）。

手順 1 の直後に snapshot がマージされる（[§7.2.2](07-client-runtime.md)）ので、手順 2 の `cart.value` は手順 1 と同じ確定値を持ちます。**順序がこの一致を保証しています。**

---

## 6.2 Island は共有状態を持たない

```jsx
// ✗ 遷移で消える
export default ({ initial }) => {
  const count = useSignal(initial)
  return <span>{count}</span>
}

// ✓ store を読むだけ
import { cart } from '../stores/cart'
export default () => <span>{cart.value.count}</span>
```

Island 内の `useSignal` は「その Island 固有で、消えてよい状態」（開閉、ホバー、入力中の検索語）にのみ使う。

> **この `✓` のコンポーネントは、ページ側で `<Island>` の children に置かないこと。**
>
> 置くとサーババンドルから `stores/cart` へ到達し、[§5.3](05-store.md) の検証で落ちます。children にはプレースホルダだけを書き、コンポーネントはクライアントの `start({ islands })` にだけ登録します（[§5.3.2](05-store.md) / [§6.1.4](06-island.md)）。**コンポーネント本体は上のまま変更不要**です。

### 6.2.1 判断表

| 状態 | 消えてよいか | 置き場所 |
|---|---|---|
| アコーディオンの開閉 | ○ | `useSignal` |
| ドロップダウンの表示状態 | ○ | `useSignal` |
| 入力中の検索語 | ○ | `useSignal` |
| ホバー・フォーカス | ○ | `useSignal` |
| 画像ギャラリーの選択中インデックス | ○ | `useSignal` |
| **カートの中身** | ✗ | **Store** |
| **ログイン状態** | ✗ | **Store** |
| **お気に入り（未同期分）** | ✗ | **Store** |
| **比較リスト** | ✗ | **Store** |
| 選択中のバリアント | 場合による | URL に載せるのが最善（§6.2.2） |

判断は 1 問で決まります。

> **別のページへ行って戻ってきたとき、その状態が消えていたら困るか？**

困るなら Store。困らないなら `useSignal`。

### 6.2.2 迷ったら URL に載せる

`useSignal` と Store の間に、**もう 1 つ良い選択肢があります**。URL です。

```
/products/ABC-123?variant=red-M
```

URL に載せた状態には、他の 2 つにない性質があります。

| 置き場所 | 遷移で残る | 戻る/進むで復元 | 共有・ブックマーク | SEO |
|---|---|---|---|---|
| `useSignal` | ✗ | ✗ | ✗ | ✗ |
| Store | ○ | ○ | ✗ | ✗ |
| **URL** | ○ | **○（自動）** | **○** | **○** |

バリアント選択、ファセット、ソート順、ページ番号は**すべて URL に載せるべき**です。URL に載せれば Partial の差し替えでそのまま扱え（[§3](03-partial.md)）、Store も `useSignal` も要りません。

**Store を増やす前に、URL に載せられないか検討してください。**

### 6.2.3 Island の粒度

Island は差し替えのたびに作り直されるので、**大きいほどコストが高くなります**。

| 粒度 | 例 | 判定 |
|---|---|---|
| ページ全体を 1 Island | `<div data-island="ProductPage">` | ✗ 部分ハイドレーションの意味が消える |
| 対話する要素ごと | カートボタン、ギャラリー、バリアント選択 | ○ |
| 要素の一部ごと | ボタンのアイコンだけ Island | ✗ 細かすぎ。オーバーヘッドが上回る |

目安は「**その要素は独立して対話できるか**」です。カートボタンとバリアント選択は連動する（バリアントを変えたらカートに入れる SKU が変わる）ので、1 つの Island にまとめるのが自然です。連動を Store 経由で行うより、同じ Island 内の `useSignal` で済ませるほうが単純です。
