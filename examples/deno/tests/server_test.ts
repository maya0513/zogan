import { app } from "../server.tsx";
import { denoTest } from "../../../tests/deno/test.ts";

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

denoTest("Deno example serves full and partial pages", async () => {
  const full = await app.request("http://localhost/?page=2");
  const fullBody = await full.text();
  assert(full.status === 200, "full page failed");
  assert(fullBody.includes("<!DOCTYPE html>"), "doctype missing");
  assert(fullBody.includes("Page 2"), "page content missing");
  assert(fullBody.includes('data-store="page"'), "store snapshot missing");
  assert(full.headers.get("Cache-Control") === "private, no-store", "cache policy mismatch");

  const partial = await app.request("http://localhost/?page=3", {
    headers: { "X-Partial": "content" },
  });
  const partialBody = await partial.text();
  assert(partial.headers.get("X-Partial") === "content", "partial contract missing");
  assert(partialBody.includes("Page 3"), "partial content missing");
  assert(!partialBody.includes("<!DOCTYPE html>"), "partial must not contain a document");
});

denoTest("Deno example serves fragments and handles missing assets", async () => {
  const fragment = await app.request("http://localhost/_f/clock");
  assert(fragment.status === 200, "fragment failed");
  assert(fragment.headers.get("Cache-Control")?.includes("s-maxage=5"), "fragment TTL missing");
  assert((await fragment.text()).includes("<time"), "fragment markup missing");

  const missing = await app.request("http://localhost/missing");
  assert(missing.status === 404, "missing route must return 404");
});
