import { h } from "preact";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { __resetFragments, refreshFragment } from "../src/client/fragments";
import {
  __resetIslands,
  disposeIslandsIn,
  hydrateIslands,
  registerIslands,
} from "../src/client/islands";

const fragmentSource = "/fragments/badge";
const fragmentHtml = "<span>Fresh fragment</span>";
const originalFetch = globalThis.fetch;

const fragmentSlots = Array.from(
  { length: 100 },
  (_, index) =>
    `<div data-zogan-fragment="${index < 75 ? fragmentSource : "/fragments/other"}" data-zogan-trigger="manual"><span>Fallback</span></div>`,
).join("");

const islandNodes = Array.from({ length: 100 }, (_, index) =>
  index < 75
    ? '<div data-zogan-island="BenchIsland" data-zogan-mode="mount" data-zogan-trigger="load" data-zogan-props="{&quot;label&quot;:&quot;Ready&quot;}"><span>Waiting</span></div>'
    : "<div>Static node</div>",
).join("");

beforeAll(() => {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(fragmentHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );
  document.body.innerHTML = fragmentSlots;
});

afterAll(() => {
  disposeIslandsIn([document.body]);
  __resetFragments();
  __resetIslands();
  globalThis.fetch = originalFetch;
});

describe("client enhancement paths", () => {
  bench("FragmentSlot fan-out/DOM replace: 75 of 100 slots", async () => {
    await refreshFragment(fragmentSource);
  });

  bench("Lazy Island discovery/loader: 75 of 100 nodes", async () => {
    disposeIslandsIn([document.body]);
    __resetIslands();
    document.body.innerHTML = islandNodes;

    let mounted = 0;
    let loaderCalls = 0;
    let resolveMounted: (() => void) | undefined;
    const allMounted = new Promise<void>((resolve) => {
      resolveMounted = resolve;
    });
    const BenchIsland = ({ label }: { label: string }) => {
      mounted += 1;
      if (mounted === 75) resolveMounted?.();
      return h("span", null, label);
    };

    registerIslands({
      BenchIsland: () => {
        loaderCalls += 1;
        return Promise.resolve({ default: BenchIsland });
      },
    });
    hydrateIslands([document.body]);
    await allMounted;

    if (loaderCalls !== 1) {
      throw new Error(`expected one shared Island loader call, received ${loaderCalls}`);
    }
  });
});
