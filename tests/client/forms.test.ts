import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { browser } from "../../src/client/browser";
import { handleSubmit, onDocumentSubmit, shouldInterceptForm } from "../../src/client/forms";
import { __resetFragments } from "../../src/client/fragments";
import { __resetIslands, registerIslands } from "../../src/client/islands";
import { __resetStores, clientStore } from "../../src/client/store";
import { urlOf } from "../helpers/url";

const htmlResponse = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });

const mockFetch = (impl: (url: string, init: RequestInit) => Response) => {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(urlOf(input), init ?? {})),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
};

const form = (html: string): HTMLFormElement => {
  document.body.insertAdjacentHTML("beforeend", html);
  return document.body.lastElementChild as HTMLFormElement;
};

const submitEvent = () => new SubmitEvent("submit", { bubbles: true, cancelable: true });

beforeEach(() => {
  __resetStores();
  __resetIslands();
  __resetFragments();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/products");
  vi.stubGlobal("scrollTo", vi.fn());
  browser.hardNavigate = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("§7.1.3 フォームは明示指定がなければ傍受しない", () => {
  test("決済フォーム（属性なし）は傍受しない", () => {
    const f = form('<form action="/checkout/pay" method="post"></form>');
    expect(shouldInterceptForm(f)).toBe(false);
  });

  test("data-client-nav の部分木にあっても継承しない", () => {
    document.body.innerHTML =
      '<div data-client-nav><form action="/checkout/pay" method="post"></form></div>';
    expect(shouldInterceptForm(document.querySelector("form")!)).toBe(false);
  });

  test("data-partial があれば傍受する", () => {
    expect(
      shouldInterceptForm(
        form('<form action="/search" method="get" data-partial="results"></form>'),
      ),
    ).toBe(true);
  });

  test("data-fragment があれば傍受する", () => {
    expect(
      shouldInterceptForm(
        form('<form action="/cart/add" method="post" data-fragment="/_f/cart-badge"></form>'),
      ),
    ).toBe(true);
  });
});

describe("§7.2.4 フォーム送信の処理順序", () => {
  test("POST は body で送り、snapshot をマージし、URL を変えない", async () => {
    const base = clientStore<{ version: number; count: number }>("cart", { version: 41, count: 3 });
    const fetchMock = mockFetch(() =>
      htmlResponse(
        '<script type="application/json" data-store="cart">{"version":42,"count":4}</script>',
      ),
    );
    const f = form(
      '<form action="/cart/add" method="post"><input name="sku" value="ABC-123"></form>',
    );
    f.setAttribute("data-partial", "");

    await handleSubmit(submitEvent(), f);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(urlOf(url)).toContain("/cart/add");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(URLSearchParams);
    expect(base.value.count).toBe(4);
    // POST の送信先を履歴に積むと戻るボタンで再送信になる
    expect(location.pathname).toBe("/products");
  });

  test("snapshot のマージが Fragment の取り直しより先（§7.2.4 の 4）", async () => {
    const base = clientStore<{ version: number; count: number }>("cart", { version: 41, count: 3 });
    const order: string[] = [];
    const fetchMock = mockFetch((url) => {
      if (url.includes("/_f/cart-badge")) {
        order.push(`fragment:${base.value.count}`);
        return htmlResponse("<span>4</span>");
      }
      order.push("post");
      return htmlResponse(
        '<script type="application/json" data-store="cart">{"version":42,"count":4}</script>',
      );
    });
    registerIslands({ CartBadge: () => null });
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div data-island="CartBadge" data-fragment="/_f/cart-badge"><span>3</span></div>',
    );
    const f = form('<form action="/cart/add" method="post" data-fragment="/_f/cart-badge"></form>');

    await handleSubmit(submitEvent(), f);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Fragment を取りに行く時点で base は既に新しい確定値
    expect(order).toEqual(["post", "fragment:4"]);
    expect(document.querySelector("[data-island] span")!.textContent).toBe("4");
  });

  test('method="get" かつ data-partial ならソフトナビゲーションに合流する（pushState する）', async () => {
    document.body.innerHTML = "<div data-client-nav><!--p:results-->a<!--/p:results--></div>";
    const fetchMock = mockFetch(() =>
      htmlResponse("<!--p:results-->b<!--/p:results-->", { "X-Partial": "results" }),
    );
    const f = form(
      '<form action="/search" method="get" data-partial="results"><input name="q" value="靴"></form>',
    );

    await handleSubmit(submitEvent(), f);

    expect(urlOf(fetchMock.mock.calls[0]![0])).toContain("/search?q=");
    expect(location.pathname + location.search).toBe(`/search?q=${encodeURIComponent("靴")}`);
    expect(document.body.textContent).toContain("b");
  });

  test("GET は同名フィールドの複数値と submitter を失わない", async () => {
    document.body.innerHTML = "<div data-client-nav><!--p:results-->a<!--/p:results--></div>";
    const fetchMock = mockFetch(() =>
      htmlResponse("<!--p:results-->b<!--/p:results-->", { "X-Partial": "results" }),
    );
    const f = form(
      '<form action="/search" method="get" data-partial="results">' +
        '<input name="tag" value="red"><input name="tag" value="sale">' +
        '<button name="intent" value="filter">Filter</button></form>',
    );
    const submitter = f.querySelector("button")!;
    await handleSubmit(
      new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter }),
      f,
    );

    const requested = new URL(urlOf(fetchMock.mock.calls[0]![0]));
    expect(requested.searchParams.getAll("tag")).toEqual(["red", "sale"]);
    expect(requested.searchParams.get("intent")).toBe("filter");
  });

  test.each([
    ["application/x-www-form-urlencoded", URLSearchParams],
    ["multipart/form-data", FormData],
  ])("POST enctype=%s を反映する", async (enctype, BodyType) => {
    const fetchMock = mockFetch(() => htmlResponse(""));
    const f = form(
      `<form action="/submit" method="post" enctype="${enctype}" data-partial=""><input name="x" value="1"></form>`,
    );
    await handleSubmit(submitEvent(), f);
    expect(fetchMock.mock.calls[0]![1]!.body).toBeInstanceOf(BodyType);
  });

  test("POST enctype=text/plain は plain text body と Content-Type を送る", async () => {
    const fetchMock = mockFetch(() => htmlResponse(""));
    const f = form(
      '<form action="/submit" method="post" enctype="text/plain" data-partial=""><input name="x" value="1"></form>',
    );
    await handleSubmit(submitEvent(), f);
    expect(fetchMock.mock.calls[0]![1]!.body).toBe("x=1\r\n");
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get("Content-Type")).toBe(
      "text/plain;charset=UTF-8",
    );
  });

  test("GET + data-fragment は query を送り Fragment を更新する", async () => {
    const fetchMock = mockFetch((url) =>
      url.includes("/_f/x") ? htmlResponse("<span>fresh</span>") : htmlResponse(""),
    );
    registerIslands({ X: () => null });
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div data-island="X" data-fragment="/_f/x"><span>old</span></div>',
    );
    const f = form(
      '<form action="/search" method="get" data-fragment="/_f/x"><input name="q" value="shoe"></form>',
    );
    await handleSubmit(submitEvent(), f);
    expect(urlOf(fetchMock.mock.calls[0]![0])).toContain("q=shoe");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("未知の method は preventDefault しない", async () => {
    const f = form('<form action="/x" method="dialog" data-partial="x"></form>');
    const event = submitEvent();
    await handleSubmit(event, f);
    expect(event.defaultPrevented).toBe(false);
  });

  test("malformed partial と header/body mismatch は native fallback する", async () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => undefined);
    const responses = [
      htmlResponse("<!--p:results-->broken", { "X-Partial": "results" }),
      htmlResponse("<!--p:results-->ok<!--/p:results-->", { "X-Partial": "other" }),
    ];
    const fetchMock = mockFetch(() => responses.shift()!);
    const f = form('<form action="/x" method="post" data-partial="results"></form>');
    await handleSubmit(submitEvent(), f);
    await handleSubmit(submitEvent(), f);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  test("document submit handler は FORM 以外と未指定 form を無視する", () => {
    expect(() => onDocumentSubmit(new Event("submit"))).not.toThrow();
    const f = form('<form action="/x"></form>');
    const event = new SubmitEvent("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: f });
    onDocumentSubmit(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("外部 action は傍受しない", () => {
    const f = form(
      '<form action="https://evil.example/collect" method="post" data-partial="results"></form>',
    );
    expect(shouldInterceptForm(f)).toBe(false);
  });

  test("manual redirect と HTML 以外の応答は native fallback する", async () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => undefined);
    mockFetch(() => new Response("", { status: 302, headers: { Location: "/login" } }));
    const f = form('<form action="/submit" method="post" data-partial="results"></form>');
    await handleSubmit(submitEvent(), f);
    expect(submit).toHaveBeenCalledWith();
  });

  test("data-partial があれば応答から領域を差し替える（POST では pushState しない）", async () => {
    document.body.innerHTML = "<div><!--p:cart-lines-->old<!--/p:cart-lines--></div>";
    mockFetch(() =>
      htmlResponse("<!--p:cart-lines-->new<!--/p:cart-lines-->", { "X-Partial": "cart-lines" }),
    );
    const f = form('<form action="/cart/update" method="post" data-partial="cart-lines"></form>');

    await handleSubmit(submitEvent(), f);
    expect(document.body.textContent).toContain("new");
    expect(location.pathname).toBe("/products");
  });

  test("data-fragment がカンマ区切りなら各 URL を独立に取り直す", async () => {
    const fetchMock = mockFetch(() => htmlResponse("<span>x</span>"));
    registerIslands({ A: () => null, B: () => null });
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div data-island="A" data-fragment="/_f/a"></div><div data-island="B" data-fragment="/_f/b"></div>',
    );
    const f = form('<form action="/cart/add" method="post" data-fragment="/_f/a,/_f/b"></form>');

    await handleSubmit(submitEvent(), f);
    const urls = fetchMock.mock.calls.map((c) => urlOf(c[0]));
    expect(urls.some((u) => u.includes("/_f/a"))).toBe(true);
    expect(urls.some((u) => u.includes("/_f/b"))).toBe(true);
  });

  test("失敗したらそのフォームを通常送信し直す（フォールバック）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("network"))),
    );
    const f = form('<form action="/cart/add" method="post" data-fragment="/_f/cart-badge"></form>');
    const nativeSubmit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => undefined);

    await handleSubmit(submitEvent(), f);
    expect(nativeSubmit).toHaveBeenCalled();
  });

  test("傍受したら preventDefault する", async () => {
    mockFetch(() => htmlResponse(""));
    const f = form('<form action="/cart/add" method="post" data-fragment="/_f/cart-badge"></form>');
    const event = submitEvent();
    await handleSubmit(event, f);
    expect(event.defaultPrevented).toBe(true);
  });
});
