import { Hono } from "hono";
import type { Context } from "hono";
import type { ComponentChildren } from "preact";
import {
  createZogan,
  defineIsland,
  FragmentSlot,
  Island,
  privateNoStore,
  publicCache,
  type JsonObject,
} from "../../src/server/index";

export interface Cart {
  readonly count: number;
  readonly version: number;
}

export type StockProps = JsonObject & { inventory: number };

export const StockView = ({ inventory }: StockProps) => <span>{inventory} available</span>;

const StockIsland = defineIsland<StockProps>({ id: "Stock", component: StockView });

const Layout = ({ children }: { readonly children?: ComponentChildren }) => (
  <html lang="ja">
    <body>
      <header>
        <a href="/products">商品</a>
        <FragmentSlot as="span" src="/fragments/cart-badge">
          <a href="/cart">カート —</a>
        </FragmentSlot>
      </header>
      {children}
    </body>
  </html>
);

export interface Shop {
  readonly app: Hono;
  readonly setCart: (user: string, cart: Cart) => void;
  readonly setInventory: (inventory: number) => void;
}

const userOf = (context: Context): string => {
  const cookie = context.req.header("Cookie") ?? "";
  return /(?:^|;\s*)u=([^;]+)/u.exec(cookie)?.[1] ?? "anonymous";
};

export const createShop = (): Shop => {
  const carts = new Map<string, Cart>();
  let inventory = 9;
  const cartOf = (context: Context): Cart => carts.get(userOf(context)) ?? { version: 0, count: 0 };

  const app = new Hono();
  const zogan = createZogan({ layout: Layout });
  app.onError((error) => new Response(error.message, { status: 500 }));

  app.get("/products", (context) =>
    zogan.page(
      context,
      <main>
        <h1>商品</h1>
        <a href="/products/ABC-1">商品 1</a>
        <form action="/cart/add" method="post">
          <input type="hidden" name="sku" value="ABC-1" />
          <button type="submit">カートへ追加</button>
        </form>
      </main>,
      { cache: publicCache({ sMaxAge: 60 }) },
    ),
  );

  app.get("/products/:sku", (context) =>
    zogan.page(
      context,
      <main>
        <h1>{context.req.param("sku")}</h1>
        <FragmentSlot src={`/fragments/stock/${context.req.param("sku")}`}>
          <span>Stock unavailable</span>
        </FragmentSlot>
      </main>,
      { cache: publicCache({ sMaxAge: 60 }) },
    ),
  );

  app.get("/cart", (context) => {
    const cart = cartOf(context);
    return zogan.page(
      context,
      <main>
        <h1>カート</h1>
        <p>{cart.count} 点</p>
        <form action="/checkout" method="post">
          <button type="submit">購入する</button>
        </form>
      </main>,
      { cache: privateNoStore({ vary: ["Cookie"] }) },
    );
  });

  app.get("/fragments/cart-badge", (context) => {
    const cart = cartOf(context);
    return zogan.fragment(
      context,
      <a href="/cart" data-cart-count={cart.count}>
        カート {cart.count}
      </a>,
      { cache: privateNoStore({ vary: ["Cookie"] }) },
    );
  });

  app.get("/fragments/stock/:sku", (context) =>
    zogan.fragment(context, <Island of={StockIsland} props={{ inventory }} />, {
      cache: publicCache({ sMaxAge: 30 }),
    }),
  );

  app.post("/cart/add", async (context) => {
    const user = userOf(context);
    const current = cartOf(context);
    const form = await context.req.formData();
    if (form.get("sku") !== "ABC-1") return context.text("unknown product", 400);
    carts.set(user, { version: current.version + 1, count: current.count + 1 });
    return context.redirect("/cart", 303);
  });

  app.post("/checkout", (context) => context.redirect("/products", 303));

  return {
    app,
    setCart: (user, cart) => carts.set(user, cart),
    setInventory: (next) => {
      inventory = next;
    },
  };
};
