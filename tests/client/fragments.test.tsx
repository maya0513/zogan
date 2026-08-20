import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  __resetFragments,
  disposeFragmentsIn,
  fetchFragment,
  refreshFragment,
  scanFragments,
} from "../../src/client/fragments";
import { __resetIslands, hydrateIslands, registerIslands } from "../../src/client/islands";

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  disconnected = false;
  readonly targets: Element[] = [];

  constructor(
    private readonly callback: (entries: { isIntersecting: boolean; target: Element }[]) => void,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }

  enter() {
    this.callback(this.targets.map((target) => ({ target, isIntersecting: true })));
  }
}

const htmlResponse = (body: string, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, {
    ...init,
    status: init.status ?? 200,
    headers,
  });
};

const slot = (src: string, body = "fallback", trigger = "load", tag = "div") =>
  `<${tag} data-zogan-fragment="${src}" data-zogan-trigger="${trigger}">${body}</${tag}>`;

const setBody = (html: string): Element[] => {
  document.body.innerHTML = html;
  return [...document.body.children];
};

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

beforeEach(() => {
  __resetFragments();
  __resetIslands();
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FragmentSlot runtime", () => {
  test("GETs ordinary same-origin HTML and replaces only the slot children", async () => {
    const fetchMock = vi.fn(async () => htmlResponse("<b>fresh</b>"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(slot("/fragments/header"))[0]!;
    scanFragments([element]);

    await vi.waitFor(() => expect(element.innerHTML).toBe("<b>fresh</b>"));
    expect(element.getAttribute("data-zogan-fragment")).toBe("/fragments/header");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/fragments/header", location.href).href,
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "manual",
        headers: { Accept: "text/html" },
      }),
    );
  });

  test("fetchFragment itself rejects URLs outside the root-relative same-origin contract", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFragment("relative/path")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  test("a missing trigger warns and preserves fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody('<div data-zogan-fragment="/default-trigger">fallback</div>')[0]!;

    scanFragments([element]);
    scanFragments([element]);
    await refreshFragment("/default-trigger");

    expect(element.textContent).toBe("fallback");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test("a slot is claimed only once", async () => {
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(slot("/claimed-once"))[0]!;

    scanFragments([element]);
    scanFragments([element]);

    await vi.waitFor(() => expect(element.textContent).toBe("fresh"));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("concurrent slots with the same URL share one in-flight request and fan out", async () => {
    let resolve: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((done) => (resolve = done)));
    vi.stubGlobal("fetch", fetchMock);
    scanFragments(setBody(slot("/fragments/x", "a") + slot("/fragments/x", "b")));

    expect(fetchMock).toHaveBeenCalledOnce();
    resolve?.(htmlResponse("<span>same</span>"));
    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll("[data-zogan-fragment]")].map((el) => el.textContent),
      ).toEqual(["same", "same"]),
    );
  });

  test("manual waits for refreshFragment, which updates all exact targets", async () => {
    const fetchMock = vi.fn(async () => htmlResponse("updated"));
    vi.stubGlobal("fetch", fetchMock);
    scanFragments(
      setBody(slot("/fragments/x", "a", "manual") + slot("/fragments/x", "b", "manual")),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await refreshFragment("/fragments/x");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(document.body.textContent).toBe("updatedupdated");
  });

  test("visible, idle, media, and manual triggers do not fetch early", async () => {
    let idle: (() => void) | undefined;
    const listeners: ((event: { matches: boolean }) => void)[] = [];
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => {
        idle = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
        listeners.push(listener),
      removeEventListener: vi.fn(),
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      htmlResponse(new URL(urlOf(input)).pathname),
    );
    vi.stubGlobal("fetch", fetchMock);
    scanFragments(
      setBody(
        slot("/visible", "v", "visible") +
          slot("/idle", "i", "idle") +
          slot("/media", "m", "media:screen") +
          slot("/manual", "x", "manual"),
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    FakeIntersectionObserver.instances[0]!.enter();
    idle?.();
    listeners[0]?.({ matches: true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(document.body.textContent).toBe("/visible/idle/mediax"));
  });

  test("disposing or resetting a pending visible slot cancels its activation", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const nodes = setBody(
      slot("/disposed", "fallback", "visible") + slot("/reset", "fallback", "visible"),
    );
    scanFragments(nodes);

    disposeFragmentsIn([nodes[0]!]);
    __resetFragments();
    FakeIntersectionObserver.instances[0]!.enter();
    FakeIntersectionObserver.instances[1]!.enter();

    expect(FakeIntersectionObserver.instances[0]!.disconnected).toBe(true);
    expect(FakeIntersectionObserver.instances[1]!.disconnected).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("idle timer fallback and initially matching media fetch", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    scanFragments(setBody(slot("/idle", "i", "idle") + slot("/media", "m", "media:all")));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  test.each([
    ["cross-origin", "https://evil.example/x", () => htmlResponse("bad")],
    ["redirect", "/redirect", () => new Response("", { status: 302 })],
    ["http error", "/error", () => new Response("bad", { status: 500 })],
    [
      "non-html",
      "/json",
      () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
    ],
    ["network error", "/offline", () => Promise.reject(new TypeError("offline"))],
  ])("%s warns and preserves fallback", async (label, src, response) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(response);
    vi.stubGlobal("fetch", fetchMock);
    scanFragments(setBody(slot(src)));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(label === "cross-origin" ? 0 : 1);
  });

  test("a late response does not update a removed target", async () => {
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const nodes = setBody(slot("/late"));
    scanFragments(nodes);
    disposeFragmentsIn(nodes);
    document.body.replaceChildren();
    resolve?.(htmlResponse("late"));

    await new Promise((done) => setTimeout(done, 0));
    expect(document.body.textContent).toBe("");
  });

  test("an automatic response cannot cross into an Island that claimed the target", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/ownership-race"))[0]!;
    scanFragments([element]);

    const owner = document.createElement("div");
    owner.setAttribute("data-zogan-island", "Owner");
    element.replaceWith(owner);
    owner.append(element);
    resolve?.(htmlResponse("fresh"));

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nested inside an Island"));
  });

  test("a deferred Fragment cannot activate after moving into an Island", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(slot("/deferred-owner", "fallback", "visible"))[0]!;
    scanFragments([element]);

    const owner = document.createElement("div");
    owner.setAttribute("data-zogan-island", "Owner");
    element.replaceWith(owner);
    owner.append(element);
    FakeIntersectionObserver.instances[0]!.enter();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nested inside an Island"));
  });

  test("a deferred Fragment cannot activate after entering a same-source ancestor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(slot("/deferred-cycle", "fallback", "visible"))[0]!;
    scanFragments([element]);

    const ancestor = document.createElement("section");
    ancestor.setAttribute("data-zogan-fragment", "/deferred-cycle");
    ancestor.setAttribute("data-zogan-trigger", "manual");
    element.replaceWith(ancestor);
    ancestor.append(element);
    FakeIntersectionObserver.instances[0]!.enter();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ancestor source cycle"));
  });

  test("a deferred Fragment cannot activate after its descriptor changes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(slot("/deferred-marker", "fallback", "visible"))[0]!;
    scanFragments([element]);
    element.setAttribute("data-zogan-trigger", "idle");

    FakeIntersectionObserver.instances[0]!.enter();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("markers changed"));
  });

  test("an automatic response cannot enter a same-source ancestor while fetching", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/fetch-cycle"))[0]!;
    scanFragments([element]);

    const ancestor = document.createElement("section");
    ancestor.setAttribute("data-zogan-fragment", "/fetch-cycle");
    ancestor.setAttribute("data-zogan-trigger", "manual");
    element.replaceWith(ancestor);
    ancestor.append(element);
    resolve?.(htmlResponse("fresh"));

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ancestor source cycle"));
  });

  test("an automatic response is ignored after its source attribute changes", async () => {
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/before"))[0]!;
    scanFragments([element]);
    element.setAttribute("data-zogan-fragment", "/after");
    resolve?.(htmlResponse("stale"));

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("fallback");
  });

  test("an automatic response is ignored after its trigger marker changes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/trigger-drift"))[0]!;
    scanFragments([element]);
    element.setAttribute("data-zogan-trigger", "manual");
    resolve?.(htmlResponse("stale"));

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalled();
  });

  test("an automatic response is ignored after a required marker disappears", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/missing-marker"))[0]!;
    scanFragments([element]);
    element.removeAttribute("data-zogan-trigger");
    resolve?.(htmlResponse("stale"));

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("missing its activation trigger"));
  });

  test("a newer refresh wins over an older response", async () => {
    const resolves: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => resolves.push(done))),
    );
    const element = setBody(slot("/race", "fallback", "manual"))[0]!;
    scanFragments([element]);
    const first = refreshFragment("/race");
    __resetFragments();
    const second = refreshFragment("/race");
    resolves[1]!(htmlResponse("new"));
    await second;
    resolves[0]!(htmlResponse("old"));
    await first;
    expect(element.textContent).toBe("new");
  });

  test("refresh preserves fallback when fetching fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 500 })),
    );
    const element = setBody(slot("/failure", "fallback", "manual"))[0]!;
    scanFragments([element]);

    await refreshFragment("/failure");

    expect(element.textContent).toBe("fallback");
  });

  test("refresh ignores targets removed or retargeted while the request is in flight", async () => {
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const [removed, retargeted] = setBody(
      slot("/shared", "removed fallback", "manual") +
        slot("/shared", "retargeted fallback", "manual"),
    );
    scanFragments([removed!, retargeted!]);

    const refresh = refreshFragment("/shared");
    removed!.remove();
    retargeted!.setAttribute("data-zogan-fragment", "/other");
    resolve?.(htmlResponse("stale"));
    await refresh;

    expect(retargeted!.textContent).toBe("retargeted fallback");
  });

  test("refresh fanout skips a target moved into an Island while fetching", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const [safe, moved] = setBody(
      slot("/fanout-race", "safe fallback", "manual") +
        slot("/fanout-race", "moved fallback", "manual"),
    );
    scanFragments([safe!, moved!]);

    const refresh = refreshFragment("/fanout-race");
    const owner = document.createElement("div");
    owner.setAttribute("data-zogan-island", "Owner");
    moved!.replaceWith(owner);
    owner.append(moved!);
    resolve?.(htmlResponse("fresh"));
    await refresh;

    expect(safe!.textContent).toBe("fresh");
    expect(moved!.textContent).toBe("moved fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nested inside an Island"));
  });

  test("refresh skips a target moved into a same-source ancestor while fetching", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/refresh-cycle", "fallback", "manual"))[0]!;
    scanFragments([element]);

    const refresh = refreshFragment("/refresh-cycle");
    const ancestor = document.createElement("section");
    ancestor.setAttribute("data-zogan-fragment", "/refresh-cycle");
    ancestor.setAttribute("data-zogan-trigger", "manual");
    element.replaceWith(ancestor);
    ancestor.append(element);
    resolve?.(htmlResponse("fresh"));
    await refresh;

    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ancestor source cycle"));
  });

  test("refresh ignores a target whose trigger marker changes while fetching", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/refresh-marker-drift", "fallback", "manual"))[0]!;
    scanFragments([element]);

    const refresh = refreshFragment("/refresh-marker-drift");
    element.setAttribute("data-zogan-trigger", "load");
    resolve?.(htmlResponse("stale"));
    await refresh;

    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalled();
  });

  test("parses table content in the target context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("<tr><td>fresh</td></tr>")),
    );
    document.body.innerHTML = `<table>${slot("/rows", "<tr><td>fallback</td></tr>", "load", "tbody")}</table>`;
    scanFragments([document.documentElement]);
    await vi.waitFor(() => expect(document.querySelector("td")!.textContent).toBe("fresh"));
  });

  test("scans nested fragments and hydrates islands returned by a fragment", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(urlOf(input)).pathname;
      if (path === "/outer") {
        return htmlResponse(
          slot("/inner", "inner fallback") +
            '<div data-zogan-island="Stock" data-zogan-mode="hydrate" data-zogan-trigger="load" data-zogan-props=\'{"inventory":9}\'><span>9</span></div>',
        );
      }
      return htmlResponse("inner fresh");
    });
    vi.stubGlobal("fetch", fetchMock);
    registerIslands({
      Stock: async () => ({
        default: ({ inventory }: { inventory: number }) => <span>{inventory}</span>,
      }),
    });
    scanFragments(setBody(slot("/outer", "shell stale")));

    await vi.waitFor(() => expect(document.body.textContent).toBe("inner fresh9"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("missing target and malformed trigger are safe no-ops", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await refreshFragment("/missing");
    scanFragments(setBody(slot("/x", "fallback", "whenever")));
    await refreshFragment("/x");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test("a whitespace-only media query is invalid and preserves the fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    const matchMediaMock = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("matchMedia", matchMediaMock);

    scanFragments(setBody(slot("/blank-media", "fallback", "media:   ")));

    expect(matchMediaMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid activation trigger"));
  });

  test("a fragment nested inside an island is not activated", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    scanFragments(
      setBody(
        '<div data-zogan-island="Outer" data-zogan-mode="hydrate" data-zogan-trigger="load" data-zogan-props="{}">' +
          slot("/nested") +
          "</div>",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test("manual refresh cannot replace a fragment nested inside an island", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    setBody(
      '<div data-zogan-island="Outer" data-zogan-mode="hydrate" data-zogan-trigger="load" data-zogan-props="{}">' +
        slot("/nested", "nested fallback", "manual") +
        "</div>",
    );

    await refreshFragment("/nested");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("nested fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nested inside an Island"));
  });

  test("a fragment marker sharing an Island element is never fetched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(
      '<div data-zogan-island="Outer" data-zogan-mode="hydrate" data-zogan-props="{}" ' +
        'data-zogan-fragment="/shared-node" data-zogan-trigger="manual">fallback</div>',
    )[0]!;
    const loader = vi.fn(async () => ({ default: () => <span>client</span> }));
    registerIslands({ Outer: loader });

    scanFragments([element]);
    hydrateIslands([element]);
    await refreshFragment("/shared-node");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nested inside an Island"));
  });

  test.each([
    ["SVG", "http://www.w3.org/2000/svg"],
    ["MathML", "http://www.w3.org/1998/Math/MathML"],
  ])("a same-localName %s marker is not an HTML FragmentSlot", async (_label, namespace) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const element = document.createElementNS(namespace, "div");
    element.setAttribute("data-zogan-fragment", "/foreign");
    element.setAttribute("data-zogan-trigger", "load");
    element.textContent = "fallback";
    document.body.append(element);

    scanFragments([element]);
    await refreshFragment("/foreign");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalled();
  });

  test("an unknown zogan marker rejects automatic and manual Fragment activation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(slot("/future-marker"))[0]!;
    element.setAttribute("data-zogan-future", "v2");

    scanFragments([element]);
    await refreshFragment("/future-marker");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(element.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalled();
  });

  test("a direct same-source nested load is stopped after one request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(slot("/cycle", "cycle fallback")))
      .mockResolvedValueOnce(htmlResponse("unexpected second fetch"));
    vi.stubGlobal("fetch", fetchMock);

    scanFragments(setBody(slot("/cycle", "outer fallback")));

    await vi.waitFor(() => expect(document.body.textContent).toBe("cycle fallback"));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
  });

  test("an A to B to A nested load cycle stops before refetching A", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(slot("/b", "B fallback")))
      .mockResolvedValueOnce(htmlResponse(slot("/a", "A fallback")))
      .mockResolvedValueOnce(htmlResponse("unexpected third fetch"));
    vi.stubGlobal("fetch", fetchMock);

    scanFragments(setBody(slot("/a", "outer fallback")));

    await vi.waitFor(() => expect(document.body.textContent).toBe("A fallback"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
  });

  test("manual refresh cannot bypass an ancestor source cycle", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(
      '<div data-zogan-fragment="/manual-cycle" data-zogan-trigger="invalid">' +
        slot("/manual-cycle", "fallback", "manual") +
        "</div>",
    )[0]!;

    scanFragments([element]);
    await refreshFragment("/manual-cycle");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("fallback");
    expect(warn).toHaveBeenCalled();
  });

  test.each(["svg", "template", "img", "input"])(
    "an unsupported %s marker is rejected before automatic or manual fetching",
    async (tag) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi.fn(async () => htmlResponse("fresh"));
      vi.stubGlobal("fetch", fetchMock);
      const [element] = setBody(
        `<${tag} data-zogan-fragment="/unsupported" data-zogan-trigger="load">fallback</${tag}>`,
      );
      scanFragments([element!]);
      await refreshFragment("/unsupported");

      expect(fetchMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    },
  );
});
