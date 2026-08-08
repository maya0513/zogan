import { Hono } from "hono";
import { h } from "preact";
import { Partial, StoreSnapshot, type ZoganOptions, zogan } from "zogan";
import * as client from "zogan/client";
import { zoganVite } from "zogan/vite";
import { denoTest } from "./test.ts";

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const layout: NonNullable<ZoganOptions["layout"]> = ({ children }) =>
  h("html", null, h("body", { "data-client-nav": true }, children));

denoTest("the public server entry renders full and partial responses", async () => {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use(async (c, next) => {
    c.set("requestId", "deno");
    await next();
  });
  zogan(app, { dev: true, layout });

  app.page("/", (c) => {
    c.header("Cache-Control", "public, max-age=0");
    return c.render(h("main", null, h(Partial, { name: "content" }, c.get("requestId"))));
  });

  const full = await app.request("http://localhost/");
  const fullBody = await full.text();
  assert(full.status === 200, "full response must succeed");
  assert(fullBody.startsWith("<!DOCTYPE html>"), "full response must contain a doctype");
  assert(fullBody.includes("<!--p:content-->deno<!--/p:content-->"), "partial markers missing");

  const partial = await app.request("http://localhost/", {
    headers: { "X-Partial": "content" },
  });
  assert(partial.headers.get("X-Partial") === "content", "partial header mismatch");
  assert(
    (await partial.text()) === "<!--p:content-->deno<!--/p:content-->",
    "partial body mismatch",
  );
});

denoTest("fragments and store snapshots keep their cache boundary", async () => {
  const app = new Hono();
  zogan(app, { dev: true });
  app.fragment("account", (c) => {
    c.header("Cache-Control", "private, no-store");
    return c.render(h("aside", null, h(StoreSnapshot, { name: "account", data: { version: 1 } })));
  });

  const response = await app.request("http://localhost/_f/account");
  const body = await response.text();
  assert(response.status === 200, "fragment response must succeed");
  assert(response.headers.get("Cache-Control") === "private, no-store", "cache policy changed");
  assert(body.includes('data-store="account"'), "store snapshot missing");
});

denoTest("client and Vite entries are importable in Deno", () => {
  assert(typeof client.start === "function", "client start export missing");
  assert(typeof client.clientStore === "function", "client store export missing");
  assert(zoganVite().name === "zogan", "Vite plugin export missing");
});
