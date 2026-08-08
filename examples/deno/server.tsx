import { Hono } from "hono";
import type { ComponentChildren } from "preact";
import { Island, Partial, StoreSnapshot, zogan } from "zogan";

type DenoRuntime = {
  readFile(path: string | URL): Promise<Uint8Array<ArrayBuffer>>;
  serve(
    options: { port: number },
    handler: (request: Request) => Response | Promise<Response>,
  ): unknown;
  env: { get(name: string): string | undefined };
};

const deno = (globalThis as unknown as { Deno: DenoRuntime }).Deno;

const app = new Hono();

const Layout = ({ children }: { children: ComponentChildren }): preact.JSX.Element => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>zogan on Deno</title>
      <link rel="stylesheet" href="/styles.css" />
      <script type="module" src="/client.js" />
    </head>
    <body data-client-nav>{children}</body>
  </html>
);

zogan(app, { layout: Layout, dev: true });

const staticFiles = new Map([
  ["/client.js", { file: "client.js", contentType: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
]);

for (const [path, asset] of staticFiles) {
  app.get(path, async (c) => {
    try {
      const body = await deno.readFile(new URL(`./dist/${asset.file}`, import.meta.url));
      return new Response(body, {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Content-Type": asset.contentType,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "NotFound")
        return c.text("Asset not built", 404);
      throw error;
    }
  });
}

app.page("/", (c) => {
  const requested = Number(c.req.query("page") ?? "1");
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  c.header("Cache-Control", "private, no-store");
  return c.render(
    <main>
      <p>Running with Deno, Hono, Preact, and zogan.</p>
      <Partial name="content">
        <h1>Page {page}</h1>
        <nav aria-label="Pagination">
          {page > 1 && (
            <a href={`/?page=${page - 1}`} data-partial="content">
              Previous
            </a>
          )}
          <a href={`/?page=${page + 1}`} data-partial="content">
            Next
          </a>
        </nav>
        <StoreSnapshot name="page" data={{ version: page, page }} />
        <Island name="PageStatus" trigger="load">
          <output aria-live="polite">Confirmed page: {page}</output>
        </Island>
      </Partial>
      <section>
        <h2>Fragment</h2>
        <div class="row">
          <Island name="Clock" fragment="/_f/clock" trigger="none">
            <time>Waiting for a refresh</time>
          </Island>
          <Island name="RefreshClock" trigger="load">
            <button type="button">Refresh server time</button>
          </Island>
        </div>
      </section>
    </main>,
  );
});

app.fragment("clock", (c) => {
  c.header("Cache-Control", "public, max-age=0, s-maxage=5");
  return c.render(<time dateTime={new Date().toISOString()}>{new Date().toISOString()}</time>);
});

app.notFound((c) => c.text("Not found", 404));

export { app };

if (import.meta.main) {
  deno.serve({ port: Number(deno.env.get("PORT") ?? "8000") }, app.fetch);
}
