/** @jsxImportSource preact */
import { bench, describe } from "vitest";
import { Partial } from "../src/server/partial";
import { containsStoreSnapshot } from "../src/server/cache";
import { extractPartials, findMarkers } from "../src/server/markers";
import { renderZogan } from "../src/server/render";

const products = Array.from({ length: 100 }, (_, index) => (
  <article key={index}>
    <h2>Product {index}</h2>
    <p>Reusable server-rendered product description.</p>
  </article>
));

const renderPage = () =>
  renderZogan(
    <main>
      <Partial name="count">100 results</Partial>
      <Partial name="results">{products}</Partial>
      <Partial name="pager">Page 1</Partial>
    </main>,
    { kind: "page", dev: false, fragmentPrefix: "/_f/" },
  );

const rendered = renderPage();
const manyPartials = Array.from(
  { length: 100 },
  (_, index) => `<!--p:item-${index}--><span>${index}</span><!--/p:item-${index}-->`,
).join("");
const ranges = findMarkers(manyPartials);
const snapshotDocument = `${rendered.html}<script type="application/json" data-store="cart">{"version":1}</script>`;

describe("server rendering", () => {
  bench("SSR: 100 products and 3 partials", () => {
    renderPage();
  });

  bench("Partial extraction: 10 of 100 markers", () => {
    extractPartials(
      manyPartials,
      [
        "item-1",
        "item-5",
        "item-10",
        "item-20",
        "item-30",
        "item-40",
        "item-50",
        "item-60",
        "item-70",
        "item-99",
      ],
      ranges,
    );
  });

  bench("Snapshot scan: rendered document", () => {
    containsStoreSnapshot(snapshotDocument);
  });
});
