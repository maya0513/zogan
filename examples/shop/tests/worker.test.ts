import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const origin = "https://shop.test";

const request = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`${origin}${path}`, init));

const startSession = async (): Promise<string> => {
  const response = await request("/fragments/cart-badge");
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  expect(cookie).toMatch(/^zogan_user=/);
  return cookie!;
};

const addNatively = (cookie: string, productId = 1, quantity = 1) =>
  request("/cart/add", {
    body: new URLSearchParams({ productId: String(productId), quantity: String(quantity) }),
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    redirect: "manual",
  });

const addThroughApi = (cookie: string, productId = 1, quantity = 1) =>
  request("/api/cart/items", {
    body: JSON.stringify({ productId, quantity }),
    headers: { Accept: "application/json", Cookie: cookie, "Content-Type": "application/json" },
    method: "POST",
  });

describe("Workers + D1 vNext demo", () => {
  it("returns one full representation per URL regardless of custom request headers", async () => {
    const normal = await request("/products?category=home");
    const custom = await request("/products?category=home", {
      headers: { "X-Partial": "catalog,pager" },
    });
    const normalBody = await normal.text();

    expect(await custom.text()).toBe(normalBody);
    expect(normal.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
    expect(normal.headers.get("Set-Cookie")).toBeNull();
    expect(normal.headers.get("Vary")).toBeNull();
    expect(normal.headers.get("X-Partial")).toBeNull();
    expect(normalBody).toContain("Desk Lamp");
    expect(normalBody).not.toContain("Field Notebook");
    expect(normalBody).toContain('data-zogan-fragment="/fragments/cart-badge"');
    expect(normalBody).toContain('data-zogan-island="AddToCart"');
    expect(normalBody).not.toContain("data-partial");
    expect(normalBody).not.toContain("data-store");
  });

  it("isolates carts by HttpOnly cookie and keeps private HTML out of caches", async () => {
    const first = await startSession();
    expect((await addNatively(first)).status).toBe(303);

    const firstCart = await request("/cart", { headers: { Cookie: first } });
    const secondCart = await request("/cart");
    expect(await firstCart.text()).toContain("Linen Tote × 1");
    expect(await secondCart.text()).toContain("Your cart is empty");
    expect(firstCart.headers.get("Cache-Control")).toBe("private, no-store");
    expect(firstCart.headers.get("Vary")).toBe("Cookie");
    expect(firstCart.headers.get("Set-Cookie")).toBeNull();
    expect(secondCart.headers.get("Set-Cookie")).toMatch(/^zogan_user=/);
  });

  it("provides an explicit JSON mutation API without protocol-specific headers", async () => {
    const cookie = await startSession();
    const response = await addThroughApi(cookie, 1, 2);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(response.headers.get("X-Zogan-Request")).toBeNull();
    expect(await response.json()).toEqual({ count: 2, total: 13_600, version: 1 });

    const invalid = await request("/api/cart/items", {
      body: JSON.stringify({ productId: "one", quantity: 1 }),
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid cart item" });
  });

  it("uses explicit fragment routes with independent cache boundaries and no snapshots", async () => {
    const cookie = await startSession();
    expect((await addNatively(cookie)).status).toBe(303);

    const badge = await request("/fragments/cart-badge", { headers: { Cookie: cookie } });
    const badgeBody = await badge.text();
    expect(badge.headers.get("Cache-Control")).toBe("private, no-store");
    expect(badge.headers.get("Vary")).toBe("Cookie");
    expect(badgeBody).toContain("<span>1</span>");
    expect(badgeBody).not.toContain("data-store");

    const stock = await request("/fragments/stock/1");
    expect(stock.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=10");
    expect(stock.headers.get("Vary")).toBeNull();
    expect(await stock.text()).toBe("12 available");
  });

  it("uses POST/Redirect/GET for native mutations", async () => {
    const cookie = await startSession();
    const added = await addNatively(cookie);
    expect(added.status).toBe(303);
    expect(added.headers.get("Location")).toBe("/cart");

    const checkout = await request("/checkout", {
      headers: { Cookie: cookie },
      method: "POST",
      redirect: "manual",
    });
    expect(checkout.status).toBe(303);
    expect(checkout.headers.get("Location")).toMatch(/^\/orders\//);
  });

  it("rejects checkout when requested inventory is unavailable", async () => {
    const cookie = await startSession();
    expect((await addNatively(cookie, 1, 10)).status).toBe(303);
    expect((await addNatively(cookie, 1, 10)).status).toBe(303);
    const response = await request("/checkout", { headers: { Cookie: cookie }, method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("no longer available");
  });
});
