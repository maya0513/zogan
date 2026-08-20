import { denoTest } from "../../../tests/deno/test.ts";
import { createSampleApp } from "../src/sample.tsx";

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (condition !== true) throw new Error(message);
};

denoTest("the sample renders a complete Page with Fragment and Island markers", async () => {
  const response = await createSampleApp().request("http://localhost/?page=2");
  const body = await response.text();

  assert(response.status === 200, "Page response must succeed");
  assert(body.startsWith("<!DOCTYPE html>"), "Page response must contain a doctype");
  assert(body.includes("Page 2"), "page query must be rendered");
  assert(body.includes('data-zogan-island="PageStatus"'), "Island marker is missing");
  assert(body.includes('data-zogan-fragment="/fragments/status"'), "Fragment marker is missing");
  assert(body.includes("Server status unavailable"), "Fragment fallback is missing");
  assert(
    response.headers.get("Cache-Control") === "public, max-age=0, s-maxage=60",
    "Page cache policy mismatch",
  );
});

denoTest("the sample Fragment is a raw HTML response with its own cache boundary", async () => {
  const response = await createSampleApp().request("http://localhost/fragments/status");
  const body = await response.text();

  assert(response.status === 200, "Fragment response must succeed");
  assert(
    body === '<time datetime="2026-01-01T00:00:00.000Z">Deno is ready</time>',
    "Fragment body mismatch",
  );
  assert(!body.includes("<!DOCTYPE html>"), "Fragment must not contain a document");
  assert(
    response.headers.get("Cache-Control") === "private, no-store",
    "Fragment cache policy mismatch",
  );
});

denoTest("the sample keeps one representation per URL", async () => {
  const app = createSampleApp();
  const normal = await app.request("http://localhost/?page=3");
  const attemptedPartial = await app.request("http://localhost/?page=3", {
    headers: { "X-Partial": "content" },
  });

  assert((await attemptedPartial.text()) === (await normal.text()), "X-Partial changed the Page");
  assert(attemptedPartial.headers.get("X-Partial") === null, "legacy partial header was emitted");
  assert(
    (await app.request("http://localhost/missing")).status === 404,
    "missing route must be 404",
  );
});

denoTest("each sample app instance owns its own layout and routes", async () => {
  const first = createSampleApp();
  const second = createSampleApp();
  const [firstResponse, secondResponse] = await Promise.all([
    first.request("http://localhost/?page=1"),
    second.request("http://localhost/?page=4"),
  ]);

  assert((await firstResponse.text()).includes("Page 1"), "first app instance mixed state");
  assert((await secondResponse.text()).includes("Page 4"), "second app instance mixed state");
});
