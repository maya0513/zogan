import { bench, beforeAll, describe } from "vitest";
import { fragmentTargets } from "../src/client/fragments";
import { parseHTMLFragment, replaceRange } from "../src/client/dom";
import { __resetStores, clientStore, mergeSnapshots } from "../src/client/store";

beforeAll(() => {
  document.body.innerHTML =
    '<main id="page"><!--p:results--><article>old</article><!--/p:results--></main>' +
    Array.from(
      { length: 100 },
      (_, index) =>
        `<div data-island="Badge" data-fragment="${index < 75 ? "/_f/badge" : "/_f/other"}"></div>`,
    ).join("");
  __resetStores();
  clientStore("cart", { version: 0, count: 0 });
});

describe("client update paths", () => {
  bench("DOM replacement: 20 product cards", () => {
    const nodes = parseHTMLFragment(
      Array.from({ length: 20 }, (_, index) => `<article>Product ${index}</article>`).join(""),
    );
    replaceRange(document, "results", nodes, "replace");
  });

  bench("Store merge: versioned snapshot", () => {
    mergeSnapshots({ cart: { version: 1, count: 1 } });
  });

  bench("Fragment fan-out: select 75 of 100 islands", () => {
    fragmentTargets("/_f/badge");
  });
});
