# zogan

[English](README.md) | [日本語](README.ja.md)

> HonoとPreactのサーバーレンダリングに、明確な更新境界とキャッシュ境界を加えるライブラリ。

zoganは、HTMLのリクエスト／レスポンスサイクルをアプリケーションの中心に据えます。同じHonoとPreactのコードから、ページ全体、名前付きの領域、個別にキャッシュできるFragmentを返せます。ブラウザナビゲーションとIslandはプログレッシブエンハンスメントとして機能し、JavaScriptがなくてもリンクとフォームはそのまま動作します。

> [!IMPORTANT]
> zoganはプレリリース段階です。公開コントラクトはテストされていますが、1.0までは破壊的変更が入る可能性があります。

## なぜzoganなのか

HonoはルーティングとWeb標準のレスポンスを提供し、Preactはコンポーネントとハイドレーションを提供します。zoganはルーター、データローダー、アプリケーションフレームワークになることなく、その間を接続します。

- 1つのハンドラーからページ全体と名前付きPartialをレンダリングする
- ユーザー固有のFragmentと公開Fragmentに別々のキャッシュポリシーを設定する
- ブラウザ上の振る舞いが必要なコンポーネントだけをハイドレートする
- ドメインロジックを所有せず、バージョン付きのサーバー状態を同期する
- ネイティブフォールバックを保ちながら、同一オリジンのリンクとフォームを拡張する

ルーティング、データアクセス、認可、キャッシュ基盤は引き続きアプリケーションが所有します。zoganはレンダリングプロトコルを担当し、DOMを書き換える前にレスポンスを検証します。

## クイックスタート

zoganと、アプリケーションとの間で共有するランタイムをインストールします。

```sh
pnpm add zogan hono preact @preact/signals
pnpm add -D vite
```

Deno 2.9以降では、JSRパッケージと共有するnpmランタイムをインストールします。

```sh
deno add jsr:@maya0513/zogan npm:hono npm:preact npm:@preact/signals
```

`@maya0513/zogan`、`@maya0513/zogan/client`、`@maya0513/zogan/vite`の3つのエントリポイントを、npm版と同じように利用できます。

Honoアプリをセットアップし、ページを登録します。

```tsx
import { Hono } from "hono";
import { Partial, zogan } from "zogan";

const app = new Hono();

zogan(app, {
  layout: ({ children }) => (
    <html>
      <body data-client-nav>{children}</body>
    </html>
  ),
});

app.page("/articles", (c) => {
  const page = Number(c.req.query("page") ?? 1);
  c.header("Cache-Control", "public, max-age=0, s-maxage=60");

  return c.render(
    <main>
      <Partial name="articles">
        <ArticleList page={page} />
      </Partial>
      <a href={`/articles?page=${page + 1}`} data-partial="articles">
        Next page
      </a>
    </main>,
  );
});

export default app;
```

ブラウザランタイムを一度だけ起動します。

```ts
import { start } from "zogan/client";

start({ islands: {} });
```

クライアントが起動するまでは通常のリンクとして動作します。起動後はzoganが`articles`を要求し、レスポンスのコントラクトを検証してから、マーカーで囲まれた領域だけを置き換えます。

## レンダリングモデル

```text
通常のリクエスト ─────────────────> HTMLドキュメント全体
X-Partial: results ───────────────> 同じページ内の名前付き領域
GET /_f/account-summary ──────────> 個別にキャッシュできるHTML Fragment
data-island="AccountMenu" ────────> Preactの選択的ハイドレーション
```

### Partial

`<Partial name="results">`は、ページハンドラーが生成する領域に名前を付けます。`data-partial="results"`を持つリンクやGETフォームは、別のデータ取得経路を追加することなく、その領域を要求します。

### Fragment

`app.fragment()`は、デフォルトでは`/_f/`以下に小さなHTMLエンドポイントを登録します。Fragmentは独立した`Cache-Control`ポリシーを持ち、同じ取得先を使う複数のIsland間では1つの処理中リクエストを共有します。

```tsx
app.fragment("account-summary", async (c) => {
  const account = await readAccount(c);
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie");
  return c.render(<AccountSummary account={account} />);
});
```

### Island

`<Island>`は、最初に意味のあるサーバーレンダリング済みHTMLを返し、その後、load、idle、表示領域への進入、メディアクエリ、明示的トリガーのいずれかで、名前付きPreactコンポーネントをハイドレートします。コンポーネントの解決はクライアントエントリに留まるため、クライアント専用コードをサーバーグラフへ含める必要がありません。

```tsx
<Island name="AccountMenu" fragment="/_f/account-summary" trigger="visible">
  <a href="/account">Account</a>
</Island>
```

```ts
import { start } from "zogan/client";
import AccountMenu from "./islands/AccountMenu";

start({ islands: { AccountMenu } });
```

### Store

`clientStore()`は、最新のサーバー確定値を保持する読み取り専用signalを公開します。`<StoreSnapshot>`は数値のversionが増加した場合にだけ値を更新します。楽観的変更とビジネスルールは、引き続きアプリケーション側の状態として扱います。

## Vite連携

オプションのViteプラグインはIslandエントリを生成し、動的importやre-export経路を含め、クライアント専用のStoreモジュールがサーバーバンドルから到達可能になることを防ぎます。

```ts
import { defineConfig } from "vite";
import { zoganVite } from "zogan/vite";

export default defineConfig({
  plugins: [zoganVite({ islandsDir: "src/islands" })],
});
```

`zogan/vite`エントリを使わない場合、Viteは必須ではありません。

## 失敗時の動作とキャッシュ境界

成功するすべてのページハンドラーとFragmentハンドラーは、`Cache-Control`を明示的に設定します。Store snapshotを含むレスポンスには、正確な`no-store`ディレクティブが必要です。ブラウザランタイムはDOMを更新する前に、オリジン、リダイレクト、Content-Type、プロトコルヘッダー、要求されたマーカー、Fragment prefixを検証します。拡張されたリクエストのレスポンスが不正な場合は、通常のブラウザ動作へフォールバックします。

これは汎用的なHTML取得ヘルパーよりも意図的に厳格な設計です。zoganのレスポンスの前段にプロキシやキャッシュを追加する場合は、[HTTPとDOMのコントラクト](docs/spec/appendix-b-markup.md)を確認してください。

## サンプル

- [紹介サイト](examples/site) — レンダリングモデルと導入手順を簡潔に説明するサイト
- [Workers + D1デモ](examples/shop) — 閲覧、絞り込み、プライベートなカート状態、疑似チェックアウト、キャッシュポリシー、JavaScript無効時の動線を含むサンプル
- [Denoサンプル](examples/deno) — Deno上の動的SSR、部分遷移、Fragment、Island、Store。[公開デモ](https://zogan-deno.maya0513.deno.net)

## ドキュメント

- [仕様書](docs/spec/README.md)
- [公開API](docs/spec/appendix-a-api.md)
- [HTTPとDOMのコントラクト](docs/spec/appendix-b-markup.md)

## 対応環境

- Hono 4.13以降
- Preact 10.29以降
- `@preact/signals` 2.11以降
- `zogan/vite`を使う場合はVite 8
- JSRパッケージとDenoサンプルはDeno 2.9以降
- 開発とパッケージングにはNode.js 24.11以降
- Honoが対応する、Web標準に基づいたサーバーランタイム
- ESMのみ

`hono`、`preact`、`@preact/signals`はpeer dependencyです。これにより、zoganとホストアプリケーションがランタイムと型を共有します。`preact-render-to-string`は内部実装に使う通常依存であり、zoganと一緒にインストールされます。

## ライセンス

[MIT](LICENSE)
