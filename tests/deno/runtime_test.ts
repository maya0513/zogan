import { Hono } from "hono";
import { h } from "preact";
import { createZogan, FragmentSlot, privateNoStore, publicCache, type ZoganOptions } from "zogan";
import * as client from "zogan/client";
import { zoganVite } from "zogan/vite";
import { denoTest } from "./test.ts";

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (condition !== true) throw new Error(message);
};

const layout: NonNullable<ZoganOptions["layout"]> = ({ children }) =>
  h("html", null, h("body", null, children));

denoTest("the public server entry renders one complete representation per URL", async () => {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use(async (c, next) => {
    c.set("requestId", "deno");
    await next();
  });
  const z = createZogan({ layout });

  app.get("/", (c) => z.page(c, h("main", null, c.get("requestId")), { cache: publicCache() }));

  const full = await app.request("http://localhost/");
  const fullBody = await full.text();
  assert(full.status === 200, "full response must succeed");
  assert(fullBody.startsWith("<!DOCTYPE html>"), "full response must contain a doctype");
  assert(fullBody.includes("<main>deno</main>"), "page body missing");

  const repeated = await app.request("http://localhost/", {
    headers: { "X-Partial": "content" },
  });
  assert(repeated.headers.get("X-Partial") === null, "custom partial header must not be emitted");
  assert((await repeated.text()) === fullBody, "request headers must not change representation");
});

denoTest("fragments use explicit routes and keep their cache boundary", async () => {
  const app = new Hono();
  const z = createZogan();
  app.get("/", (c) =>
    z.page(c, h("main", null, h(FragmentSlot, { src: "/fragments/account" }, "Signed out")), {
      cache: publicCache({ sMaxAge: 60 }),
    }),
  );
  app.get("/fragments/account", (c) =>
    z.fragment(c, h("aside", null, "Deno account"), { cache: privateNoStore() }),
  );

  const response = await app.request("http://localhost/fragments/account");
  const body = await response.text();
  assert(response.status === 200, "fragment response must succeed");
  assert(response.headers.get("Cache-Control") === "private, no-store", "cache policy changed");
  assert(body === "<aside>Deno account</aside>", "fragment must contain raw HTML only");
});

denoTest("client and Vite entries are importable in Deno", () => {
  assert(typeof client.start === "function", "client start export missing");
  assert(typeof client.refreshFragment === "function", "client fragment export missing");
  assert(!("navigate" in client), "removed navigation API was exported");
  assert(!("clientStore" in client), "removed store API was exported");
  assert(zoganVite().name === "zogan", "Vite plugin export missing");
});
