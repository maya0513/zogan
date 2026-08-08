import { Hono } from "hono";
import type { ComponentChildren } from "preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Island, Partial, StoreSnapshot, zogan } from "../../src/server/index";
import { setRouteKind } from "../../src/server/routes";
import { installRouteMethods, normalizeFragmentPrefix } from "../../src/server/routes";

const Layout = ({ children }: { children?: ComponentChildren }) => (
  <html lang="ja">
    <body data-client-nav>{children}</body>
  </html>
);

const newApp = (dev = true) => {
  const app = new Hono();
  zogan(app, { layout: Layout, dev });
  app.onError((err) => new Response(err.message, { status: 500 }));
  return app;
};

const productsApp = (dev = true) => {
  const app = newApp(dev);
  app.page("/products", (c) => {
    c.header("Cache-Control", "public, s-maxage=60");
    return c.render(
      <div>
        <Partial name="count">842 件</Partial>
        <Partial name="results">
          <article>a</article>
        </Partial>
      </div>,
    );
  });
  return app;
};

const partialRequest = (path: string, partials: string) =>
  new Request(`http://localhost${path}`, { headers: { "X-Partial": partials } });

describe("§3.2 app.page のフルページ応答", () => {
  test("レイアウトを通し、doctype 付きの完全な HTML を返す", async () => {
    const res = await productsApp().request("/products");
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
    // JSX の真偽値属性は "true" として出る。§7.1.1 の解決規則では truthy 扱い
    expect(body).toContain('<body data-client-nav="true">');
    expect(body).toContain("<!--p:results--><article>a</article><!--/p:results-->");
  });

  test("フルページ応答にも Vary: X-Partial が付く（§3.2.4）", async () => {
    const res = await productsApp().request("/products");
    expect(res.headers.get("Vary")).toContain("X-Partial");
    expect(res.headers.get("X-Partial")).toBe(null);
  });

  test("ハンドラが書いた Vary を潰さない（§4.4 のカートページ）", async () => {
    const app = newApp();
    app.page("/cart", (c) => {
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie");
      return c.render(<Partial name="lines">x</Partial>);
    });
    const vary = (await app.request("/cart")).headers.get("Vary") ?? "";
    expect(vary).toMatch(/Cookie/);
    expect(vary).toMatch(/X-Partial/);
  });
});

describe("§3.2.2 部分応答", () => {
  test("要求された領域を宣言順にマーカー込みで返す", async () => {
    const res = await productsApp().request(partialRequest("/products", "results,count"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Partial")).toBe("count,results");
    expect(res.headers.get("Vary")).toContain("X-Partial");
    expect(await res.text()).toBe(
      "<!--p:count-->842 件<!--/p:count--><!--p:results--><article>a</article><!--/p:results-->",
    );
  });

  test("ラッパーもレイアウトも付けない", async () => {
    const body = await (await productsApp().request(partialRequest("/products", "count"))).text();
    expect(body).toBe("<!--p:count-->842 件<!--/p:count-->");
    expect(body).not.toContain("<html");
    expect(body).not.toContain("<body");
  });

  test("空白を無視して領域名を解釈する（§3.2.1）", async () => {
    const res = await productsApp().request(partialRequest("/products", " count , results "));
    expect(res.headers.get("X-Partial")).toBe("count,results");
  });

  test("1 つも返せなければ 200 + 空 body + 空の X-Partial（§3.2.3）", async () => {
    const res = await productsApp().request(partialRequest("/products", "nope"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Partial")).toBe("");
    expect(await res.text()).toBe("");
  });

  test("c.req.partials で要求を参照できる（付録 A.1.4）", async () => {
    const app = newApp();
    const seen: (string[] | null)[] = [];
    app.page("/p", (c) => {
      seen.push(c.req.partials);
      c.header("Cache-Control", "no-store");
      return c.render(<Partial name="a">a</Partial>);
    });
    await app.request("/p");
    await app.request(partialRequest("/p", "a,b"));
    expect(seen).toEqual([null, ["a", "b"]]);
  });

  test("X-Partial が空文字列なら不正として 400（§3.2.1）", async () => {
    const res = await productsApp().request(partialRequest("/products", ""));
    expect(res.status).toBe(400);
  });
});

describe("§3.4 mode の伝達", () => {
  // mode は宣言（JSX）にあり、マーカーには出力しない（付録 A.1.5）。
  // クライアントが差し替え方を決められるよう、応答ヘッダで伝える。
  const app = () => {
    const a = newApp();
    a.page("/reviews", (c) => {
      c.header("Cache-Control", "public, s-maxage=60");
      return c.render(
        <div>
          <Partial name="count">3 件</Partial>
          <Partial name="items" mode="append" key={2}>
            <article>r</article>
          </Partial>
        </div>,
      );
    });
    return a;
  };

  test("既定 replace の領域はヘッダに載せない", async () => {
    const res = await app().request(partialRequest("/reviews", "count"));
    expect(res.headers.get("X-Partial-Mode")).toBe(null);
  });

  test("append / prepend の領域だけを列挙する", async () => {
    const res = await app().request(partialRequest("/reviews", "count,items"));
    expect(res.headers.get("X-Partial")).toBe("count,items");
    expect(res.headers.get("X-Partial-Mode")).toBe("items=append");
  });
});

describe("§3.2.3 部分応答に変換してはいけないもの", () => {
  test("リダイレクトはそのまま返す", async () => {
    const app = newApp();
    app.page("/old", (c) => c.redirect("/new", 302));
    const res = await app.request(partialRequest("/old", "results"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/new");
    expect(res.headers.get("X-Partial")).toBe(null);
  });

  test("4xx / 5xx はそのステータスのまま返す", async () => {
    const app = newApp();
    app.page("/missing", (c) => c.text("not found", 404));
    const res = await app.request(partialRequest("/missing", "results"));
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Partial")).toBe(null);
  });
});

describe("§4.2 app.fragment", () => {
  const fragmentApp = (dev = true) => {
    const app = newApp(dev);
    app.fragment("cart-badge", (c) => {
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie");
      return c.render(
        <>
          <StoreSnapshot name="cart" data={{ version: 41, count: 3 }} />
          <span>3</span>
        </>,
      );
    });
    app.fragment("stock/:sku", (c) => {
      c.header("Cache-Control", "public, s-maxage=30");
      return c.render(<span>{c.req.param("sku")}</span>);
    });
    return app;
  };

  test("/_f/ 配下に登録され、レイアウトを適用しない（§4.2.3）", async () => {
    const res = await fragmentApp().request("/_f/cart-badge");
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toContain("<html");
    expect(body).toBe(
      '<script type="application/json" data-store="cart">{"version":41,"count":3}</script><span>3</span>',
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
  });

  test("名前のパスパラメータは Hono のものがそのまま使える", async () => {
    const res = await fragmentApp().request("/_f/stock/ABC-123");
    expect(await res.text()).toBe("<span>ABC-123</span>");
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=30");
  });

  test("Fragment 応答に Vary: X-Partial は付けない", async () => {
    const res = await fragmentApp().request("/_f/stock/ABC-123");
    expect(res.headers.get("Vary")).toBe(null);
  });

  test("fragmentPrefix を変更できる", async () => {
    const app = new Hono();
    zogan(app, { dev: true, fragmentPrefix: "/frag/" });
    app.fragment("x", (c) => {
      c.header("Cache-Control", "no-store");
      return c.render(<span>x</span>);
    });
    expect((await app.request("/frag/x")).status).toBe(200);
    expect((await app.request("/_f/x")).status).toBe(404);
  });

  test("複数の Hono アプリで fragmentPrefix が混線しない", async () => {
    const first = new Hono();
    const second = new Hono();
    zogan(first, { dev: true, fragmentPrefix: "/first/" });
    zogan(second, { dev: true, fragmentPrefix: "/second/" });

    first.fragment("badge", (c) => {
      c.header("Cache-Control", "no-store");
      return c.render(<span>first</span>);
    });
    second.fragment("badge", (c) => {
      c.header("Cache-Control", "no-store");
      return c.render(<span>second</span>);
    });

    expect(await (await first.request("/first/badge")).text()).toBe("<span>first</span>");
    expect((await first.request("/second/badge")).status).toBe(404);
    expect(await (await second.request("/second/badge")).text()).toBe("<span>second</span>");
  });

  test("fragmentPrefix は絶対パスへ正規化される", async () => {
    const app = new Hono();
    zogan(app, { dev: true, fragmentPrefix: "/frag" });
    app.fragment("x", (c) => {
      c.header("Cache-Control", "no-store");
      return c.render(<span>x</span>);
    });
    expect((await app.request("/frag/x")).status).toBe(200);
  });

  test.each(["relative", "//evil.example/x", "/x?query", "/x#hash", "/x\\y"])(
    "不正な fragmentPrefix を拒否する: %s",
    (prefix) => expect(() => normalizeFragmentPrefix(prefix)).toThrow(),
  );

  test.each(["/./x", "/../x"])("dot segment を拒否する: %s", (prefix) => {
    expect(() => normalizeFragmentPrefix(prefix)).toThrow(/dot/);
  });

  test("同じ app を二重設定できない", () => {
    const app = new Hono();
    zogan(app);
    expect(() => zogan(app)).toThrow(/already configured/);
  });

  test("zogan 未設定の app へ fragment を登録できない", () => {
    const app = new Hono();
    expect(() => app.fragment("x", (c) => c.text("x"))).toThrow(/call zogan/);
  });

  test("fragment 名の先頭 slash は重複させない", async () => {
    const app = new Hono();
    zogan(app);
    app.fragment("/x", (c) => {
      c.header("Cache-Control", "no-store");
      return c.render(<span>x</span>);
    });
    expect((await app.request("/_f/x")).status).toBe(200);
  });

  test("route method installer は複数回呼んでも安全", () => {
    expect(() => installRouteMethods()).not.toThrow();
  });

  test("別の Hono 実体から作られた app にも route methods を登録する", async () => {
    class IsolatedHono extends Hono {}
    Object.defineProperties(IsolatedHono.prototype, {
      page: { configurable: true, value: undefined, writable: true },
      fragment: { configurable: true, value: undefined, writable: true },
    });

    const app = new IsolatedHono();
    zogan(app);
    app.page("/isolated", (c) => {
      c.header("Cache-Control", "public, max-age=0");
      return c.render(<Partial name="content">isolated</Partial>);
    });

    expect((await app.request("/isolated")).status).toBe(200);
  });
});

describe("§4.2.1 / §5.5.3 Cache-Control の明示を強制する", () => {
  test("app.page が書き忘れると開発ビルドで例外", async () => {
    const app = newApp();
    app.page("/p", (c) => c.render(<Partial name="a">a</Partial>));
    const res = await app.request("/p");
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/Cache-Control/);
  });

  test("app.fragment が書き忘れると開発ビルドで例外", async () => {
    const app = newApp();
    app.fragment("x", (c) => c.render(<span>x</span>));
    const res = await app.request("/_f/x");
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/Cache-Control/);
  });

  test("本番ビルドでは private, no-store にフォールバックして警告する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = newApp(false);
    app.page("/p", (c) => c.render(<Partial name="a">a</Partial>));
    const res = await app.request("/p");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("§5.5 【不変条件】snapshot はキャッシュ可能な応答に載せない", () => {
  const leakyApp = (dev: boolean) => {
    const app = newApp(dev);
    app.page("/products/:id", (c) => {
      c.header("Cache-Control", "public, s-maxage=300");
      return c.render(
        <div>
          <StoreSnapshot name="cart" data={{ version: 41, count: 3 }} />
        </div>,
      );
    });
    return app;
  };

  test("キャッシュ可能な応答に snapshot があると開発ビルドで例外", async () => {
    const res = await leakyApp(true).request("/products/ABC-123");
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/no-store/);
  });

  test("本番ビルドでは Cache-Control を上書きして配信する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await leakyApp(false).request("/products/ABC-123");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.text()).toContain('data-store="cart"');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("<StoreSnapshot> を経由しない手書きの script も捕まえる（§5.5.2）", async () => {
    const app = newApp();
    app.page("/p", (c) => {
      c.header("Cache-Control", "public, s-maxage=60");
      return c.html('<script type="application/json" data-store="cart">{"version":1}</script>');
    });
    const res = await app.request("/p");
    expect(res.status).toBe(500);
  });

  test("private, no-store なら通る", async () => {
    const app = newApp();
    app.page("/cart", (c) => {
      c.header("Cache-Control", "private, no-store");
      return c.render(<StoreSnapshot name="cart" data={{ version: 41 }} />);
    });
    expect((await app.request("/cart")).status).toBe(200);
  });

  test.each(["private", "public, no-storehouse", "public, x-private"])(
    "snapshot には正確な no-store directive が必要: %s",
    async (cacheControl) => {
      const app = newApp();
      app.page("/cart", (c) => {
        c.header("Cache-Control", cacheControl);
        return c.render(<StoreSnapshot name="cart" data={{ version: 41 }} />);
      });
      const res = await app.request("/cart");
      expect(res.status).toBe(500);
      expect(await res.text()).toMatch(/no-store/);
    },
  );

  test("POST の応答は照合の対象外（キャッシュされない）", async () => {
    const app = newApp();
    app.post("/cart/add", (c) =>
      c.html('<script type="application/json" data-store="cart">{"version":42}</script>'),
    );
    const res = await app.request("/cart/add", { method: "POST" });
    expect(res.status).toBe(200);
  });

  test("route kind が付いた POST でも snapshot guard は対象外", async () => {
    const app = newApp();
    app.post("/custom", (c) => {
      setRouteKind(c, "page");
      c.header("Cache-Control", "no-store");
      return c.html('<script type="application/json" data-store="cart">{"version":1}</script>');
    });
    expect((await app.request("/custom", { method: "POST" })).status).toBe(200);
  });

  test.each([
    ["非 2xx", new Response("x", { status: 404, headers: { "Content-Type": "text/html" } })],
    ["非 HTML", new Response("x", { status: 200, headers: { "Content-Type": "text/plain" } })],
    ["body なし", new Response(null, { status: 200, headers: { "Content-Type": "text/html" } })],
  ])("通常 GET の %s 応答は snapshot guard を素通りする", async (_label, response) => {
    const app = new Hono();
    zogan(app, { dev: true });
    app.onError((error) => new Response(error.message, { status: 500 }));
    app.get("/plain", () => response);
    expect((await app.request("/plain")).status).toBe(response.status);
  });

  test("Cache-Control 未指定の手書き snapshot も検出する", async () => {
    const app = new Hono();
    zogan(app, { dev: true });
    app.onError((error) => new Response(error.message, { status: 500 }));
    app.get("/plain", (c) =>
      c.html('<script type="application/json" data-store="cart">{"version":1}</script>'),
    );
    const res = await app.request("/plain");
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("(unset)");
  });

  test("dev 省略時は環境から既定値を決める", async () => {
    const app = new Hono();
    zogan(app);
    app.page("/p", (c) => {
      c.header("Cache-Control", "no-store");
      return c.render(<span>x</span>);
    });
    expect((await app.request("/p")).status).toBe(200);
  });
});

describe("§2.2 ページ全体の構造", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  test("殻には Island のプレースホルダだけがあり、snapshot が無い", async () => {
    const app = newApp();
    app.page("/products", (c) => {
      c.header("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60");
      return c.render(
        <div>
          <Island name="CartBadge" fragment="/_f/cart-badge" trigger="load">
            <span>—</span>
          </Island>
          <Partial name="results">
            <article>a</article>
          </Partial>
        </div>,
      );
    });
    const body = await (await app.request("/products")).text();
    expect(body).toContain('data-island="CartBadge"');
    expect(body).toContain('data-fragment="/_f/cart-badge"');
    expect(body).not.toContain("data-store");
  });
});
