import { Component } from "preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  __resetIslands,
  disposeIslandsIn,
  hydrateIslands,
  registerIslands,
  type IslandComponent,
  type IslandLoader,
} from "../../src/client/islands";
import { FakeIntersectionObserver } from "../helpers/intersection-observer";

const moduleOf = (component: IslandComponent): IslandLoader =>
  vi.fn(async () => ({ default: component }));

const setBody = (html: string): Element[] => {
  document.body.innerHTML = html;
  return [...document.body.children];
};

const ThrowingIsland: IslandComponent = () => {
  throw new Error("render failed");
};

const ClientIsland: IslandComponent = () => <span>client</span>;

const island = (
  id: string,
  options: { mode?: string; trigger?: string; props?: string; body?: string } = {},
) =>
  `<div data-zogan-island="${id}" data-zogan-mode="${options.mode ?? "hydrate"}" ` +
  `data-zogan-protocol="1" ` +
  `data-zogan-trigger="${options.trigger ?? "load"}" ` +
  `data-zogan-props='${options.props ?? "{}"}'>${options.body ?? "<span>SSR</span>"}</div>`;

beforeEach(() => {
  __resetIslands();
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("lazy islands", () => {
  test("load lazily imports and hydrates SSR DOM", async () => {
    const loader = moduleOf(({ label }: { label: string }) => (
      <button type="button">{label}</button>
    ));
    registerIslands({ Counter: loader });
    const container = setBody(
      island("Counter", { props: '{"label":"Count"}', body: "<button>Count</button>" }),
    )[0]!;
    const button = container.firstChild;

    hydrateIslands([...document.body.childNodes]);

    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    expect(document.querySelector("button")).toBe(button);
    expect(document.querySelector("button")!.textContent).toBe("Count");
  });

  test("mount mode replaces the explicit server fallback", async () => {
    registerIslands({ Map: moduleOf(() => <button type="button">Open map</button>) });
    hydrateIslands(setBody(island("Map", { mode: "mount", body: "<a>Map fallback</a>" })));

    await vi.waitFor(() => expect(document.querySelector("button")?.textContent).toBe("Open map"));
    expect(document.querySelector("a")).toBeNull();
  });

  test("a loader is memoized across island instances", async () => {
    const loader = moduleOf(() => <span>ready</span>);
    registerIslands({ Shared: loader });
    hydrateIslands(setBody(island("Shared") + island("Shared")));

    await vi.waitFor(() => expect(document.body.textContent).toBe("readyready"));
    expect(loader).toHaveBeenCalledOnce();
  });

  test("visible waits for intersection and cleans its observer on disposal", async () => {
    const loader = moduleOf(() => <span>visible</span>);
    registerIslands({ BelowFold: loader });
    const nodes = setBody(island("BelowFold", { trigger: "visible" }));
    hydrateIslands(nodes);

    expect(loader).not.toHaveBeenCalled();
    expect(FakeIntersectionObserver.instances[0]!.options?.rootMargin).toBe("200px");
    FakeIntersectionObserver.instances[0]!.enter(false);
    expect(loader).not.toHaveBeenCalled();
    FakeIntersectionObserver.instances[0]!.enter();
    await vi.waitFor(() => expect(document.body.textContent).toBe("visible"));

    disposeIslandsIn(nodes);
    expect(FakeIntersectionObserver.instances[0]!.disconnected).toBe(true);
  });

  test("idle uses requestIdleCallback and media waits for a matching query", async () => {
    let idle: (() => void) | undefined;
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => {
        idle = callback;
        return 7;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const mediaListeners: ((event: { matches: boolean }) => void)[] = [];
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
        mediaListeners.push(listener),
      removeEventListener: vi.fn(),
    }));
    const idleLoader = moduleOf(() => <span>idle</span>);
    const mediaLoader = moduleOf(() => <span>media</span>);
    registerIslands({ Idle: idleLoader, Media: mediaLoader });
    hydrateIslands(
      setBody(island("Idle", { trigger: "idle" }) + island("Media", { trigger: "media:screen" })),
    );

    expect(idleLoader).not.toHaveBeenCalled();
    expect(mediaLoader).not.toHaveBeenCalled();
    idle?.();
    mediaListeners[0]?.({ matches: false });
    expect(mediaLoader).not.toHaveBeenCalled();
    mediaListeners[0]?.({ matches: true });
    await vi.waitFor(() => expect(document.body.textContent).toBe("idlemedia"));
  });

  test("idle falls back to a timer and an initially matching media query loads immediately", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const idleLoader = moduleOf(() => <span>idle</span>);
    const mediaLoader = moduleOf(() => <span>media</span>);
    registerIslands({ Idle: idleLoader, Media: mediaLoader });
    hydrateIslands(
      setBody(island("Idle", { trigger: "idle" }) + island("Media", { trigger: "media:all" })),
    );

    await vi.waitFor(() => expect(document.body.textContent).toBe("idlemedia"));
  });

  test.each([
    ["missing loader", island("Missing"), "no lazy loader registered"],
    [
      "missing protocol",
      island("Broken").replace(' data-zogan-protocol="1"', ""),
      "unsupported island protocol",
    ],
    [
      "unsupported protocol",
      island("Broken").replace('data-zogan-protocol="1"', 'data-zogan-protocol="2"'),
      "unsupported island protocol",
    ],
    [
      "missing props marker",
      island("Broken").replace(" data-zogan-props='{}'", ""),
      "missing JSON props",
    ],
    ["invalid props", island("Broken", { props: "[1]" }), "invalid JSON props"],
    ["null props", island("Broken", { props: "null" }), "invalid JSON props"],
    ["primitive props", island("Broken", { props: "42" }), "invalid JSON props"],
    ["malformed props", island("Broken", { props: "{" }), "invalid JSON props"],
    [
      "non-finite nested props",
      island("Broken", { props: '{"nested":{"n":1e400}}' }),
      "invalid JSON props",
    ],
    ["non-div wrapper", island("Broken").replaceAll("div", "span"), "requires an HTML div wrapper"],
    [
      "unknown marker",
      island("Broken").replace("data-zogan-props", 'data-zogan-future="v2" data-zogan-props'),
      "unknown or overlapping zogan marker",
    ],
    ["missing mode", island("Broken").replace(' data-zogan-mode="hydrate"', ""), "invalid mode"],
    [
      "missing trigger",
      island("Broken").replace(' data-zogan-trigger="load"', ""),
      "invalid activation trigger",
    ],
    ["invalid mode", island("Broken", { mode: "replace" }), "invalid mode"],
    ["invalid trigger", island("Broken", { trigger: "whenever" }), "invalid activation trigger"],
  ])("%s warns for the exact reason and preserves SSR", async (_label, html, warning) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = moduleOf(() => <span>client</span>);
    registerIslands({ Broken: loader });
    hydrateIslands(setBody(html));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toBe("SSR");
    expect(loader).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.some(([message]) => typeof message === "string" && message.includes(warning)),
    ).toBe(true);
  });

  test("an invalid raw Island ID cannot activate even with a matching loader key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = moduleOf(() => <span>client</span>);
    registerIslands({ "bad-id": loader });
    hydrateIslands(
      setBody(
        '<div data-zogan-island="bad-id" data-zogan-mode="hydrate" data-zogan-trigger="load" data-zogan-props="{}"><span>SSR</span></div>',
      ),
    );

    expect(loader).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("SSR");
    expect(warn).toHaveBeenCalled();
  });

  test.each([
    ["SVG", "http://www.w3.org/2000/svg"],
    ["MathML", "http://www.w3.org/1998/Math/MathML"],
  ])("a same-localName %s marker is not an HTML Island", (_label, namespace) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = moduleOf(() => <span>client</span>);
    registerIslands({ Foreign: loader });
    const element = document.createElementNS(namespace, "div");
    element.setAttribute("data-zogan-island", "Foreign");
    element.setAttribute("data-zogan-mode", "hydrate");
    element.setAttribute("data-zogan-trigger", "load");
    element.setAttribute("data-zogan-props", "{}");
    element.textContent = "SSR";
    document.body.append(element);

    hydrateIslands([element]);

    expect(loader).not.toHaveBeenCalled();
    expect(element.textContent).toBe("SSR");
    expect(warn).toHaveBeenCalled();
  });

  test("a rejected module preserves SSR and a later instance can retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = vi
      .fn<IslandLoader>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ default: ClientIsland });
    registerIslands({ Retry: loader });
    hydrateIslands(setBody(island("Retry")));
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    expect(document.body.textContent).toBe("SSR");

    const next = document.createElement("div");
    next.innerHTML = island("Retry");
    const element = next.firstElementChild!;
    document.body.append(element);
    hydrateIslands([element]);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(element.textContent).toBe("client");
    expect(warn).toHaveBeenCalled();
  });

  test("a module without a default component preserves SSR", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = vi.fn(async () => ({ default: null as unknown as IslandComponent }));
    registerIslands({ Broken: loader });
    hydrateIslands(setBody(island("Broken")));

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(document.body.textContent).toBe("SSR");
  });

  test("activation errors restore the exact server fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerIslands({ Broken: moduleOf(ThrowingIsland) });
    const element = setBody(
      island("Broken", { mode: "mount", body: '<span data-state="server">fallback</span>' }),
    )[0]!;
    hydrateIslands([element]);

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("failed to activate island"),
        expect.any(Error),
      ),
    );
    expect(element.innerHTML).toBe('<span data-state="server">fallback</span>');
  });

  test("disposing pending triggers cancels idle, visibility, and media activation", () => {
    let idle: (() => void) | undefined;
    const cancelIdle = vi.fn();
    let media: ((event: { matches: boolean }) => void) | undefined;
    const removeMedia = vi.fn();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => {
        idle = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", cancelIdle);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
        media = listener;
      },
      removeEventListener: removeMedia,
    }));
    const visibleLoader = moduleOf(() => <span>visible</span>);
    const idleLoader = moduleOf(() => <span>idle</span>);
    const mediaLoader = moduleOf(() => <span>media</span>);
    registerIslands({ Visible: visibleLoader, Idle: idleLoader, Media: mediaLoader });
    const nodes = setBody(
      island("Visible", { trigger: "visible" }) +
        island("Idle", { trigger: "idle" }) +
        island("Media", { trigger: "media:screen" }),
    );
    hydrateIslands(nodes);

    disposeIslandsIn(nodes);
    FakeIntersectionObserver.instances[0]!.enter();
    idle?.();
    media?.({ matches: true });

    expect(FakeIntersectionObserver.instances[0]!.disconnected).toBe(true);
    expect(cancelIdle).toHaveBeenCalledWith(1);
    expect(removeMedia).toHaveBeenCalledOnce();
    expect(visibleLoader).not.toHaveBeenCalled();
    expect(idleLoader).not.toHaveBeenCalled();
    expect(mediaLoader).not.toHaveBeenCalled();
  });

  test("unavailable browser trigger APIs warn and preserve SSR", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("matchMedia", undefined);
    const visibleLoader = moduleOf(() => <span>visible</span>);
    const mediaLoader = moduleOf(() => <span>media</span>);
    registerIslands({ Visible: visibleLoader, Media: mediaLoader });

    hydrateIslands(
      setBody(
        island("Visible", { trigger: "visible" }) + island("Media", { trigger: "media:screen" }),
      ),
    );

    expect(warn).toHaveBeenCalledTimes(2);
    expect(visibleLoader).not.toHaveBeenCalled();
    expect(mediaLoader).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("SSRSSR");
  });

  test("repeated scans are idempotent", async () => {
    const loader = moduleOf(() => <span>ready</span>);
    registerIslands({ Defaults: loader });
    const element = setBody(island("Defaults"))[0]!;

    hydrateIslands([element]);
    hydrateIslands([element]);

    await vi.waitFor(() => expect(element.textContent).toBe("ready"));
    expect(loader).toHaveBeenCalledOnce();
  });

  test("removed targets do not mutate after lazy loading completes", async () => {
    let resolve: ((module: { default: IslandComponent }) => void) | undefined;
    const loader: IslandLoader = () => new Promise((done) => (resolve = done));
    registerIslands({ Late: loader });
    const nodes = setBody(island("Late"));
    hydrateIslands(nodes);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    disposeIslandsIn(nodes);
    document.body.replaceChildren();
    resolve!({ default: () => <span>late</span> });

    await new Promise((done) => setTimeout(done, 0));
    expect(document.body.textContent).toBe("");
  });

  test("a lazy Island moved below another Island before loading stays SSR-only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolve: ((module: { default: IslandComponent }) => void) | undefined;
    const loader: IslandLoader = () => new Promise((done) => (resolve = done));
    registerIslands({ Late: loader });
    const element = setBody(island("Late"))[0]!;
    hydrateIslands([element]);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));

    const owner = document.createElement("div");
    owner.setAttribute("data-zogan-island", "Owner");
    element.replaceWith(owner);
    owner.append(element);
    resolve!({ default: () => <span>client</span> });

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("SSR");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nested Fragment or Island"));
  });

  test.each([
    ["id", (element: Element) => element.setAttribute("data-zogan-island", "Other")],
    ["mode", (element: Element) => element.setAttribute("data-zogan-mode", "mount")],
    ["trigger", (element: Element) => element.setAttribute("data-zogan-trigger", "idle")],
    ["props", (element: Element) => element.setAttribute("data-zogan-props", '{"n":2}')],
    ["unknown", (element: Element) => element.setAttribute("data-zogan-future", "v2")],
  ])("%s marker drift before a deferred trigger never starts its loader", (_label, mutate) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = moduleOf(() => <span>client</span>);
    registerIslands({ Deferred: loader });
    const element = setBody(island("Deferred", { props: '{"n":1}', trigger: "visible" }))[0]!;
    hydrateIslands([element]);

    mutate(element);
    FakeIntersectionObserver.instances[0]!.enter();

    expect(loader).not.toHaveBeenCalled();
    expect(element.textContent).toBe("SSR");
    expect(warn).toHaveBeenCalled();
  });

  test.each([
    ["id", (element: Element) => element.setAttribute("data-zogan-island", "Other")],
    ["mode", (element: Element) => element.setAttribute("data-zogan-mode", "mount")],
    ["trigger", (element: Element) => element.setAttribute("data-zogan-trigger", "idle")],
    ["props", (element: Element) => element.setAttribute("data-zogan-props", '{"n":2}')],
    ["unknown", (element: Element) => element.setAttribute("data-zogan-future", "v2")],
  ])("%s marker drift during lazy loading cannot apply stale props", async (_label, mutate) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolve: ((module: { default: IslandComponent }) => void) | undefined;
    const loader = vi.fn<IslandLoader>(() => new Promise((done) => (resolve = done)));
    registerIslands({ Loading: loader });
    const element = setBody(island("Loading", { props: '{"n":1}' }))[0]!;
    hydrateIslands([element]);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

    mutate(element);
    resolve!({ default: ({ n }: { n: number }) => <span>{n}</span> });

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("SSR");
    expect(warn).toHaveBeenCalled();
  });

  test("disposal failures are contained", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mounted = vi.fn();
    class ThrowsOnUnmount extends Component {
      override componentDidMount(): void {
        mounted();
      }

      override componentWillUnmount(): void {
        throw new Error("unmount failed");
      }

      override render() {
        return <span>ready</span>;
      }
    }
    registerIslands({ Fragile: moduleOf(ThrowsOnUnmount) });
    const nodes = setBody(island("Fragile", { body: "<span>ready</span>" }));
    hydrateIslands(nodes);
    await vi.waitFor(() => expect(mounted).toHaveBeenCalledOnce());

    disposeIslandsIn(nodes);

    expect(warn).toHaveBeenCalledWith("zogan: failed to dispose an island", expect.any(Error));
  });

  test("nested islands are rejected so one Preact root owns each subtree", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outer = moduleOf(() => <span>outer</span>);
    const inner = moduleOf(() => <span>inner</span>);
    registerIslands({ Outer: outer, Inner: inner });
    hydrateIslands(
      setBody(island("Outer", { body: island("Inner", { body: "<span>inner SSR</span>" }) })),
    );

    await vi.waitFor(() => expect(outer).toHaveBeenCalledOnce());
    expect(inner).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test("an Island inside a Fragment is rejected before loading", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const inner = moduleOf(() => <span>inner</span>);
    registerIslands({ Inner: inner });
    const owner = document.createElement("div");
    owner.setAttribute("data-zogan-fragment", "/owner");
    owner.innerHTML = island("Inner");
    document.body.replaceChildren(owner);

    hydrateIslands([owner]);

    expect(inner).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nested Fragment or Island"));
  });
});
