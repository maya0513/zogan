import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { zogan } from "zogan";
import { cartSnapshot } from "./domain/cart";
import { InventoryError, ShopRepository, VersionConflictError } from "./repository/shop-repository";
import {
  CartBadgeFragment,
  CartPage,
  FormsPage,
  Layout,
  OrderPage,
  ProductPage,
  ProductsPage,
} from "./presentation/views";

type ShopEnv = {
  Bindings: { DB: D1Database };
  Variables: { userId: string; repository: ShopRepository };
};

const app = new Hono<ShopEnv>();
zogan(app, { layout: Layout });

const needsSession = (path: string): boolean =>
  path === "/cart" ||
  path === "/cart/add" ||
  path === "/checkout" ||
  path === "/_f/cart-badge" ||
  path.startsWith("/orders/");

app.use(async (c, next) => {
  let userId = getCookie(c, "zogan_user");
  if (!userId) {
    userId = crypto.randomUUID();
    if (needsSession(c.req.path)) {
      setCookie(c, "zogan_user", userId, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
  }
  c.set("userId", userId);
  c.set("repository", new ShopRepository(c.env.DB));
  await next();
});

app.get("/", (c) => c.redirect("/products"));

app.page("/products", async (c) => {
  const category = c.req.query("category") || undefined;
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const products = await c.get("repository").products({ category, page, pageSize: 4 });
  c.header("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  return c.render(<ProductsPage products={products} category={category} page={page} />);
});

app.page("/products/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slug) return c.notFound();
  const product = await c.get("repository").product(slug);
  if (!product) return c.notFound();
  c.header("Cache-Control", "public, max-age=0, s-maxage=120, stale-while-revalidate=300");
  return c.render(<ProductPage product={product} />);
});

app.page("/cart", async (c) => {
  const cart = await c.get("repository").cart(c.get("userId"));
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie");
  return c.render(<CartPage cart={cart} />);
});

app.fragment("cart-badge", async (c) => {
  const cart = await c.get("repository").cart(c.get("userId"));
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie");
  return c.render(<CartBadgeFragment cart={cart} />);
});

app.fragment("stock/:id", async (c) => {
  const product = await c.env.DB.prepare("SELECT inventory FROM products WHERE id = ?")
    .bind(Number(c.req.param("id")))
    .first<{ inventory: number }>();
  c.header("Cache-Control", "public, max-age=0, s-maxage=10");
  return c.render(<span>{product?.inventory ?? 0} available</span>);
});

app.post("/cart/add", async (c) => {
  const body = await c.req.parseBody();
  const productId = Number(body.productId);
  const quantity = Math.max(1, Math.min(10, Number(body.quantity) || 1));
  const repository = c.get("repository");
  const current = await repository.cart(c.get("userId"));
  const expected = body.version === undefined ? current.version : Number(body.version);
  try {
    const cart = await repository.add(c.get("userId"), productId, quantity, expected);
    if (c.req.header("X-Zogan-Request") === "fragment") {
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie");
      return c.json(cartSnapshot(cart));
    }
    return c.redirect("/cart", 303);
  } catch (error) {
    if (error instanceof VersionConflictError) return c.text(error.message, 409);
    throw error;
  }
});

app.post("/checkout", async (c) => {
  try {
    const order = await c.get("repository").checkout(c.get("userId"));
    return c.redirect(`/orders/${order.id}`, 303);
  } catch (error) {
    if (error instanceof InventoryError) return c.text(error.message, 409);
    throw error;
  }
});

app.page("/orders/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.notFound();
  const order = await c.get("repository").order(c.get("userId"), id);
  if (!order) return c.notFound();
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie");
  return c.render(<OrderPage order={order} />);
});

app.page("/forms", (c) => {
  const values = [...(c.req.queries("action") ?? []), ...(c.req.queries("tag") ?? [])];
  c.header("Cache-Control", "private, no-store");
  return c.render(<FormsPage values={values} />);
});

app.post("/native-fallback", async (c) => {
  const body = await c.req.parseBody();
  const source = typeof body.source === "string" ? body.source : "missing";
  return c.text(`native fallback: ${source}`);
});

export default app;
