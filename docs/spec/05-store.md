# §5 Store（共有状態）

## 5.1 base + pending の二層

「サーバ確定値で上書きするか、初回だけにするか」という判断を**設計から消す**。

```ts
// stores/cart.ts   ★ client-only
import { signal, computed } from '@preact/signals'

const base    = signal({ version: 0, count: 0, lines: [] })  // サーバ確定値
const pending = signal<Delta[]>([])                           // 未確定の楽観差分

export const cart = computed(() => applyDeltas(base.value, pending.value))
```

規則：

- `base` は **version が手元より大きい時のみ上書き**。それ以外は無視
- `pending` はクライアントが管理。サーバ応答が返ったら該当 delta を削除
- 表示は必ず `cart`（computed）を読む。`base` を直接読まない

`version` はサーバ側でカート更新のたびに単調増加させる整数、または `updated_at` の ms 値。

**最大の利点**：在庫切れ等でサーバが拒否した場合、新しい `base`(version+1) が返って `pending` が消えるだけで表示が自動ロールバックする。**エラー処理が特別扱いにならない。**

### 5.1.1 なぜ「初回だけ上書き」では駄目なのか

素朴な実装は 2 つあり、どちらも壊れます。

| 方式 | 壊れ方 |
|---|---|
| **毎回サーバ値で上書き** | 楽観更新が消える。カートに追加 → 別ページへ遷移 → その遷移の応答に古い snapshot が載っていて、バッジが元の数字に戻る |
| **初回だけ投入し以降は無視** | サーバとずれたまま直らない。別タブでカートを空にしても気付かない。決済直前に古い数字が出る |

「どちらを選ぶか」を実装者に判断させると、画面ごとに違う判断が下されて一貫性が壊れます。**version 比較にすると判断そのものが要らなくなります。**

- サーバが新しい情報を持っている → version が大きい → 上書きされる
- 古い snapshot が遅れて届いた → version が小さい → 無視される
- 楽観差分は base とは別の層にあるので、base が更新されても消えない

**古い snapshot が届くことは異常系ではなく通常系**です。§5.5 により snapshot はキャッシュ不能な応答にしか載りませんが、それでも順序の乱れは日常的に起きます。

| 経路 | 古い snapshot が届く理由 |
|---|---|
| Fragment 取得と `POST /cart/add` の並行 | 応答の到着順がリクエスト順と一致しない |
| 複数の Fragment が同じ Store を載せる | それぞれ別のタイミングでカートを読んでいる |
| `BroadcastChannel`（[§8.2](08-edge-cases.md)） | 他タブからの配信に順序保証がない |
| `pageshow` での再取得（[§8.3](08-edge-cases.md)） | 凍結中に進んだ版と復帰後の取得が競合する |

version 比較はこれらすべてを同じ規則で吸収します。**到着順を保証する仕組みを別に作らないこと。**

### 5.1.2 version の要件

| 要件 | 内容 |
|---|---|
| 型 | `number`（整数） |
| 単調性 | **同一ユーザのカートについて単調増加**。全ユーザで単調である必要はない |
| 生成 | DB のリビジョン列、または `updated_at` の ms 値 |
| 初期値 | `0`。まだサーバから何も届いていない状態を表す |

`updated_at` の ms 値を使う場合、**同一ミリ秒内に 2 回更新されると version が同じになり、後の更新が無視されます。** 更新頻度が高いなら整数のリビジョン列を使うこと。

### 5.1.3 delta と楽観更新の流れ

`pending` の中身（delta）の形は**アプリケーションが決めます**。zogan は関与しません。`applyDeltas` もアプリケーション側の純関数です。

```ts
type Delta =
  | { id: string; type: 'add';    sku: string; qty: number }
  | { id: string; type: 'remove'; sku: string }

const applyDeltas = (base: Cart, deltas: Delta[]): Cart =>
  deltas.reduce(applyDelta, base)
```

カート追加の流れ：

```
1. delta を積む            pending.value = [...pending.value, delta]
                           → cart(computed) が即座に 4 を返す。UI が反応する

2. サーバへ送る            POST /cart/add
                           → 応答に <script data-store="cart"> が載る（§5.2）

3. base をマージ           version 42 > 41 なので上書き
4. delta を取り除く        pending.value = pending.value.filter(d => d.id !== delta.id)
                           → cart は base(42) をそのまま返す
```

**成功時も失敗時も、3 と 4 は同じ処理です。**

- 成功 → base は count=4 になっている → delta を消しても表示は 4 のまま
- 在庫切れで拒否 → base は count=3 のまま version だけ 42 → delta を消すと表示が 3 に戻る

**エラー用の分岐が 1 行も要りません。** これが二層構造の目的です。専用のロールバック処理を書き始めたら、設計を踏み外している信号だと考えてください。

delta を取り除くのは**応答が返った時点**であり、成功・失敗を問いません。ネットワークエラーで応答が返らなかった場合も、タイムアウト後に取り除きます。**取り除き忘れた delta は永久に画面をずらし続ける**ので、`finally` に置くこと。

---

## 5.2 snapshot の埋め込み形式

Island の props と Store の snapshot を**別経路にする**。同じ経路で運ぶと、Island が作り直された時に共有状態も一緒に初期化される。

```html
<!-- ① island props：その island の入力。毎回上書きされてよい -->
<div data-island="CartBadge" data-props='{"variant":"compact"}'>3</div>

<!-- ② store snapshot：共有確定値。version でマージ -->
<script type="application/json" data-store="cart">
{"version":41,"count":3,"lines":[...]}
</script>
```

`<script type="application/json">` を使う理由：

- 属性値と違い JSON を素直に置ける
- エスケープが `<` → `\u003c` の一箇所に閉じる（XSS 対策が定型処理になる）
- 同じ値を複数箇所に重複させない
- 差し替え時に「挿入範囲内の `[data-store]` を集める」という 1 本の走査で処理できる

### 5.2.1 形式の規則

| 項目 | 規則 |
|---|---|
| 要素 | `<script type="application/json" data-store="NAME">` |
| `NAME` | `^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$`。Store モジュールの登録名と一致すること |
| 中身 | 単一の JSON オブジェクト。**`version: number` を必ず含む** |
| エスケープ | **`<` を `\u003c` に置換するのみ。** それ以外の変換を行わない |
| 重複 | 同じ `NAME` が複数あってよい。**version が最大のものが勝つ** |

`NAME` の正規表現は [§3.1.1](03-partial.md) の Partial 名と同一です。**識別子の規則を増やさない**ためで、それ以上の理由はありません（Store 名は HTML コメントに埋め込まれないので、連続ハイフン禁止は本来不要）。

zogan の識別子は 2 種類しかありません。

| 種類 | 正規表現 | 対象 |
|---|---|---|
| **一般識別子** | `^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$` | Partial 名、Store 名 |
| **コンポーネント名** | `^[A-Za-z][A-Za-z0-9_]*$` | `data-island` の値 |

後者にハイフンが無いのは、**JS の識別子として書けることを要件にしている**ためです。`start({ islands })` のキーとして、また Preact コンポーネントの名前として使われます。**この 2 つ以外の規則を作らないこと。**

`<` だけをエスケープすれば足りる理由は、`<script>` の中身が raw text として扱われ、終了条件が `</script` の出現だけだからです。`<` が 1 つも無ければ `</script` は現れません。`&` や `"` の変換は不要で、**むしろ余計な変換を入れると JSON が壊れます**。

```ts
const serialize = (data: unknown) =>
  JSON.stringify(data).replaceAll('<', '\\u003c')
```

この 3 行が §5.2 の XSS 対策の全部です。定型処理に閉じることが目的でした。

### 5.2.2 配置場所

配置は **2 つの軸**で決まります。順序が重要です。

1. **その応答はキャッシュ可能か** — 可能なら snapshot を載せてはならない（§5.5 の不変条件）
2. **いつ更新されるか** — キャッシュ不能な応答の中で、どこに置くか

#### 軸 1：応答のキャッシュ可能性（先に決まる）

| 応答 | `Cache-Control` | snapshot |
|---|---|---|
| Fragment（Cookie 依存） | `private, no-store` | **載せてよい** |
| Fragment（時間依存） | `public, s-maxage=N` | **載せてはならない** |
| `app.page`（殻・検索結果） | `public, s-maxage=N` | **載せてはならない** |
| `app.page`（カートページ等） | `private, no-store` | **載せてよい** |
| POST / PUT / DELETE の応答 | （キャッシュされない） | **載せてよい** |

CDN にキャッシュされる応答に snapshot を載せると、**A さんのカートが B さんに配られます**。詳細と強制手段は §5.5。

#### 軸 2：更新の届き方（キャッシュ不能な応答の中で）

| 配置 | フルロード | ソフトナビ | 用途 |
|---|---|---|---|
| Partial の**内側** | 届く | **届く** | 遷移のたびに最新化したい確定値 |
| Partial の**外側** | 届く | 届かない | 初回のみでよい値 |
| Fragment の応答内 | — | Fragment 取得時に届く | その Fragment が権威を持つ値 |

これは [§3.2.2](03-partial.md) の帰結です。部分応答はマーカー範囲を切り出したものなので、範囲外の要素は含まれません。

#### カートの snapshot をどこに置くか

軸 1 により、**キャッシュされる商品ページには Partial の内外を問わず置けません**。したがって：

> **カートの snapshot は cart Fragment（`private, no-store`）の応答内に置くこと。** これが既定であり、EC の主要導線ではこれ以外の選択肢がありません。

Partial の内側が使えるのは、**そのページ自体がキャッシュ不能な場合だけ**です（カートページ、注文履歴、ログイン後専用ページ）。これらのページでは `app.page` が `private, no-store` を返すので、内側に置いて遷移のたびに最新化できます。

ログイン状態・会員ランクも同じ制約を受けます。**「初回のみでよい値だから Partial の外側」という選択は、そのページがキャッシュされる限り成立しません。**

### 5.2.3 マージ手順

**引数は Element ではなく、ノードの配列です。** 「今回挿入された範囲」はマーカー間の兄弟ノード列（[§3.3](03-partial.md)）であって、それを囲む単一の要素は存在しません。`querySelectorAll` は呼び出し元の要素自身を含まないため、**ノード自身とその子孫の両方**を見る必要があります。

```
SELECTOR = 'script[type="application/json"][data-store]'

collectSnapshots(nodes):                    // nodes = ノードの配列
  found = []
  for node of nodes:
    if node.nodeType !== ELEMENT_NODE: continue
    if node.matches(SELECTOR): found.push(node)          // ★ ノード自身
    found.push(...node.querySelectorAll(SELECTOR))       //   その子孫
  return found

mergeSnapshots(nodes):
  for el of collectSnapshots(nodes):
    name = el.dataset.store
    store = registry.get(name)
    if !store:
      deferred.set(name, el)                // ★ 後で登録されるかもしれない
      continue

    applySnapshot(store, el)

applySnapshot(store, el):
  try:
    snapshot = JSON.parse(el.textContent)
  catch:
    警告して return                          // 壊れた JSON で画面を落とさない

  if typeof snapshot.version !== 'number': 警告して return
  if snapshot.version <= store.value.version: return     // ★ 古いので無視

  store.set(snapshot)                       // base を差し替え
```

`registry` が保持するのは **`clientStore` が返した `ReadonlySignal` ではなく、書き込み可能な内部ハンドル**です。`clientStore(name, initial)` は登録時にこのハンドルを作り、呼び出し元へは読み取り専用のビューだけを返します。

```ts
// 概念上の関係
const handle = { value: initial, set(v) { this.value = v } }   // registry が持つ
registry.set(name, handle)
return readonlyView(handle)                                     // アプリが持つ
```

**アプリケーションに `set` が届く経路を作らないこと。** [§5.1](05-store.md) の「`base` は version が手元より大きい時のみ上書き」は、書き込み口をランタイムに閉じることで保証されます（[付録 A](appendix-a-api.md)）。

`node.matches` を忘れると、**マーカー直下に置かれた `<script data-store>` を取り逃がします**。[§5.2.2](05-store.md) が指示する配置（Partial の内側）で最も自然な位置がまさにそこなので、これは必ず踏むバグです。同じ構造が [§6.1.3](06-island.md) の `hydrateIslands` にもあります。

要点：

- **`pending` には触れない。** delta の除去は §5.1.3 のとおりアプリケーション側の責務
- 走査対象は**今回挿入された範囲のみ**。ページ全体を毎回走査しない
- 同じ `NAME` が複数あれば、version が大きいものが後勝ちで残る（ループの自然な帰結）
- 壊れた JSON・version 欠落は**すべて無視して続行**する。Store のマージ失敗でページを落とさない

この処理は **Island のハイドレートより先に実行しなければなりません**（[§7.2](07-client-runtime.md)）。

#### 未登録の Store と遅延マージ

**未登録の Store を「無視して終わり」にしてはいけません。** Store モジュールは Island 経由でしか import されない（§5.3.1 の手順 2）ため、Island を遅延読み込みするビルドでは、snapshot の走査時点でまだ `clientStore()` が呼ばれていないことが普通に起こります。

```
1. start() が文書全体の [data-store] を走査       ← §A.2
2. cart の registry 登録はまだ。無視される
3. visible trigger の Island が画面に入る
4. islands/CartBadge.tsx が動的 import される
5. → stores/cart.ts が評価され clientStore('cart', …) が呼ばれる
6. ★ ここで登録されるが、snapshot は 2 で捨てられている
```

結果、base は初期値（version 0）のまま残ります。[§7.2.2](07-client-runtime.md) が防ごうとしている「Island が古い値で描画される」が、ちらつきではなく**恒久的な誤値**として復活します。

規則：

- 未登録の `NAME` に出会ったら、その要素を **`deferred` に保持する**（同じ名前が複数あれば version が最大のものを残す）
- `clientStore(name, initial)` は登録時に `deferred` を引き、**該当があれば即座に `applySnapshot` を通す**
- 適用の可否は同じ version 比較で決まる。**遅延経路のために別の規則を作らない**
- `deferred` の要素は適用後に破棄する。DOM から取り除かれた要素を保持し続けない

`deferred` を持つのはランタイムであり、アプリケーションではありません。**この 1 点を除けば、遅延登録は通常のマージと同じ経路を通ります。**

---

## 5.3 【不変条件】Store モジュールはクライアント専用

```ts
export const cartCount = signal(0)   // ← サーバで評価されたら事故
```

モジュールスコープの変数は **Node / Workers 上でリクエストを跨いで共有される**。SSR 中にこれを読み書きすると A さんのカートが B さんに見える。

対策（全部やる）：

1. Store モジュールがサーババンドルに含まれないことを**ビルド時に検証**して失敗させる（`zogan/vite`）
2. API 名で意図を明示する（`clientStore()` 等）。`signal()` を直接 export させない
3. サーバ側の初期値は必ず §5.2 の snapshot 経由で流し込む。import では渡さない

既存フレームワークはどれもこれを明示的に守ってくれない。**API とビルド時検証で機械的に強制する。**

### 5.3.1 事故の再現手順

抽象的な危険ではありません。次の順で確実に起きます。

```
1. stores/cart.ts が signal を module scope に持つ
2. components/CartBadge.tsx がそれを import する
3. CartBadge が SSR 経路に含まれる（Island の SSR 済み中身として自然に含まれる）
4. → サーバのモジュールキャッシュに signal のインスタンスが 1 個だけ生まれる
5. → A さんのリクエストで書いた値が、B さんのリクエストで読める
```

**3 は素直に書くと起きます。** [§6.1.4](06-island.md) は「Island の中身は SSR する」を既定にしているので、`<Island name="CartBadge"><CartBadge /></Island>` と書くのが自然です。その瞬間 `CartBadge` がサーババンドルに入り、そこから Store を import していれば事故の条件が揃います。

**この 1 行を書かないことが対策です**（[§5.3.2](05-store.md)）。Store を読む Island の children はプレースホルダに留め、コンポーネントを import しません。ビルド時検証は、書いてしまった場合にそれを検出するためにあります。

Workers では Isolate が使い回されるため、**同一 Isolate に載った別ユーザのリクエスト間で漏れます**。ローカル開発の単一リクエストでは絶対に再現しません。負荷をかけて初めて出ます（[§10](10-acceptance.md) の受け入れテスト最終項）。

### 5.3.2 対策 1：ビルド時検証

`zogan/vite` がサーババンドルのモジュールグラフを走査し、**client-only とマークされたモジュールが到達可能なら失敗させます**。

判定方法（いずれか）：

| 方法 | 内容 |
|---|---|
| ディレクトリ規約 | `stores/` 配下を client-only とみなす |
| 明示マーカー | ファイル先頭の `'use client-only'` ディレクティブ |
| import 元 | **`zogan/client` から `clientStore` を named import している**モジュール |

**3 番目を主とし、1・2 を補助にすること。** `clientStore` は `zogan/client` からしか export されないので、Store モジュールは必ずこの import を持ちます。これは規約ではなく型の帰結なので、抜けようがありません。

> **判定は `clientStore` の named import であって、`zogan/client` の import ではありません。**
>
> `zogan/client` は `navigating` / `pendingPartials`（[§7.3](07-client-runtime.md)）も export します。これらは Island が正当に読むもので、モジュールスコープにあってもリクエスト間で漏れる値ではありません（SSR 中は常に `false` / `[]`）。「`zogan/client` を import しているモジュール」を client-only とみなすと、**スピナーを出すだけの Island までビルドが落ちます**。判定対象は `clientStore` に限ること。
>
> この帰結として、**`zogan/client` はサーババンドルでも評価可能でなければなりません。** モジュールのトップレベルで DOM API に触れないこと。`document` / `window` への参照は `start()` の内側か、リスナ登録時に閉じ込めます。

エラーメッセージには**到達パスを全部出す**こと。

```
error: client-only module reached from server bundle

  src/server/entry.ts
    → src/routes/products.tsx
      → src/islands/CartBadge.tsx        ← ここで import している
        → src/stores/cart.ts             ← client-only

  Store を読むコンポーネントをサーバ経路に置かないでください（§5.3.2）。
    - <Island> の children  → プレースホルダに留める
    - app.fragment の応答   → props で受ける表示専用コンポーネントを使う
```

**到達経路は 2 つあります。** どちらも「サーバが Store を読むコンポーネントを描画しようとしている」という同じ誤りです。

| 経路 | 直し方 |
|---|---|
| `<Island>` の children にコンポーネントを置いた | children をプレースホルダのマークアップだけにする |
| `app.page` / `app.fragment` のハンドラで直接使った | props で値を受ける表示専用コンポーネントに差し替える（[§4.2](04-fragment.md)） |

#### Store を読む Island をどう SSR するか

上のエラーは「検査が厳しすぎる」のではありません。**§5.3.1 の事故の条件が実際に揃っている**ことを正しく報告しています。回避するのではなく、条件を成立させないのが正解です。

鍵は `<Island>` の API です（[付録 A](appendix-a-api.md)）。サーバ側の `<Island>` が受け取るのは **`name`（文字列）と `children`** だけで、**コンポーネント本体を import しません**。登録はクライアントの `start({ islands })` で行われます。

```tsx
// ✗ CartBadge がサーババンドルに入る → stores/cart.ts へ到達 → ビルド失敗
import { CartBadge } from '../islands/CartBadge'
<Island name="CartBadge" trigger="load">
  <CartBadge />
</Island>

// ✓ children はプレースホルダのマークアップだけ。import しない
<Island name="CartBadge" fragment="/_f/cart-badge" trigger="load">
  <span>—</span>
</Island>
```

つまり **Island のコンポーネントがサーババンドルに入るのは、ページが `children` に置いたときだけ**です。置かなければ到達経路そのものが生まれません。

これは新しい規則ではなく、[§5.4](05-store.md) の表が既に要求していることと同一です。

| Island | children | 理由 |
|---|---|---|
| Store を読む（カートバッジ、カート内商品一覧） | **プレースホルダのみ** | pending の影響を受ける値は SSR できない（[§5.4](05-store.md)）。同時に、これがビルド時検証を通す条件でもある |
| Store を読まない（ギャラリー、バリアント選択） | **完成品を SSR する** | LCP を担う（[§6.1.4](06-island.md)） |

**「Store を読む Island は SSR できない」と「Store を読む Island の中身はプレースホルダにする」は同じことを言っています。** 前者はビルドの都合、後者は表示の都合で、たまたま結論が一致しているのではなく、どちらも「サーバは pending を知らない」（[§5.4](05-store.md)）という一点から出ています。

したがって [§6.2](06-island.md) の「✓ store を読むだけ」のコンポーネントは、**本体を一切書き換えずにそのまま使えます**。変わるのは、それを `<Island>` の children に置かないという呼び出し側の書き方だけです。

### 5.3.3 対策 2：API 名で意図を明示

`signal()` を直接使わせず、`zogan/client` の `clientStore()` を経由させます。

```ts
// stores/cart.ts   ★ client-only
import { signal, computed } from '@preact/signals'
import { clientStore } from 'zogan/client'

//  base はサーバ確定値。snapshot からしか更新されない
const base = clientStore('cart', { version: 0, count: 0, lines: [] as Line[] })

//  pending はクライアントの持ち物。素の signal でよい
const pending = signal<Delta[]>([])

export const cart = computed(() => applyDeltas(base.value, pending.value))
export { pending }
```

`clientStore(name, initial)` の役割は 2 つだけです。

1. `name` を registry に登録し、§5.2.3 のマージ対象にする
2. **読み取り専用の signal を返す。** アプリケーションから `base` を直接代入できない

**framework が持つのは `base` だけです。** `pending` は素の `signal` のまま、`applyDeltas` もアプリケーションの純関数のままにします。楽観更新の中身はドメインごとに違うので、抽象化しても当たりません。[§1](01-scope.md) で「pending UI の抽象化」を切ったのと同じ判断です。

型は [付録 A](appendix-a-api.md) を参照。

### 5.3.4 対策 3：初期値は snapshot 経由のみ

```ts
// ✗ サーバから Store に値を渡す経路を作らない
import { cart } from '../stores/cart'
app.page('/', (c) => { cart.value = getCart(c); … })   // 事故

// ✗ キャッシュされるページに snapshot を載せない（§5.5）
app.page('/products/:id', (c) => {
  c.header('Cache-Control', 'public, s-maxage=300')
  return c.render(<Layout><StoreSnapshot name="cart" data={getCart(c)} /></Layout>)
})                                                      // 他人のカートが配られる

// ✓ キャッシュ不能な Fragment の応答に載せる。Store は HTML から読む
app.fragment('cart-badge', (c) => {
  const cart = getCart(c)
  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Cookie')
  return c.html(
    <>
      <StoreSnapshot name="cart" data={cart} />
      <CartBadgeView count={cart.count} />   {/* ★ props で受ける。Store を import しない */}
    </>
  )
})
```

**`CartBadgeView` は `CartBadge` Island とは別のコンポーネントです。** 前者はサーバ側の表示専用で props から描画し、後者はクライアント側で `cart.value` を読みます（[§6.2](06-island.md)）。**Fragment ハンドラはサーババンドルなので、後者をここに置くと [§5.3.2](05-store.md) の検証で落ちます。**

2 つが同じ HTML を出すことは要件です（[§6.1.5](06-island.md)）。

`<StoreSnapshot>` は §5.2.1 の `<script type="application/json">` を出力するだけのコンポーネントです。エスケープを 1 箇所に閉じるために用意します。

**snapshot を出力してよい応答は §5.5 の制約を受けます。** `<StoreSnapshot>` を書く前に、その応答の `Cache-Control` を確認してください。

---

## 5.4 SSR された静的 HTML に共有状態を書かない

サーバは `pending` を知らない。SSR された数字は常に確定値。静的 HTML にカート数を直書きすると、ハイドレート前の一瞬だけ古い数字が見える。

**pending の影響を受ける表示は必ず Island 内に置く。**

### 5.4.1 何が起きるか

```
時刻 0   カートに追加。pending が積まれ、バッジは 4 を表示
時刻 1   別ページへ遷移。応答の HTML には SSR された「3」が入っている
         （サーバは pending を知らないので当然）
時刻 2   差し替え完了。★ 画面に 3 が見える
時刻 3   Island がハイドレート。cart(computed) が 4 を返す
時刻 4   画面が 4 に戻る
```

時刻 2〜3 の間、**カート数が一瞬 3 に戻ります**。

### 5.4.2 対処

| 表示 | pending の影響 | 置き場所 |
|---|---|---|
| カート数バッジ | 受ける | **Island 内**。SSR 済みの中身は「—」等のプレースホルダにする |
| カート内商品一覧 | 受ける | **Island 内** |
| 商品名・価格・説明 | 受けない | 静的 HTML でよい（SEO のためむしろ静的にすべき） |
| 在庫表示 | 受けない | Fragment |
| ログイン名 | 受けない | Fragment |

「SSR 済みの中身をプレースホルダにする」ことと、[§6.1.4](06-island.md) の「SSR 済み。ハイドレート前もそのまま見える」は矛盾しません。**pending の影響を受けない Island は中身を SSR し、受ける Island だけプレースホルダにします。**

> **「初回ロード時は pending が空だから正しい値を SSR できる」という例外を作らないこと。**
>
> 初回ロードだけを見れば正しく見えますが、成立しない理由が 3 つあります。
>
> 1. **カートの確定値は殻に書けません。** 殻は CDN にキャッシュされるので、書けば他ユーザに配られます（[§5.5](05-store.md)）
> 2. **その Island は Store を読むので、コンポーネントをサーババンドルに入れられません。** 中身を SSR しようとすると client-only 検証で落ちます（[§5.3.2](05-store.md)）
> 3. ソフトナビゲーションでは pending が空とは限らず、結局プレースホルダの経路が要ります
>
> 1 と 2 は「やってはいけない」ではなく「**できない**」です。例外を作る余地がありません。

判断が難しければ、**pending の影響を受ける表示は Island 内かつ中身は Store からのみ読み、SSR 済みの中身はプレースホルダにする**という規則で統一してください。

---

## 5.5 【不変条件】snapshot はキャッシュ可能な応答に載せない

**snapshot を含む応答は、CDN・共有プロキシがキャッシュできる状態であってはならない。**

これは [§4.3](04-fragment.md) の不変条件と同じ原則の裏面です。

> §4.3：識別子はキャッシュキーである。ゆえに秘密を含めてはならない
> §5.5：**応答本体はキャッシュされる。ゆえに秘密を含めてはならない**

zogan は殻を CDN に載せることを目的にしています（[§4.1](04-fragment.md)）。その殻に snapshot を埋め込めば、埋め込んだユーザの確定値がそのまま全ユーザへ配信されます。

### 5.5.1 何が起きるか

```
1. A さんが /products/ABC-123 を取得
     app.page が Cache-Control: public, s-maxage=300 を返す
     応答に <script data-store="cart">{"version":41,"count":3}</script> が入っている

2. CDN がこの応答を保持する

3. B さん（未ログイン）が同じ URL を取得 → CDN ヒット
     → A さんのカート snapshot を受け取る

4. B さんの clientStore は initial（version 0）
     41 <= 0 は偽 → store.set(snapshot) が通る          ← §5.2.3

5. B さんの画面に「カート 3 点」が出る
```

**version 比較はこれを防ぎません。** version は「同じユーザのカートが進んだ」ことしか表現できず（[§8.4](08-edge-cases.md) と同じ限界）、他人の snapshot は常に自分の初期値 0 より大きいため必ず通ります。

さらに悪いことに、**既に大きい version を持つユーザには起きません**。ログイン済みでカートを操作した後のユーザは snapshot を無視します。**新規訪問者にだけ間欠的に発生する**ため、開発中もステージングでも再現せず、本番の CDN ヒット時にだけ出ます。

### 5.5.2 強制手段

他の 2 つは静的に強制できます（[§4.3](04-fragment.md) は API の型、[§5.3](05-store.md) はビルド時の到達検出）。これだけは**応答生成時のミドルウェア検査**になります。snapshot の出力有無と `Cache-Control` の値は、どちらも実行時にしか確定しないためです。

`zogan()` ミドルウェアが応答を返す直前に行うこと：

```
if 応答 body に <script type="application/json" data-store が含まれる:
  cc = 応答の Cache-Control
  if cc が未指定 または キャッシュ可能（no-store / private のいずれも無い）:
    開発ビルド → 例外
    本番ビルド → Cache-Control を 'private, no-store' に上書きして警告
```

**本番で例外にせず上書きする**のは、[§4.2.1](04-fragment.md) の `Cache-Control` 未指定と同じ判断です。安全側に倒してページは配信し、警告でログに残します。性能事故は起きますが、情報漏洩よりは安い。

検査を body の文字列走査で行うのは、**`<StoreSnapshot>` を経由しない手書きの `<script data-store>` も捕まえる**ためです（[§5.3.4](05-store.md) は手書きを禁じていますが、禁止は検査の代わりになりません）。

### 5.5.3 `app.page` の `Cache-Control`

この不変条件のため、**`app.page` の応答も `Cache-Control` を明示すること**を規則にします。[§4.2.1](04-fragment.md) が `app.fragment` に課しているものと同じです。

| 応答 | 既定 |
|---|---|
| `app.page` / `app.fragment` とも未指定 | 開発ビルドで例外。本番は `private, no-store` + 警告 |

未指定を `no-store` に倒すのは安全側ですが、**殻がキャッシュされないので zogan の存在意義が消えます**。警告を無視しないこと。設定値の実例は [§4.4](04-fragment.md)。

### 5.5.4 例外を作らないための言い換え

判断に迷ったら次の 1 問です。

> **その応答は、別のユーザに丸ごと配られても問題ないか？**

- **YES** → キャッシュしてよい。snapshot を載せてはならない
- **NO** → `private, no-store` にする。snapshot を載せてよい

**「載せたいから no-store にする」は正しい動機です。** cart Fragment がまさにそれで、200 バイトの応答をキャッシュできない代わりに 40KB の殻がキャッシュできます（[§4.1.1](04-fragment.md)）。
