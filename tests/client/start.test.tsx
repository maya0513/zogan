import { afterEach, describe, expect, test, vi } from "vitest";
import { start } from "../../src/client/start";

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
