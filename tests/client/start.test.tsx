import { afterEach, describe, expect, test, vi } from "vitest";
import { start } from "../../src/client/start";
import type { IslandComponent, IslandLoader } from "../../src/client/islands";

const island = (id: string, body = "<button>ready</button>") =>
  `<div data-zogan-island="${id}" data-zogan-mode="hydrate" data-zogan-protocol="1" ` +
  `data-zogan-trigger="load" data-zogan-props="{}">${body}</div>`;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("start", () => {
  test("owns only Islands below the supplied root", async () => {
    document.body.innerHTML =
      `<section id="one">${island("One")}</section>` +
      `<section id="two">${island("Two")}</section>`;
    const one = document.querySelector("#one")!;
    const oneLoader = vi.fn(async () => ({ default: () => <button type="button">one</button> }));
    const twoLoader = vi.fn(async () => ({ default: () => <button type="button">two</button> }));

    const runtime = start({ root: one, islands: { One: oneLoader, Two: twoLoader } });

    await vi.waitFor(() => expect(one.textContent).toBe("one"));
    expect(twoLoader).not.toHaveBeenCalled();
    expect(document.querySelector("#two")?.textContent).toBe("ready");
    runtime.dispose();
    expect(one.textContent).toBe("ready");
    runtime.dispose();
  });

  test("two disjoint roots activate and dispose independently", async () => {
    document.body.innerHTML =
      `<section id="one">${island("Shared", "<button>one fallback</button>")}</section>` +
      `<section id="two">${island("Shared", "<button>two fallback</button>")}</section>`;
    const one = document.querySelector("#one")!;
    const two = document.querySelector("#two")!;
    const oneLoader = vi.fn(async () => ({ default: () => <button type="button">one</button> }));
    const twoLoader = vi.fn(async () => ({ default: () => <button type="button">two</button> }));

    const oneRuntime = start({ root: one, islands: { Shared: oneLoader } });
    const twoRuntime = start({ root: two, islands: { Shared: twoLoader } });

    await vi.waitFor(() => expect(document.body.textContent).toBe("onetwo"));
    expect(oneLoader).toHaveBeenCalledOnce();
    expect(twoLoader).toHaveBeenCalledOnce();

    oneRuntime.dispose();
    expect(one.textContent).toBe("one fallback");
    expect(two.textContent).toBe("two");

    twoRuntime.dispose();
    expect(two.textContent).toBe("two fallback");
  });

  test("dispose restores the fallback captured immediately before activation", async () => {
    let resolve: ((module: { default: IslandComponent }) => void) | undefined;
    const loader: IslandLoader = () => new Promise((done) => (resolve = done));
    const marker = island("Late", "<span>initial</span>").replace(
      'data-zogan-mode="hydrate"',
      'data-zogan-mode="mount"',
    );
    document.body.innerHTML = `<section id="root">${marker}</section>`;
    const root = document.querySelector("#root")!;
    const element = root.querySelector("[data-zogan-island]")!;
    const runtime = start({ root, islands: { Late: loader } });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));

    element.innerHTML = '<span data-owner="external">updated</span>';
    resolve!({ default: () => <button type="button">client</button> });
    await vi.waitFor(() => expect(element.textContent).toBe("client"));

    runtime.dispose();
    expect(element.innerHTML).toBe('<span data-owner="external">updated</span>');
  });

  test("does not scan or fetch Fragment markers", () => {
    document.body.innerHTML =
      '<div data-zogan-fragment="/fragment" data-zogan-protocol="1" data-zogan-trigger="load">fallback</div>';
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const runtime = start();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("fallback");
    runtime.dispose();
    vi.unstubAllGlobals();
  });
});
