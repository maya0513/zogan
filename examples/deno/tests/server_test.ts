import { app } from "../server.tsx";
import { denoTest } from "../../../tests/deno/test.ts";

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (condition !== true) throw new Error(message);
};

denoTest("Deno example always serves a complete page document", async () => {
  const full = await app.request("http://localhost/?page=2");
  const fullBody = await full.text();
  assert(full.status === 200, "full page failed");
  assert(fullBody.includes("<!DOCTYPE html>"), "doctype missing");
  assert(fullBody.includes("Page 2"), "page content missing");
  assert(fullBody.includes('data-zogan-island="PageStatus"'), "typed PageStatus Island missing");
  assert(fullBody.includes("Confirmed page: 2"), "PageStatus SSR content missing");
  assert(
    full.headers.get("Cache-Control") === "public, max-age=0, s-maxage=60",
    "page cache policy mismatch",
  );

  const xPartial = await app.request("http://localhost/?page=3", {
    headers: { "X-Partial": "content" },
  });
  const xPartialBody = await xPartial.text();
  assert(xPartialBody.includes("<!DOCTYPE html>"), "X-Partial must still return a document");
  assert(xPartialBody.includes("Page 3"), "requested page content missing");
  assert(xPartial.headers.get("X-Partial") === null, "legacy partial response header present");
  assert(!xPartialBody.includes("data-client-nav"), "legacy client navigation marker present");
  assert(!xPartialBody.includes("data-store"), "legacy Store snapshot present");
});

denoTest("Deno example exposes an explicit clock fragment", async () => {
  const page = await app.request("http://localhost/");
  const pageBody = await page.text();
  assert(
    pageBody.includes('data-zogan-fragment="/fragments/clock"'),
    "FragmentSlot source missing",
  );
  assert(pageBody.includes('data-zogan-trigger="load"'), "automatic Fragment trigger missing");

  const fragment = await app.request("http://localhost/fragments/clock");
  const fragmentBody = await fragment.text();
  assert(fragment.status === 200, "fragment failed");
  assert(
    fragment.headers.get("Cache-Control") === "public, max-age=0, s-maxage=5",
    "fragment cache policy mismatch",
  );
  assert(fragmentBody.includes("<time"), "fragment markup missing");
  assert(!fragmentBody.includes("<!DOCTYPE html>"), "fragment must not contain a document");

  const legacyFragment = await app.request("http://localhost/_f/clock");
  assert(legacyFragment.status === 404, "legacy fragment prefix must not be registered");

  const missing = await app.request("http://localhost/missing");
  assert(missing.status === 404, "missing route must return 404");
});
