import { Hono } from "hono";
import type { ComponentChildren } from "preact";
import { createZogan, defineIsland, FragmentSlot, Island, publicCache } from "zogan";
import type { PageStatusProps } from "./src/island-props.ts";
import PageStatus from "./src/islands/PageStatus.tsx";

type DenoRuntime = {
  readFile(path: string | URL): Promise<Uint8Array<ArrayBuffer>>;
  serve(
    options: { port: number },
    handler: (request: Request) => Response | Promise<Response>,
  ): unknown;
  env: { get(name: string): string | undefined };
};

const deno = (globalThis as unknown as { Deno: DenoRuntime }).Deno;

const Layout = ({ children }: { children?: ComponentChildren }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>zogan on Deno</title>
      <link rel="stylesheet" href="/styles.css" />
      <script type="module" src="/client.js" />
    </head>
    <body>{children}</body>
  </html>
);

const zogan = createZogan({ layout: Layout });
const pageStatus = defineIsland<PageStatusProps>({
  id: "PageStatus",
  component: PageStatus,
});
const app = new Hono();

const staticAsset = /^([A-Za-z0-9_.-]+)\.(js|css)$/;

app.get("/:asset", async (c) => {
  const match = staticAsset.exec(c.req.param("asset"));
  if (match === null) return c.notFound();

  const [, stem, extension] = match;
  try {
    const body = await deno.readFile(new URL(`./dist/${stem}.${extension}`, import.meta.url));
    return new Response(body, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Type":
          extension === "js" ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") {
      return c.text("Asset not built", 404);
    }
    throw error;
  }
});

app.get("/", (c) => {
  const requested = Number(c.req.query("page") ?? "1");
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;

  return zogan.page(
    c,
    <main>
      <p>Running with Deno, Hono, Preact, and zogan.</p>
      <h1>Page {page}</h1>
      <nav aria-label="Pagination">
        {page > 1 && <a href={`/?page=${page - 1}`}>Previous</a>}
        <a href={`/?page=${page + 1}`}>Next</a>
      </nav>
      <Island of={pageStatus} props={{ page }} trigger="load" />
      <section>
        <h2>Fragment</h2>
        <div class="row">
          <FragmentSlot src="/fragments/clock" trigger="load">
            <time>Server time unavailable</time>
          </FragmentSlot>
        </div>
      </section>
    </main>,
    { cache: publicCache({ sMaxAge: 60 }) },
  );
});

app.get("/fragments/clock", (c) => {
  const now = new Date().toISOString();
  return zogan.fragment(c, <time dateTime={now}>{now}</time>, {
    cache: publicCache({ sMaxAge: 5 }),
  });
});

app.notFound((c) => c.text("Not found", 404));

export { app };

if (import.meta.main) {
  deno.serve({ port: Number(deno.env.get("PORT") ?? "8000") }, app.fetch);
}
