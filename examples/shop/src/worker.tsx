import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createZogan, privateNoStore, publicCache } from "zogan";
import { cartSnapshot } from "./domain/cart";
import {
  CartBadgeFragment,
  CartPage,
  FormsPage,
  Layout,
  OrderPage,
  ProductPage,
  ProductsPage,
} from "./presentation/views";
import { InventoryError, ShopRepository, VersionConflictError } from "./repository/shop-repository";

type ShopEnv = {
  Bindings: { DB: D1Database };
  Variables: { userId: string; repository: ShopRepository };
};

interface CartItemInput {
  readonly productId: number;
  readonly quantity: number;
}

const app = new Hono<ShopEnv>();
const zogan = createZogan({ layout: Layout });

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

const needsSession = (path: string): boolean =>
  path === "/api/cart/items" ||
  path === "/cart" ||
  path === "/cart/add" ||
  path === "/checkout" ||
  path === "/fragments/cart-badge" ||
  path.startsWith("/orders/");

const cartItemInput = (input: unknown): CartItemInput | null => {
  if (input === null || typeof input !== "object") return null;
  const productId = Number(Reflect.get(input, "productId"));
  const quantity = Number(Reflect.get(input, "quantity"));
  if (
    !Number.isSafeInteger(productId) ||
    productId < 1 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 10
  ) {
    return null;
  }
  return { productId, quantity };
};

app.use(async (c, next) => {
  let userId = getCookie(c, "zogan_user");
  if (!userId) {
    userId = crypto.randomUUID();
    if (needsSession(c.req.path)) {
      setCookie(c, "zogan_user", userId, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
        sameSite: "Lax",
      });
    }
  }
  c.set("userId", userId);
  c.set("repository", new ShopRepository(c.env.DB));
  await next();
});

app.get("/", (c) => c.redirect("/products"));

app.get("/products", async (c) => {
  const category = c.req.query("category") || undefined;
  const requestedPage = Number(c.req.query("page") ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const products = await c.get("repository").products({ category, page, pageSize: 4 });
  return zogan.page(c, <ProductsPage products={products} category={category} page={page} />, {
    cache: publicCache({ sMaxAge: 60, staleWhileRevalidate: 300 }),
  });
});

app.get("/products/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slug) return c.notFound();
  const product = await c.get("repository").product(slug);
  if (!product) return c.notFound();
  return zogan.page(c, <ProductPage product={product} />, {
    cache: publicCache({ sMaxAge: 120, staleWhileRevalidate: 300 }),
  });
});

app.get("/cart", async (c) => {
  const cart = await c.get("repository").cart(c.get("userId"));
  return zogan.page(c, <CartPage cart={cart} />, {
    cache: privateNoStore({ vary: ["Cookie"] }),
  });
});

app.get("/fragments/cart-badge", async (c) => {
  const cart = await c.get("repository").cart(c.get("userId"));
  return zogan.fragment(c, <CartBadgeFragment cart={cart} />, {
    cache: privateNoStore({ vary: ["Cookie"] }),
  });
});

app.get("/fragments/stock/:id", async (c) => {
  const product = await c.env.DB.prepare("SELECT inventory FROM products WHERE id = ?")
    .bind(Number(c.req.param("id")))
    .first<{ inventory: number }>();
  return zogan.fragment(c, <>{product?.inventory ?? 0} available</>, {
    cache: publicCache({ sMaxAge: 10 }),
  });
});

app.post("/api/cart/items", async (c) => {
  let input: CartItemInput | null = null;
  try {
    input = cartItemInput(await c.req.json());
  } catch {
    // Invalid JSON follows the same explicit API error shape as invalid fields.
  }
  if (input === null) return c.json({ error: "invalid cart item" }, 400, PRIVATE_HEADERS);

  const repository = c.get("repository");
  const current = await repository.cart(c.get("userId"));
  try {
    const cart = await repository.add(
      c.get("userId"),
      input.productId,
      input.quantity,
      current.version,
    );
    return c.json(cartSnapshot(cart), 200, PRIVATE_HEADERS);
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return c.json({ error: error.message }, 409, PRIVATE_HEADERS);
    }
    throw error;
  }
});

app.post("/cart/add", async (c) => {
  const input = cartItemInput(await c.req.parseBody());
  if (input === null) {
    c.header("Cache-Control", "private, no-store");
    return c.text("invalid cart item", 400);
  }

  const repository = c.get("repository");
  const current = await repository.cart(c.get("userId"));
  try {
    await repository.add(c.get("userId"), input.productId, input.quantity, current.version);
    c.header("Cache-Control", "private, no-store");
    return c.redirect("/cart", 303);
  } catch (error) {
    if (error instanceof VersionConflictError) {
      c.header("Cache-Control", "private, no-store");
      return c.text(error.message, 409);
    }
    throw error;
  }
});

app.post("/checkout", async (c) => {
  try {
    const order = await c.get("repository").checkout(c.get("userId"));
    c.header("Cache-Control", "private, no-store");
    return c.redirect(`/orders/${order.id}`, 303);
  } catch (error) {
    if (error instanceof InventoryError) {
      c.header("Cache-Control", "private, no-store");
      return c.text(error.message, 409);
    }
    throw error;
  }
});

app.get("/orders/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.notFound();
  const order = await c.get("repository").order(c.get("userId"), id);
  if (!order) return c.notFound();
  return zogan.page(c, <OrderPage order={order} />, {
    cache: privateNoStore({ vary: ["Cookie"] }),
  });
});

app.get("/forms", (c) => {
  const values = [...(c.req.queries("action") ?? []), ...(c.req.queries("tag") ?? [])];
  return zogan.page(c, <FormsPage values={values} />, { cache: privateNoStore() });
});

app.post("/native-fallback", async (c) => {
  const body = await c.req.parseBody();
  const source = typeof body.source === "string" ? body.source : "missing";
  c.header("Cache-Control", "private, no-store");
  return c.text(`native fallback: ${source}`);
});

export default app;
