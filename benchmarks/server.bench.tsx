/* @jsxImportSource preact */
import { Hono } from "hono";
import type { ComponentChildren } from "preact";
import { bench, describe } from "vitest";
import {
  FragmentSlot,
  Island,
  createZogan,
  defineIsland,
  publicCache,
  type JsonObject,
} from "../src/server/index";

type PageStatusProps = JsonObject & {
  readonly page: number;
};

const PageStatus = ({ page }: PageStatusProps) => <output>Page {page}</output>;
const pageStatus = defineIsland<PageStatusProps>({
  id: "PageStatus",
  component: PageStatus,
});

const products = Array.from({ length: 100 }, (_, index) => (
  <article key={index}>
    <h2>Product {index}</h2>
    <p>Reusable server-rendered product description.</p>
  </article>
));

const Layout = ({ children }: { children?: ComponentChildren }) => (
  <html lang="en">
    <head>
      <title>Products</title>
    </head>
    <body>{children}</body>
  </html>
);

const zogan = createZogan({ layout: Layout });
const page = (
  <main>
    <h1>Products</h1>
    <Island of={pageStatus} props={{ page: 1 }} />
    <FragmentSlot src="/fragments/cart" trigger="visible">
      <span>Cart unavailable</span>
    </FragmentSlot>
    <section>{products}</section>
  </main>
);
const fragment = <section>{products.slice(0, 20)}</section>;

const pageApp = new Hono();
pageApp.get("/", (c) =>
  zogan.page(c, page, {
    cache: publicCache({ sMaxAge: 60, staleWhileRevalidate: 30 }),
  }),
);

const fragmentApp = new Hono();
fragmentApp.get("/fragments/products", (c) =>
  zogan.fragment(c, fragment, {
    cache: publicCache({ sMaxAge: 5 }),
  }),
);

describe("server response rendering", () => {
  bench("Page render: 100 products and typed Island", async () => {
    const response = await pageApp.request("/");
    await response.text();
  });

  bench("Fragment render: 20 product cards", async () => {
    const response = await fragmentApp.request("/fragments/products");
    await response.text();
  });
});
