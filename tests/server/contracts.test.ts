import { Hono } from "hono";
import { describe, expectTypeOf, test } from "vitest";
import type { NavigateOptions } from "../../src/client/index";
import { zogan, type FragmentHandler, type PageHandler } from "../../src/server/index";

type ShopEnv = {
  Bindings: { DB: { readonly kind: "d1" } };
  Variables: { requestId: string };
};

describe("公開サーバー契約", () => {
  test("クライアントの公開オプションに履歴の内部状態を出さない", () => {
    const options: NavigateOptions = {};
    // @ts-expect-error history の所有者はクライアントランタイム
    options.history = "none";
    expectTypeOf(options).toMatchTypeOf<NavigateOptions>();
  });

  test("Hono の Env を page/fragment handler まで維持する", () => {
    const app = new Hono<ShopEnv>();
    expectTypeOf(zogan(app, { fragmentPrefix: "/fragments" })).toEqualTypeOf(app);

    app.page("/", (c) => {
      expectTypeOf(c.env.DB).toEqualTypeOf<{ readonly kind: "d1" }>();
      expectTypeOf(c.get("requestId")).toEqualTypeOf<string>();
      return c.text("ok");
    });
    app.fragment("badge", (c) => {
      expectTypeOf(c.env.DB).toEqualTypeOf<{ readonly kind: "d1" }>();
      return c.text("ok");
    });

    expectTypeOf<PageHandler<ShopEnv>>().toBeFunction();
    expectTypeOf<FragmentHandler<ShopEnv>>().toBeFunction();
  });
});
