import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const origin = "https://shop.test";

const request = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`${origin}${path}`, init));

const startSession = async (): Promise<string> => {
  const response = await request("/_f/cart-badge");
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  expect(cookie).toMatch(/^zogan_user=/);
  return cookie!;
};

const add = (cookie: string, version: number, quantity = 1) =>
  request("/cart/add", {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      productId: "1",
      quantity: String(quantity),
      version: String(version),
    }),
  });

describe("Workers + D1 demo", () => {
  it("isolates carts by HttpOnly user cookie", async () => {
    const first = await startSession();
    expect((await add(first, 0)).status).toBe(303);

    const firstCart = await request("/cart", { headers: { Cookie: first } });
    const secondCart = await request("/cart");
    expect(await firstCart.text()).toContain("Linen Tote × 1");
    expect(await secondCart.text()).toContain("Your cart is empty");
    expect(firstCart.headers.get("Cache-Control")).toBe("private, no-store");
    expect(firstCart.headers.get("Vary")).toContain("Cookie");
  });

  it("increments cart versions monotonically and rejects stale writes", async () => {
    const cookie = await startSession();
    expect((await add(cookie, 0)).status).toBe(303);
    const stale = await add(cookie, 0);
    expect(stale.status).toBe(409);
    expect(await stale.text()).toContain("version");

    const fragment = await request("/_f/cart-badge", { headers: { Cookie: cookie } });
    expect(await fragment.text()).toContain('"version":1');
  });

  it("refuses checkout when requested inventory is unavailable", async () => {
    const cookie = await startSession();
    expect((await add(cookie, 0, 10)).status).toBe(303);
    expect((await add(cookie, 1, 10)).status).toBe(303);
    const response = await request("/checkout", { method: "POST", headers: { Cookie: cookie } });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("no longer available");
  });

  it("keeps snapshots off public responses and applies explicit cache boundaries", async () => {
    const products = await request("/products");
    const productsBody = await products.text();
    expect(products.headers.get("Cache-Control")).toContain("public");
    expect(products.headers.get("Set-Cookie")).toBeNull();
    expect(products.headers.get("Vary")).toContain("X-Partial");
    expect(productsBody).not.toContain("data-zogan-store");

    const cookie = await startSession();
    const cart = await request("/cart", { headers: { Cookie: cookie } });
    expect(cart.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await cart.text()).toContain('data-store="cart"');

    const stock = await request("/_f/stock/1");
    expect(stock.headers.get("Cache-Control")).toContain("s-maxage=10");
  });
});
