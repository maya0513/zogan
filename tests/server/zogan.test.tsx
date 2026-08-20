import { Hono } from "hono";
import type { ComponentChildren } from "preact";
import { describe, expect, test } from "vitest";
import { cachePolicy, createZogan, privateNoStore, publicCache } from "../../src/server/index";

const Layout = ({ children }: { children?: ComponentChildren }) => (
  <html lang="ja">
    <head>
      <title>zogan</title>
    </head>
    <body>{children}</body>
  </html>
);

describe("createZogan response factories", () => {
  test("page は layout と doctype を適用し、明示した cache policy を返す", async () => {
    const app = new Hono();
    const zogan = createZogan({ layout: Layout });
    app.get("/products", (c) =>
      zogan.page(c, <main>Products</main>, {
        cache: publicCache({ sMaxAge: 60, staleWhileRevalidate: 30 }),
      }),
    );

    const response = await app.request("/products");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=60, stale-while-revalidate=30",
    );
    expect(await response.text()).toBe(
      '<!DOCTYPE html><html lang="ja"><head><title>zogan</title></head><body><main>Products</main></body></html>',
    );
  });

  test("fragment は layout と doctype を付けず raw HTML を返す", async () => {
    const app = new Hono();
    const zogan = createZogan({ layout: Layout });
    app.get("/fragments/cart", (c) =>
      zogan.fragment(
        c,
        <>
          <span>3</span>
          <button type="button">Open</button>
        </>,
        { cache: privateNoStore() },
      ),
    );

    const response = await app.request("/fragments/cart");
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe('<span>3</span><button type="button">Open</button>');
  });

  test("X-Partial を解釈せず、暗黙の partial response を作らない", async () => {
    const app = new Hono();
    const zogan = createZogan({ layout: Layout });
    app.get("/", (c) => zogan.page(c, <main>whole page</main>, { cache: publicCache() }));

    const response = await app.request("/", { headers: { "X-Partial": "results" } });
    expect(await response.text()).toContain("<html");
    expect(response.headers.get("X-Partial")).toBeNull();
    expect(response.headers.get("Vary")).toBeNull();
  });

  test("policy の Vary を既存 Context header へ case-insensitive に merge する", async () => {
    const app = new Hono();
    const zogan = createZogan({});
    app.get("/", (c) => {
      c.header("Vary", "Cookie, origin");
      return zogan.page(c, <main>x</main>, {
        cache: publicCache({ vary: ["Origin", "Accept-Encoding"] }),
      });
    });

    const response = await app.request("/");
    expect(response.headers.get("Vary")).toBe("Cookie, origin, Accept-Encoding");
  });

  test("既存 Response の Vary も失わない", async () => {
    const app = new Hono();
    const zogan = createZogan({});
    app.get("/", (c) => {
      c.res = new globalThis.Response(null, { headers: { Vary: "Cookie" } });
      return zogan.fragment(c, <span>x</span>, {
        cache: cachePolicy("public, max-age=5", { vary: ["Accept-Encoding"] }),
      });
    });

    const response = await app.request("/");
    expect(response.headers.get("Vary")).toBe("Cookie, Accept-Encoding");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=5");
  });

  test("assigned Response の status と header を保つ", async () => {
    const app = new Hono();
    const zogan = createZogan({});
    app.get("/", (c) => {
      c.res = new globalThis.Response(null, {
        headers: { "X-Upstream": "preserved" },
        status: 202,
      });
      return zogan.fragment(c, <span>accepted</span>, { cache: privateNoStore() });
    });

    const response = await app.request("/");
    expect(response.status).toBe(202);
    expect(response.headers.get("X-Upstream")).toBe("preserved");
    expect(await response.text()).toBe("<span>accepted</span>");
  });

  test("Context の status と既存 header を保つ", async () => {
    const app = new Hono();
    const zogan = createZogan({});
    app.get("/", (c) => {
      c.status(201);
      c.header("X-Request-Id", "r-1");
      return zogan.fragment(c, <span>created</span>, { cache: privateNoStore() });
    });

    const response = await app.request("/");
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Request-Id")).toBe("r-1");
  });

  test("factory は route を登録せず、複数 instance 間で layout が混線しない", async () => {
    const first = new Hono();
    const second = new Hono();
    const firstZogan = createZogan({
      layout: ({ children }) => (
        <html data-app="first" lang="en">
          {children}
        </html>
      ),
    });
    const secondZogan = createZogan({
      layout: ({ children }) => (
        <html data-app="second" lang="en">
          {children}
        </html>
      ),
    });
    first.get("/same", (c) => firstZogan.page(c, <main>first</main>, { cache: publicCache() }));
    second.get("/same", (c) => secondZogan.page(c, <main>second</main>, { cache: publicCache() }));

    expect(await (await first.request("/same")).text()).toContain('data-app="first"');
    expect(await (await second.request("/same")).text()).toContain('data-app="second"');
    expect((await first.request("/_f/anything")).status).toBe(404);
  });
});
