# zogan

[English](README.md) | [日本語](README.ja.md)

> HonoとPreactのための、明示的なHTMLレスポンスと型付きIsland。

zoganは、サーバーレンダリングのリクエスト／レスポンスサイクルを小さく見通しよく保ちます。ルートは完全なPageまたは生のFragment HTMLを明示的に返し、すべてのHTMLレスポンスはopaqueなCachePolicyを持ち、宣言されたIslandだけがブラウザで動きます。リンク、フォーム、ナビゲーション、履歴の所有者は引き続きブラウザです。

> [!IMPORTANT]
> zoganはプレリリース段階です。1.0までは破壊的変更が入る可能性があります。

## なぜzoganなのか

HonoはすでにWeb標準のリクエストをルーティングし、Preactはすでにコンポーネントをレンダリングします。zoganはアプリケーションフレームワークになることなく、その間に狭い境界だけを加えます。

- 1つのURLは、宣言された1つの表現を持つ
- PageとFragmentのルートは通常のHonoルートである
- すべてのHTMLレスポンスに明示的なキャッシュポリシーを要求する
- FragmentSlotは明示的にマークされた領域だけを更新する
- 型付きIslandは検証済みのJSON propsを受け取り、遅延ロードされる
- リンク、フォーム、リダイレクト、履歴はブラウザ本来の動作を保つ

ルート、データアクセス、認可、変更処理、ドメイン状態はアプリケーションが所有します。zoganが所有するのはHTMLレスポンスfactoryと、明示的なFragmentおよびIsland markerの起動です。

## インストール

zoganと、アプリケーションとの間で共有するランタイムをインストールします。

```sh
pnpm add zogan hono preact
```

オプションのIsland遅延entry generatorを使う場合だけ、Viteもインストールします。

```sh
pnpm add -D vite
```

Deno 2.9以降の場合:

```sh
deno add jsr:@maya0513/zogan npm:hono npm:preact
```

JSRパッケージは、npmのentry pointである `zogan`、`zogan/client`、`zogan/vite` に対応する `@maya0513/zogan`、`@maya0513/zogan/client`、`@maya0513/zogan/vite` を公開します。

## クイックスタート

レスポンスhelperを一度作り、その後は通常のHonoルートで使います。`page()`と`fragment()`の第3引数はどちらも必須です。

```tsx
import type { ComponentChildren } from "preact";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  createZogan,
  defineIsland,
  FragmentSlot,
  Island,
  privateNoStore,
  publicCache,
} from "zogan";
import Counter, { type CounterProps } from "./islands/Counter";

const Layout = ({ children }: { children?: ComponentChildren }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>My app</title>
    </head>
    <body>
      {children}
      <script type="module" src="/src/client.ts" />
    </body>
  </html>
);

const app = new Hono();
const zogan = createZogan({ layout: Layout });
const counter = defineIsland<CounterProps>({ id: "Counter", component: Counter });

app.get("/", (c) =>
  zogan.page(
    c,
    <main>
      <h1>My app</h1>
      <a href="/about">About</a>
      <form action="/search" method="get">
        <input name="q" />
        <button type="submit">Search</button>
      </form>
      <FragmentSlot as="span" src="/fragments/cart-badge">
        <a href="/cart">Cart —</a>
      </FragmentSlot>
      <Island of={counter} props={{ initial: 0 }} trigger="visible" />
    </main>,
    { cache: publicCache({ sMaxAge: 60, staleWhileRevalidate: 300 }) },
  ),
);

app.get("/fragments/cart-badge", (c) => {
  const count = getCookie(c, "cart_count") ?? "0";
  return zogan.fragment(c, <a href="/cart">Cart {count}</a>, {
    cache: privateNoStore({ vary: ["Cookie"] }),
  });
});

export default app;
```

Fragment endpointが返すのは、slotの内容を置き換えるchildrenだけです。ドキュメントや`<span>` wrapperを繰り返して返しません。

`src/islands/Counter.tsx`にコンポーネントを定義します。`defineIsland()`はこのコンポーネントをサーバーでレンダリングし、正確なprops型を`<Island>`へ伝えます。

```tsx
import { useState } from "preact/hooks";
import type { JsonObject } from "zogan";

export type CounterProps = JsonObject & {
  readonly initial: number;
};

export default function Counter({ initial }: CounterProps) {
  const [count, setCount] = useState(initial);
  return <button onClick={() => setCount((value) => value + 1)}>Count {count}</button>;
}
```

オプションのVite pluginを設定します。filename stemの`Counter`がlazy loader IDになり、サーバーdescriptor IDの`"Counter"`と正確に一致する必要があります。moduleのdefault exportがブラウザ側のコンポーネントです。

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { zoganVite } from "zogan/vite";

export default defineConfig({
  plugins: [zoganVite({ islandsDir: "src/islands" })],
});
```

生成されたentryをブラウザentryから一度だけimportします。生成module自体が`start()`を呼び、dynamic import loaderを登録します。Island moduleはtriggerが発火するまで要求されません。下のnamed importと`void`式は、side-effect importを禁止する厳格なlint ruleを満たすためだけのものです。

```ts
// src/client.ts
import { islands } from "virtual:zogan/islands";

void islands;
```

virtual moduleのambient宣言を追加します。

```ts
// src/virtual.d.ts
declare module "virtual:zogan/islands" {
  export const islands: Readonly<Record<string, import("zogan/client").IslandLoader>>;
}
```

Vite pluginを使わない場合は、明示的なloader mapを渡してブラウザruntimeを起動します。

```ts
import { start } from "zogan/client";

start({ islands: { Counter: () => import("./islands/Counter") } });
```

## モデル

| 境界     | サーバーのcontract                                                                     | ブラウザのcontract                                             |
| -------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Cache    | opaqueな`CachePolicy`を作り、すべてのPageとFragmentレスポンスへ渡す。                  | 通常のHTTP cacheが働く。zoganはclient cacheを追加しない。      |
| Page     | `zogan.page(c, vnode, { cache })`がdoctype、任意のlayout、完全なHTMLを返す。           | ブラウザが通常どおり遷移する。                                 |
| Fragment | 明示的なルートが`zogan.fragment(c, vnode, { cache })`で生のHTMLを返す。                | 対応する`FragmentSlot`が自身のchildrenだけを置き換えられる。   |
| Island   | `defineIsland()`または`defineClientIsland()`がID、mode、component、props型を宣言する。 | 対応するlazy moduleがtriggerの発火時にhydrateまたはmountする。 |

### CachePolicy

`CachePolicy`はopaqueなので、ルートがキャッシュ動作を誤って省略したり、気軽に組み立てたりできません。

- `publicCache({ maxAge, sMaxAge, staleWhileRevalidate, immutable, vary })`はshared cache向けpolicyを作る。`maxAge`の既定値は`0`
- `privateNoStore({ vary })`はユーザー固有HTML向けの`private, no-store`を作る
- `cachePolicy(value, { vary })`はその他のdirective用に検証されたescape hatch

policyの`Vary`名は、Hono contextにすでにある値と大文字小文字を区別せずにmergeされます。

### PageとFragment

`createZogan({ layout })`はstatelessな`page`と`fragment`のresponse factoryを返します。ルートの登録やHonoの変更は行いません。Pageは任意のlayoutを使いdoctypeから始まり、Fragmentはlayoutを使わない生のHTMLです。

各Fragmentには、root-relativeかつsame-originな専用URLを与えます。`<FragmentSlot>`はchildrenを有用なserver fallbackとしてレンダリングし、そのURLを`load`、`idle`、`visible`、`manual`、`media:…`のいずれかで取得できます。既定値は`load`です。`as`で対応HTML containerを選び、必要に応じて通常のDOM属性を渡せます。

`zogan/client`の`refreshFragment(src)`は、sourceが`src`と正確に一致する接続中のslotをすべて再取得します。`manual` slotが変化するのはこの呼び出しのときだけです。

### 型付きIsland

`defineIsland({ id, component })`は`hydrate` modeで、`component`をサーバーレンダリングします。`defineClientIsland({ id, fallback })`は`mount` modeで、`fallback`をサーバーレンダリングします。`<Island>`は常に固定の`<div>` ownerを出力します。

Island propsは必須で、plain JSON objectでなければなりません。ネストしたarrayとplain objectは使えますが、cycle、`undefined`、function、symbol、bigint、非有限number、class instanceは拒否されます。activation triggerは`load`、`idle`、`visible`、`media:…`です。

descriptorはserver renderingと`<Island>` propsをcompile timeに検査します。runtime lookupも意図的に明示されています。descriptor IDは登録済みloader IDと一致する必要があり、Vite pluginは各`src/islands/*.tsx`のfilenameからそのIDを作ります。

## ネイティブな基準動作と失敗時の動作

zoganはリンクやフォームをinterceptせず、ブラウザ履歴を管理しません。完全なPageを作り、通常のform actionを使い、変更成功後はPOST/Redirect/GETなどでredirectしてください。JavaScriptが無効でもアプリケーションは利用できます。

FragmentとIslandの拡張はfail-closedです。不正なURL、redirect、失敗status、誤ったcontent type、不正marker、loader error、render errorが起きた場合、server fallbackを維持または復元します。ownerのnestは曖昧に更新せず拒否されます。

対話的なIslandは、native formをアプリケーションのJSON endpointで拡張し、その後に関連Fragmentを更新できます。ただしPOSTの通信失敗は、server commit前の失敗とcommit後の応答喪失を区別できません。request dispatch後にnative formを自動再送せず、reloadを促すか、APIとnative routeで共有するidempotency keyを使ってください。JavaScriptが無効な場合、最初のsubmitは常にnativeです。

```ts
try {
  const response = await updateApplicationState();
  if (!response.ok) throw new Error(`unexpected response ${response.status}`);
  await refreshFragment("/fragments/cart-badge");
} catch {
  showReloadRequired();
}
```

## サンプル

- [紹介サイト](examples/site) — Cache、Page、Fragment、Islandのモデルをひと目で確認できるサイト
- [Workers + D1 shop](examples/shop) — 公開product Page、privateなcart HTML、nativeなfilterおよびmutation flow、任意のAdd-to-Cart Island
- [Denoサンプル](examples/deno) — 明示的なPageおよびFragmentルートと、hydrateおよびclient-only Island。[公開デモ](https://zogan-deno.maya0513.deno.net)

## ドキュメント

- [仕様書](docs/spec/README.md)
- [公開API](docs/spec/appendix-a-api.md)
- [HTTPとDOMのcontract](docs/spec/appendix-b-markup.md)

## 対応環境

- Hono `>=4.13.0 <5`
- Preact `>=10.29.8 <11`
- `zogan/vite`を使う場合はVite `^8.0.0`（任意）
- JSRパッケージとDenoサンプルはDeno 2.9以降
- npmの開発とpackage作成にはNode.js 24.11以降
- Honoが対応するWeb標準ベースのserver runtime
- ESMのみ

`hono`と`preact`はpeer dependencyです。`vite`は任意のpeer dependencyです。`preact-render-to-string`はzogan内部のrendering dependencyとしてインストールされます。

## ライセンス

[MIT](LICENSE)
