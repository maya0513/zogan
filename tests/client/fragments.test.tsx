import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  __resetFragments,
  createFragmentRuntime,
  disposeFragmentsIn,
  fetchFragment,
  scanFragments,
  startFragments,
} from "../../src/client/fragments";

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
  return new Response(body, { ...init, headers, status: init.status ?? 200 });
};

const slot = (src: string, body = "fallback", trigger = "load", tag = "div") =>
  `<${tag} data-zogan-fragment="${src}" data-zogan-protocol="1" ` +
  `data-zogan-trigger="${trigger}">${body}</${tag}>`;

const setBody = (html: string): Element[] => {
  document.body.innerHTML = html;
  return [...document.body.children];
};

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("read-only Fragment runtime", () => {
  test("GETs same-origin HTML and replaces only one slot's children", async () => {
    const fetchMock = vi.fn(async () => htmlResponse("<b>fresh</b>"));
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(slot("/fragments/header"))[0]!;

    const runtime = startFragments({ root: element });

    await vi.waitFor(() => expect(element.innerHTML).toBe("<b>fresh</b>"));
    expect(element.getAttribute("data-zogan-fragment")).toBe("/fragments/header");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/fragments/header", location.href).href,
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "text/html" },
        redirect: "manual",
      }),
    );

    runtime.dispose();
    expect(element.textContent).toBe("fallback");
    runtime.dispose();
  });

  test("shares one in-flight request between equal URLs", async () => {
    let resolve: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((done) => (resolve = done)));
    vi.stubGlobal("fetch", fetchMock);
    setBody(slot("/shared", "a") + slot("/shared", "b"));
    const runtime = startFragments();

    expect(fetchMock).toHaveBeenCalledOnce();
    resolve?.(htmlResponse("same"));
    await vi.waitFor(() => expect(document.body.textContent).toBe("samesame"));
    runtime.dispose();
    expect(document.body.textContent).toBe("ab");
  });

  test("visible, idle, and media triggers stay deferred", async () => {
    let idle: (() => void) | undefined;
    const mediaListeners: ((event: { matches: boolean }) => void)[] = [];
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
        mediaListeners.push(listener),
      removeEventListener: vi.fn(),
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return htmlResponse(new URL(href).pathname);
    });
    vi.stubGlobal("fetch", fetchMock);
    setBody(
      slot("/visible", "v", "visible") +
        slot("/idle", "i", "idle") +
        slot("/media", "m", "media:screen"),
    );
    const runtime = startFragments();
    expect(fetchMock).not.toHaveBeenCalled();

    FakeIntersectionObserver.instances[0]!.enter();
    idle?.();
    mediaListeners[0]?.({ matches: true });
    await vi.waitFor(() => expect(document.body.textContent).toBe("/visible/idle/media"));
    runtime.dispose();
  });

  test("falls back to a timer and supports an initially matching media query", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    setBody(slot("/idle", "i", "idle") + slot("/media", "m", "media:all"));
    const runtime = startFragments();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    runtime.dispose();
  });

  test("dispose cancels pending work and a late response cannot mutate the root", async () => {
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/late"))[0]!;
    const runtime = startFragments({ root: element });
    runtime.dispose();
    resolve?.(htmlResponse("late"));

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("fallback");
  });

  test.each([
    ["Fragment", slot("/nested")],
    ["Island", '<div data-zogan-island="Nested" data-zogan-protocol="1">island</div>'],
    ["reserved marker", '<span data-zogan-future="2">future</span>'],
  ])("rejects a response containing another %s boundary", async (_label, responseBody) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse(responseBody)),
    );
    const element = setBody(slot("/owner"))[0]!;
    const runtime = startFragments({ root: element });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(element.textContent).toBe("fallback");
    runtime.dispose();
  });

  test("rejects nested ownership already present in the document", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setBody(slot("/outer", slot("/inner")));

    const runtime = startFragments();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nested Fragment"));
    runtime.dispose();
  });

  test.each([
    [
      "bad protocol",
      '<div data-zogan-fragment="/x" data-zogan-protocol="2" data-zogan-trigger="load">fallback</div>',
    ],
    ["missing protocol", '<div data-zogan-fragment="/x" data-zogan-trigger="load">fallback</div>'],
    [
      "unknown marker",
      '<div data-zogan-fragment="/x" data-zogan-protocol="1" data-zogan-trigger="load" data-zogan-next="1">fallback</div>',
    ],
    ["invalid trigger", slot("/x", "fallback", "manual")],
    ["relative URL", slot("relative")],
    ["unsupported element", slot("/x", "fallback", "load", "template")],
  ])("%s fails closed before fetching", (_label, html) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setBody(html);

    const runtime = startFragments();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("fresh");
    runtime.dispose();
  });

  test.each([
    ["redirect", () => new Response("", { status: 302 })],
    ["HTTP error", () => new Response("bad", { status: 500 })],
    ["non-HTML", () => new Response("{}", { headers: { "Content-Type": "application/json" } })],
    ["network error", () => Promise.reject(new TypeError("offline"))],
  ])("%s preserves fallback", async (_label, response) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(response));
    const element = setBody(slot("/failure"))[0]!;
    const runtime = startFragments({ root: element });

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(element.textContent).toBe("fallback");
    runtime.dispose();
  });

  test("ignores a response after the descriptor changes", async () => {
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/before"))[0]!;
    const runtime = startFragments({ root: element });
    element.setAttribute("data-zogan-fragment", "/after");
    resolve?.(htmlResponse("stale"));

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("fallback");
    runtime.dispose();
  });

  test("ignores a response after its protocol marker becomes invalid", async () => {
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    const element = setBody(slot("/before"))[0]!;
    const runtime = startFragments({ root: element });
    element.removeAttribute("data-zogan-protocol");
    resolve?.(htmlResponse("stale"));

    await new Promise((done) => setTimeout(done, 0));
    expect(element.textContent).toBe("fallback");
    runtime.dispose();
  });

  test("a deferred trigger revalidates its descriptor before fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(slot("/before", "fallback", "visible"))[0]!;
    const runtime = startFragments({ root: element });
    element.setAttribute("data-zogan-fragment", "/after");

    FakeIntersectionObserver.instances[0]!.enter();

    expect(fetchMock).not.toHaveBeenCalled();
    runtime.dispose();
  });

  test("parses table content in the receiving context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("<tr><td>fresh</td></tr>")),
    );
    document.body.innerHTML = `<table>${slot("/rows", "<tr><td>fallback</td></tr>", "load", "tbody")}</table>`;
    const runtime = startFragments();

    await vi.waitFor(() => expect(document.querySelector("td")?.textContent).toBe("fresh"));
    runtime.dispose();
  });

  test("createFragmentRuntime ignores scans after destroy", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const runtime = createFragmentRuntime();
    runtime.destroy();
    runtime.destroy();
    runtime.scan(setBody(slot("/ignored")));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("destroy cancels deferred triggers and stale callbacks remain inert", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const runtime = createFragmentRuntime();
    runtime.scan(setBody(slot("/deferred", "fallback", "visible")));
    const observer = FakeIntersectionObserver.instances[0]!;

    runtime.destroy();
    expect(observer.disconnected).toBe(true);
    observer.enter();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("repeated scans claim a marker once and internal disposal helpers remain bounded", () => {
    const fetchMock = vi.fn(async () => htmlResponse("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    const nodes = setBody(slot("/once", "fallback", "visible"));
    const runtime = createFragmentRuntime();
    runtime.scan(nodes);
    runtime.scan(nodes);
    runtime.dispose(nodes);

    scanFragments(nodes);
    disposeFragmentsIn(nodes);
    __resetFragments();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("non-HTML marker roots fail closed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const element = document.createElementNS("http://www.w3.org/2000/svg", "g");
    element.setAttribute("data-zogan-fragment", "/svg");
    element.setAttribute("data-zogan-protocol", "1");
    element.setAttribute("data-zogan-trigger", "load");
    document.body.append(element);

    const runtime = startFragments({ root: element });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("requires an HTML element"));
    runtime.dispose();
  });

  test("a disappearing marker value fails closed during descriptor reading", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const element = setBody(slot("/unstable"))[0]!;
    const getAttribute = element.getAttribute.bind(element);
    vi.spyOn(element, "getAttribute").mockImplementation((name) =>
      name === "data-zogan-fragment" ? null : getAttribute(name),
    );

    const runtime = startFragments({ root: element });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    runtime.dispose();
  });

  test("fetchFragment itself rejects an invalid URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFragment("relative/path")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
});
