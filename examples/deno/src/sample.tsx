import { Hono } from "hono";
import type { ComponentChildren } from "preact";
import {
  createZogan,
  defineIsland,
  FragmentSlot,
  Island,
  privateNoStore,
  publicCache,
  type JsonObject,
} from "zogan";
import PageStatus from "./islands/PageStatus.tsx";

export type PageStatusProps = JsonObject & {
  readonly page: number;
};

const Layout = ({ children }: { readonly children?: ComponentChildren }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <title>zogan Deno sample</title>
    </head>
    <body>{children}</body>
  </html>
);

/** Create a small Hono application showing Page, Fragment, Cache, and Island. */
export const createSampleApp = (): Hono => {
  const zogan = createZogan({ layout: Layout });
  const pageStatus = defineIsland<PageStatusProps>({
    id: "PageStatus",
    component: PageStatus,
  });
  const app = new Hono();

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
          <FragmentSlot src="/fragments/status" trigger="load">
            <time>Server status unavailable</time>
          </FragmentSlot>
        </section>
      </main>,
      { cache: publicCache({ sMaxAge: 60 }) },
    );
  });

  app.get("/fragments/status", (c) =>
    zogan.fragment(c, <time dateTime="2026-01-01T00:00:00.000Z">Deno is ready</time>, {
      cache: privateNoStore(),
    }),
  );

  app.notFound((c) => c.text("Not found", 404));
  return app;
};

export const app = createSampleApp();
