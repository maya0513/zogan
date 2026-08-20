import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { __resetFragments } from "../../src/client/fragments";
import { __resetIslands } from "../../src/client/islands";
import { __resetStart, start } from "../../src/client/start";

const htmlResponse = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

beforeEach(() => {
  __resetStart();
  __resetFragments();
  __resetIslands();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("start", () => {
  test("scans fragments and islands without intercepting navigation or forms", async () => {
    document.body.innerHTML =
      '<div data-zogan-fragment="/fragments/header" data-zogan-trigger="load">fallback</div>' +
      '<div data-zogan-island="Button" data-zogan-mode="hydrate" data-zogan-trigger="load" data-zogan-props="{}"><button type="button">ready</button></div>';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("<span>fresh</span>")),
    );
    const documentListeners = vi.spyOn(document, "addEventListener");
    const windowListeners = vi.spyOn(window, "addEventListener");

    start({
      islands: { Button: async () => ({ default: () => <button type="button">ready</button> }) },
    });

    await vi.waitFor(() => expect(document.body.textContent).toBe("freshready"));
    expect(documentListeners.mock.calls.map(([type]) => type)).not.toContain("click");
    expect(documentListeners.mock.calls.map(([type]) => type)).not.toContain("submit");
    expect(windowListeners.mock.calls.map(([type]) => type)).not.toContain("popstate");
  });

  test("islands are optional and a second start is ignored", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    start();
    start();
    expect(warn).toHaveBeenCalledOnce();
  });
});
