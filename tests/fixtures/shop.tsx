/**
 * 受け入れテスト（§10）用の最小 EC。
 *
 * 殻は CDN キャッシュ可能（public, s-maxage）。ユーザ固有の値は cart Fragment
 * （private, no-store）だけが運ぶ。§4.4 の設定表をそのまま写している。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { ComponentChildren } from "preact";
import { Island, Partial, StoreSnapshot, zogan } from "../../src/server/index";

export interface Cart {
  version: number;
  count: number;
}

const Layout = ({ children }: { children?: ComponentChildren }) => (
  <html lang="ja">
    <body data-client-nav>
      <header>
        <a href="/products">ロゴ</a>
        {/* 穴：ユーザごとに違う → Fragment。children はプレースホルダに留める（§5.3.2） */}
        <Island name="CartBadge" fragment="/_f/cart-badge" trigger="load">
          <span>—</span>
        </Island>
      </header>
      {children}
      <a href="/checkout" data-client-nav="false">
        レジへ進む
      </a>
    </body>
  </html>
);

/** props で受ける表示専用コンポーネント。Store を import しないのでサーババンドルに入ってよい */
const CartBadgeView = ({ count }: { count: number }) => <span>{count}</span>;

export interface Shop {
  app: Hono;
  carts: Map<string, Cart>;
  setCart: (user: string, cart: Cart) => void;
}

const userOf = (c: Context): string => {
  const cookie = c.req.header("Cookie") ?? "";
  return /(?:^|;\s*)u=([^;]+)/.exec(cookie)?.[1] ?? "anonymous";
};

export const createShop = (dev = true): Shop => {
  const carts = new Map<string, Cart>();
  const cartOf = (c: Context): Cart => carts.get(userOf(c)) ?? { version: 0, count: 0 };

  const app = new Hono();
  zogan(app, { layout: Layout, dev });
  app.onError((err) => new Response(err.message, { status: 500 }));

  app.page("/products", (c) => {
    const page = Number(c.req.query("page") ?? "1");
    // 殻は全ユーザ共通。在庫も価格も snapshot も書かない（§4.4.1）
    c.header("Cache-Control", "public, s-maxage=60");
    return c.render(
      <main>
        <Partial name="count">{page === 1 ? "1,284" : "842"} 件</Partial>
        <div class="grid">
          <Partial name="results">
            <article>
              <a href={`/products/ABC-${page}`}>商品 {page}</a>
            </article>
          </Partial>
        </div>
        <table>
          <tbody>
            <Partial name="rows">
              <tr>
                <td>{page === 1 ? "980" : "1,480"} 円</td>
              </tr>
            </Partial>
          </tbody>
        </table>
        <a href={`/products?page=${page + 1}`}>次のページ</a>
      </main>,
    );
  });

  // 無限スクロール（§3.4 の append）と入れ子の Partial（§3.1.2）
  app.page("/reviews", (c) => {
    const page = Number(c.req.query("page") ?? "1");
    c.header("Cache-Control", "public, s-maxage=60");
    return c.render(
      <main>
        <Partial name="review-count">{page * 10} 件</Partial>
        <Partial name="review-items" mode="append" key={page}>
          <article data-page={String(page)}>レビュー {page}</article>
        </Partial>
        <Partial name="listing">
          <p>一覧</p>
          <Partial name="pager">ページ {page}</Partial>
        </Partial>
      </main>,
    );
  });

  app.page("/cart", (c) => {
    const cart = cartOf(c);
    // ページ本体がカートの権威。キャッシュ不能なので snapshot を載せてよい（§5.2.2）
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie");
    return c.render(
      <main>
        <Partial name="cart-lines">
          <StoreSnapshot name="cart" data={cart} />
          <p>{cart.count} 点</p>
        </Partial>
        <form action="/checkout/pay" method="post">
          <button>購入する</button>
        </form>
      </main>,
    );
  });

  app.fragment("cart-badge", (c) => {
    const cart = cartOf(c);
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie");
    return c.render(
      <>
        <StoreSnapshot name="cart" data={cart} />
        <CartBadgeView count={cart.count} />
      </>,
    );
  });

  app.fragment("stock/:sku", (c) => {
    c.header("Cache-Control", "public, s-maxage=30");
    return c.render(<span>在庫あり（{c.req.param("sku")}）</span>);
  });

  app.post("/cart/add", async (c) => {
    const user = userOf(c);
    const current = carts.get(user) ?? { version: 0, count: 0 };
    const form = await c.req.formData();
    const outOfStock = form.get("sku") === "SOLD-OUT";
    // 拒否した場合も version を進めて snapshot を返す（§8.2.1）
    const next: Cart = outOfStock
      ? { version: current.version + 1, count: current.count }
      : { version: current.version + 1, count: current.count + 1 };
    carts.set(user, next);
    c.header("Cache-Control", "private, no-store");
    return c.render(<StoreSnapshot name="cart" data={next} />);
  });

  return {
    app,
    carts,
    setCart: (user, cart) => carts.set(user, cart),
  };
};
