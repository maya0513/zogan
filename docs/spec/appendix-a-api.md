# 付録 A：API 契約

> **この付録は新しい設計判断を含みません。** 本編で下された判断を、実装が直接参照できる型として書き下したものです。本編と矛盾する記述があれば**本編が正**です。
>
> API は既存実装（Fresh / Astro / Hono）に既にある形をそのまま使い、zogan 固有の抽象を増やしていません。

---

## A.1 `zogan`（サーバ）

### A.1.1 セットアップ

```ts
import { Hono } from 'hono'
import { zogan } from 'zogan'

const app = new Hono()
zogan(app, { layout: Layout })
```

`zogan()` は対象の Hono アプリへレンダラミドルウェアとアプリ固有設定を登録します。**Hono の既存機構（`c.setRenderer`）を使い**、独自のアプリケーションクラスは作りません。設定はアプリをキーに保持され、同じ isolate の別アプリと混線しません。

```ts
interface ZoganOptions {
  /** c.render() が包むレイアウトコンポーネント */
  layout?: (props: { children: ComponentChildren }) => VNode
  /** Fragment のエンドポイント接頭辞。既定 '/_f/'（§名称） */
  fragmentPrefix?: string
}

declare function zogan<
  E extends Env,
  S extends Schema,
  BasePath extends string,
>(app: Hono<E, S, BasePath>, options?: ZoganOptions): Hono<E, S, BasePath>
```

### A.1.2 `app.page`

```ts
declare module 'hono' {
  interface Hono<E, S, BasePath> {
    /**
     * ページルートを登録する。GET のみ。
     * X-Partial ヘッダがあれば同じハンドラを再実行し、
     * 指定領域だけを返す（§3.2）。
     */
    page(path: string, handler: PageHandler<E>): this
  }
}

type PageHandler<E extends Env> = (c: Context<E>) => Response | Promise<Response>
```

| 項目 | 内容 |
|---|---|
| メソッド | `GET` のみ登録 |
| ハンドラの再実行 | 部分要求でも**同じハンドラを 1 回実行**する。分岐を書く必要はない |
| 部分要求の判定 | ハンドラ内では `c.req.partials` で参照できる。**通常は見なくてよい** |
| 応答の切り出し | `c.render()` の戻りから zogan がマーカー範囲を切り出す |
| `Cache-Control` | **ハンドラが必ず明示する。** 未指定は開発ビルドで例外（[§5.5](05-store.md)） |
| `Vary` | ミドルウェアが `X-Partial` を付ける。**フルページ応答・部分応答の両方**（[§3.2.4](03-partial.md)） |

**ハンドラは部分要求かどうかを意識しないのが既定です。** `c.req.partials` を見て分岐を書き始めたら、[§3.2](03-partial.md) の「同じハンドラを再実行する」という設計から外れています。分岐が正当なのは、重い処理を部分要求時に省く最適化のときだけです。

### A.1.3 `app.fragment`

```ts
declare module 'hono' {
  interface Hono<E, S, BasePath> {
    /**
     * Fragment を登録する。GET /_f/{name} に対応。
     * name には Hono のパスパラメータを含められる（'stock/:sku'）。
     *
     * 【不変条件・§4.3】ハンドラの引数は Context のみ。
     * props を渡す口を作らない。ユーザ固有の値は Cookie から読む。
     */
    fragment(name: string, handler: FragmentHandler<E>): this
  }
}

type FragmentHandler<E extends Env> = (c: Context<E>) => Response | Promise<Response>
```

| 項目 | 内容 |
|---|---|
| メソッド | `GET` のみ |
| パス | `${fragmentPrefix}${name}`。既定は `/_f/{name}` |
| レイアウト | **適用しない**（[§4.2.3](04-fragment.md)） |
| `Cache-Control` | **ハンドラが必ず明示する。** 未指定は開発ビルドで例外（[§4.2.1](04-fragment.md)） |

**`FragmentHandler` の引数が `Context` だけであることが、[§4.3](04-fragment.md) の不変条件を型で強制しています。** 渡す口が無ければ違反しようがありません。この型を緩めないこと。

### A.1.4 `Context` の拡張

```ts
declare module 'hono' {
  interface HonoRequest {
    /**
     * X-Partial ヘッダの内容。
     * null = フルページ要求。string[] = 部分要求。
     */
    readonly partials: string[] | null
  }
}
```

`c.render(vnode)` は Hono の標準機能です。`zogan()` ミドルウェアがレンダラを差し替え、`<Partial>` をマーカー付きで出力します。

### A.1.5 `<Partial>`

```tsx
type PartialMode = 'replace' | 'append' | 'prepend'

interface PartialProps {
  /** 領域名。^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$（§3.1.1） */
  name: string
  /** 既定 'replace' */
  mode?: PartialMode
  /** mode が append/prepend のとき必須（§3.4.1） */
  key?: string | number
  children?: ComponentChildren
}

declare function Partial(props: PartialProps): VNode
```

> **注意：`key` は Preact の予約 prop であり、コンポーネントの `props` には届きません。**
>
> `createElement` が `key` を `vnode.key` へ抜き出すためです。zogan は SSR 中に Preact の `options.vnode` フックで `vnode.key` を読み、[§3.4.1](03-partial.md) の検証とマーカー出力に使います。
>
> **`partialKey` のような別名を作らないこと。** Fresh と同じ `key` を使うのが正しく、Preact のフックで読めば済みます。

出力：

```html
<!--p:results-->{children}<!--/p:results-->
```

`mode` と `key` は**マーカーには出力しません**。クライアントは応答ヘッダとリンクの `data-partial` から動作を決めるためです。

### A.1.6 `<StoreSnapshot>`

```tsx
interface StoreSnapshotProps<T extends { version: number }> {
  /** clientStore() の登録名と一致すること */
  name: string
  data: T
}

declare function StoreSnapshot<T extends { version: number }>(
  props: StoreSnapshotProps<T>
): VNode
```

出力（[§5.2.1](05-store.md)）：

```html
<script type="application/json" data-store="cart">{"version":41,…}</script>
```

**エスケープ（`<` → `\u003c`）をこのコンポーネントに閉じ込めるために存在します。** 手で `<script type="application/json">` を書かないこと。

**【不変条件・[§5.5](05-store.md)】このコンポーネントを含む応答は `Cache-Control` に `no-store` を持たなければなりません。** `zogan()` ミドルウェアが応答生成時に照合し、違反していれば開発ビルドで例外、本番ビルドでは `private, no-store` に上書きして警告します。

| 出力してよい応答 | 例 |
|---|---|
| `private, no-store` の Fragment | cart-badge、会員価格 |
| `private, no-store` の `app.page` | カートページ、注文履歴 |
| 非 GET の応答 | `POST /cart/add` |

`public, s-maxage=N` を返すページに置くと、そのユーザの確定値が CDN 経由で全ユーザに配信されます。

### A.1.7 `<Island>`

```tsx
interface IslandProps {
  /** 登録済みコンポーネント名 */
  name: string
  /** JSON 直列化可能な値のみ。秘密や巨大データを入れない（§6.1.1） */
  props?: Record<string, unknown>
  /** 既定 'load' */
  trigger?: IslandTrigger
  /**
   * Fragment の取得先 URL（§6.1.5）。単一の URL のみ。
   * trigger 発火時に 1 回取得し、応答で children を置換する。
   * 省略時は取得しない。
   *
   * 【不変条件・§4.3】値はサーバが SSR 時に書くもののみ。
   * クライアントから組み立てる口を作らない。
   */
  fragment?: string
  /**
   * SSR 済みの中身。§6.1.4 のとおり完成品として成立させる。
   *
   * 【§5.3.2】Store を読む Island / Fragment を取得する Island では、
   * ここにプレースホルダのマークアップだけを書き、
   * コンポーネントを import しないこと。
   */
  children?: ComponentChildren
}

type IslandTrigger = 'load' | 'idle' | 'visible' | 'none' | `media:${string}`
```

出力（[§6.1](06-island.md)）：

```html
<div data-island="CartBadge" data-props='{"variant":"compact"}' data-trigger="load">…</div>
```

**`<Island>` はコンポーネントを import しません。** 受け取るのは `name`（文字列）と `children` だけで、名前からコンポーネントへの解決はクライアントの `start({ islands })` が行います。

この非対称性が [§5.3](05-store.md) の不変条件を成立させています。Island のコンポーネントがサーババンドルに入るのは、**ページが `children` にそれを置いたときだけ**です。Store を読む Island で children をプレースホルダに留めれば、サーバから Store への到達経路が存在しません（[§5.3.2](05-store.md)）。

---

## A.2 `zogan/client`

### A.2.1 `start`

```ts
interface StartOptions {
  /** data-island の名前 → コンポーネント の対応表 */
  islands: Record<string, ComponentType<any>>
  /** サーバの設定と一致する Fragment prefix。既定 '/_f/' */
  fragmentPrefix?: string
  /** BFCache 復帰時に再取得する Fragment URL */
  refreshOnRestore?: string[]
}

declare function start(options: StartOptions): void
```

呼び出しは 1 回だけ。実行すると次を行います。

1. 文書全体の `[data-store]` をマージ（[§5.2.3](05-store.md)）
2. 文書全体の `[data-island]` を trigger に従ってハイドレート（[§6.1.3](06-island.md)）
3. クリック・submit・`popstate`・`pageshow` のリスナを登録

submit のリスナは [§7.2.4](07-client-runtime.md) の経路に入ります。`data-partial` / `data-fragment` のどちらも持たないフォームは傍受しません（[§7.1.3](07-client-runtime.md)）。

**1 が 2 より先**であることは初回ロードでも必須です（[§7.2.2](07-client-runtime.md)）。

### A.2.2 `clientStore`

```ts
/**
 * サーバ確定値（base）を保持する読み取り専用 signal を返す。
 * 値は <script data-store="name"> の snapshot からのみ更新される。
 * version が現在値より大きい場合だけ上書きされる（§5.1）。
 *
 * 【不変条件・§5.3】この関数を import したモジュールは client-only。
 * zogan/vite がサーババンドルからの到達を検出して失敗させる。
 */
declare function clientStore<T extends { version: number }>(
  name: string,
  initial: T
): ReadonlySignal<T>
```

**framework が持つのは `base` だけです。** `pending` と `applyDeltas` はアプリケーション側に残します。

```ts
// stores/cart.ts   ★ client-only
import { signal, computed } from '@preact/signals'
import { clientStore } from 'zogan/client'

const base    = clientStore('cart', { version: 0, count: 0, lines: [] as Line[] })
const pending = signal<Delta[]>([])

export const cart = computed(() => applyDeltas(base.value, pending.value))
export { pending }
```

| 特性 | 理由 |
|---|---|
| 戻り値が `ReadonlySignal` | アプリケーションから `base` へ代入させない。[§5.1](05-store.md) の「`base` は version が手元より大きい時のみ上書き」を、書き込み口を塞ぐことで保証する |
| `T extends { version: number }` | version 比較マージの前提を型で保証する |
| `pending` を含まない | 楽観差分の形はドメインごとに違う。抽象化しても当たらない（[§5.3.3](05-store.md)） |
| 名前が `signal` でない | [§5.3](05-store.md) の対策 2。API 名で client-only であることを示す |

`clientStore` は登録時に、**まだ適用されていない snapshot（`deferred`）を引きます**（[§5.2.3](05-store.md)）。Island を遅延読み込みするビルドでは、`start()` の走査時点でこの Store がまだ登録されていないためです。適用の可否は通常のマージと同じ version 比較で決まります。

### A.2.3 `mergeSnapshots`

```ts
/**
 * snapshot を base にマージする。version が現在値より大きい場合だけ適用（§5.2.3）。
 *
 * ランタイムが差し替え時に呼ぶほか、BroadcastChannel での
 * タブ間同期（§8.2）からアプリケーションが呼ぶ。
 */
declare function mergeSnapshots(source: Node[] | Record<string, unknown>): void
```

| 引数の形 | 用途 |
|---|---|
| `Node[]` | 今回挿入されたノード列。中から `[data-store]` を集めて適用する |
| `Record<string, unknown>` | `{ [storeName]: snapshot }`。DOM を経由しない経路（`BroadcastChannel`） |

**`Node[]` であって単一の `Element` ではありません。** 挿入範囲はマーカー間の兄弟ノード列であり、それを囲む要素が存在しないためです（[§5.2.3](05-store.md)）。

未登録の Store 名は捨てずに保持され、`clientStore` の登録時に適用されます。

### A.2.4 `navigating` / `pendingPartials`

```ts
/** ソフトナビゲーションが進行中か */
declare const navigating: ReadonlySignal<boolean>

/** 現在取得中の領域名。進行中でなければ [] */
declare const pendingPartials: ReadonlySignal<string[]>
```

```jsx
import { navigating } from 'zogan/client'
export default () => navigating.value ? <Spinner /> : null
```

Store と同じ signal 基盤に乗るため、**ローディング表示のための追加機構は要りません**（[§7.3.2](07-client-runtime.md)）。

### A.2.5 `navigate` / `refreshFragment`

```ts
interface NavigateOptions {
  /** 要求する領域。省略時は現在の DOM のマーカー全部（§7.2.3） */
  partials?: string[]
  /** true なら pushState ではなく replaceState */
  replace?: boolean
}

/** プログラムからソフトナビゲーションを起こす */
declare function navigate(url: string | URL, options?: NavigateOptions): Promise<void>

/**
 * Fragment を取り直して DOM に反映する。
 *
 * 反映先は [data-island][data-fragment="url"] に完全一致する要素すべて。
 * 該当が無ければ警告して何もしない（§7.1.4）。
 *
 * 【§4.3.3】url は SSR 済み HTML に書かれたものだけを渡すこと。
 * 任意のクエリを組み立てて渡さない。
 */
declare function refreshFragment(url: string): Promise<void>
```

反映先の解決規則は [§7.1.4](07-client-runtime.md) にあります。要点は 2 つです。

- **反映先は `data-fragment` の値が完全一致する Island のみ。** 該当が複数あれば全部を同じ応答で更新する
- **該当が 1 つも無ければ何もしない。** サーバが SSR 時に書いていない URL を渡しても反映先が存在しないため、[§4.3](04-fragment.md) の不変条件が構造的に守られる

`refreshFragment` は [§8](08-edge-cases.md) の 2 ケース（チェックアウト遷移前・`pageshow`）のために存在します。**それ以外の用途で使わないこと。** 定期ポーリングに使い始めたら、Fragment の `s-maxage` を短くするほうが正しい解決です。

---

## A.3 `zogan/vite`

```ts
interface ZoganPluginOptions {
  /**
   * client-only とみなすモジュールの glob。
   * 既定 ['**​/stores/**']
   * これに加えて、zogan/client から clientStore を named import する
   * モジュールは常に client-only とみなされる（§5.3.2）。
   *
   * navigating / pendingPartials の import は対象外。
   * これらは SSR 中に読んでも安全で、Island が正当に使う。
   */
  clientOnly?: string[]
  /** Island のソースディレクトリ。Vite root 基準。既定 'src/islands' */
  islandsDir?: string
}

declare function zoganVite(options?: ZoganPluginOptions): Plugin
```

プラグインが行うこと：

| # | 処理 | 参照 |
|---|---|---|
| 1 | サーババンドルから client-only モジュールへの到達を検出し、**到達パス付きで失敗させる** | [§5.3.2](05-store.md) |
| 2 | `<Partial>` の `name` を検証（正規表現・重複） | [§3.1.1](03-partial.md) |
| 3 | `mode` が `append` / `prepend` で `key` が無ければ警告 | [§3.4.1](03-partial.md) |
| 4 | Island のクライアント側エントリを生成 | [§6.1](06-island.md) |

**1 が本体です。** 2〜4 は利便性であり、1 だけは安全性の担保として外せません。

4 で生成するエントリは `start({ islands })` の呼び出しであり、**クライアントバンドルの起点**です。Island のコンポーネントはここからのみ参照されます。1 の走査対象はサーババンドルのグラフなので、このエントリは含みません — **4 が 1 を成立させています**。

Island を遅延読み込み（動的 `import()`）するエントリを生成する場合、[§5.2.3](05-store.md) の遅延マージ規則が必要になります。Store の registry 登録がハイドレート時まで遅れるためです。

---

## A.4 型で守っている不変条件

| 不変条件 | 型・ビルドでの強制 | 残り | 守る手段 |
|---|---|---|---|
| [§4.3](04-fragment.md) Fragment 引数は URL 由来の ID のみ | `FragmentHandler` の引数が `Context` のみ。取得先は `data-fragment` としてサーバが SSR 時に書く（[§6.1.5](06-island.md)） | `refreshFragment` に任意 URL を渡す経路 | 実行時に `fragmentPrefix` 配下・同一オリジンを検証（[§B.1](appendix-b-markup.md)）。**[§10](10-acceptance.md) の 15** |
| [§5.3](05-store.md) Store はクライアント専用 | `clientStore` の named import を持つモジュールへの到達をビルド時に検出 | 無し | — |
| [§5.5](05-store.md) snapshot はキャッシュ可能な応答に載せない | **型では防げない**（`Cache-Control` は実行時の値） | 全部 | 応答生成時のミドルウェア照合。**[§10](10-acceptance.md) の 11・12・14** |
| [§5.1](05-store.md) `base` を直接書かない | 戻り値が `ReadonlySignal` | 無し | — |
| [§5.1.2](05-store.md) snapshot に version が必要 | `T extends { version: number }` | サーバ側が version を進め忘れる | **[§10](10-acceptance.md) の 3** |

**「残り」の列が空でない行には、必ず [§10](10-acceptance.md) の項目番号が対応します。** 対応が無い行があれば、それは仕様の穴です。

§5.5 だけが「型・ビルドでの強制」を持ちません。snapshot の出力有無と `Cache-Control` の値は、どちらも応答生成時にしか確定しないためです。**その分だけ受け入れテストの比重が重く、[§10](10-acceptance.md) の 11 は CI 必須**にしています。
