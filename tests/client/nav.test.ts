import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { browser } from "../../src/client/browser";
import {
  handleClick,
  navigate,
  onDocumentClick,
  resolveClientNav,
  shouldIntercept,
} from "../../src/client/nav";
import { navigating, pendingPartials } from "../../src/client/signals";
import { registerIslands, __resetIslands } from "../../src/client/islands";
import { __resetStores, clientStore } from "../../src/client/store";
import { urlOf } from "../helpers/url";

const partialResponse = (body: string, xPartial: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    ...init,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Partial": xPartial,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

const mockFetch = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(urlOf(input), init ?? {})),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
};

const setBody = (html: string) => {
  document.body.innerHTML = html;
};

const anchor = (html: string): HTMLAnchorElement => {
  document.body.insertAdjacentHTML("beforeend", html);
  return document.body.lastElementChild as HTMLAnchorElement;
};

const click = (el: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  el.dispatchEvent(event);
  return event;
};

let hardNavigate: (url: string) => void;

beforeEach(() => {
  __resetStores();
  __resetIslands();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/products");
  vi.stubGlobal("scrollTo", vi.fn());
  hardNavigate = vi.fn((_url: string) => {});
  browser.hardNavigate = hardNavigate;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("§7.1.1 data-client-nav の解決", () => {
  test("最も近い祖先が勝つ", () => {
    setBody(
      '<div data-client-nav="true"><section data-client-nav="false"><a id="a">x</a></section></div>',
    );
    expect(resolveClientNav(document.getElementById("a")!)).toBe(false);
  });

  test("空文字列は有効", () => {
    setBody('<div data-client-nav><a id="a">x</a></div>');
    expect(resolveClientNav(document.getElementById("a")!)).toBe(true);
  });

  test("属性が 1 つも無ければ無効（既定は傍受しない）", () => {
    setBody('<div><a id="a">x</a></div>');
    expect(resolveClientNav(document.getElementById("a")!)).toBe(false);
  });
});

describe("§7.1.2 傍受の条件", () => {
  beforeEach(() => setBody('<div id="root" data-client-nav></div>'));
  const root = () => document.getElementById("root")!;
  const link = (html: string) => {
    root().insertAdjacentHTML("beforeend", html);
    return root().lastElementChild as HTMLAnchorElement;
  };

  test("通常の同一オリジンリンクは傍受する", () => {
    const a = link('<a href="/products?color=red">絞り込む</a>');
    expect(shouldIntercept(new MouseEvent("click", { button: 0, cancelable: true }), a)).toBe(true);
  });

  test.each([
    ["修飾キー（meta）", '<a href="/x">x</a>', { metaKey: true }],
    ["修飾キー（ctrl）", '<a href="/x">x</a>', { ctrlKey: true }],
    ["中クリック", '<a href="/x">x</a>', { button: 1 }],
  ])("%s は傍受しない", (_label, html, init) => {
    const a = link(html);
    expect(shouldIntercept(new MouseEvent("click", { cancelable: true, ...init }), a)).toBe(false);
  });

  test.each([
    ["target", '<a href="/x" target="_blank">x</a>'],
    ["download", '<a href="/receipt.pdf" download>x</a>'],
    ["rel=external", '<a href="/x" rel="external">x</a>'],
    ["外部オリジン", '<a href="https://evil.example/x">x</a>'],
    ["mailto:", '<a href="mailto:a@example.com">x</a>'],
    ["同一文書内アンカー", '<a href="#reviews">x</a>'],
    ["href なし", "<a>x</a>"],
  ])("%s は傍受しない", (_label, html) => {
    const a = link(html);
    expect(shouldIntercept(new MouseEvent("click", { button: 0, cancelable: true }), a)).toBe(
      false,
    );
  });

  test('target="_self" は傍受する', () => {
    const a = link('<a href="/x" target="_self">x</a>');
    expect(shouldIntercept(new MouseEvent("click", { button: 0, cancelable: true }), a)).toBe(true);
  });

  test("別ページへのアンカー付きリンクは傍受する", () => {
    const a = link('<a href="/other#reviews">x</a>');
    expect(shouldIntercept(new MouseEvent("click", { button: 0, cancelable: true }), a)).toBe(true);
  });

  test("他のスクリプトが処理済み（defaultPrevented）なら傍受しない", () => {
    const a = link('<a href="/x">x</a>');
    const event = new MouseEvent("click", { button: 0, cancelable: true });
    event.preventDefault();
    expect(shouldIntercept(event, a)).toBe(false);
  });

  test("data-client-nav 無効の部分木では傍受しない", () => {
    setBody('<div><a id="off" href="/x">x</a></div>');
    const event = click(document.getElementById("off")!);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("§7.2 ソフトナビゲーションの処理順序", () => {
  const productsBody =
    '<div id="page" data-client-nav>' +
    "<!--p:count-->1,284 件<!--/p:count-->" +
    '<div id="grid"><!--p:results--><article>a</article><!--/p:results--></div>' +
    "</div>";

  test("既定では DOM にある全マーカーを要求する（§7.2.3）", async () => {
    setBody(productsBody);
    const fetchMock = mockFetch(() =>
      partialResponse("<!--p:count-->2 件<!--/p:count-->", "count"),
    );
    await navigate("/products?color=red");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ "X-Partial": "count,results" });
  });

  test("リンクの data-partial があればそれを使う", async () => {
    setBody(productsBody);
    const fetchMock = mockFetch(() =>
      partialResponse("<!--p:count-->2 件<!--/p:count-->", "count"),
    );
    await navigate("/products?color=red", { partials: ["count"] });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ "X-Partial": "count" });
  });

  test("fetch は redirect: manual（§8.4.3）", async () => {
    setBody(productsBody);
    const fetchMock = mockFetch(() => partialResponse("<!--p:count-->2<!--/p:count-->", "count"));
    await navigate("/products?color=red");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).redirect).toBe("manual");
  });

  test("プログラム呼び出しでも外部 URL は fetch せず通常遷移へ戻す", async () => {
    setBody(productsBody);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await navigate("https://evil.example/products");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hardNavigate).toHaveBeenCalledWith("https://evil.example/products");
  });

  test("マーカー範囲を差し替え、URL を pushState する", async () => {
    setBody(productsBody);
    mockFetch(() =>
      partialResponse(
        "<!--p:count-->842 件<!--/p:count--><!--p:results--><article>b</article><!--/p:results-->",
        "count,results",
      ),
    );
    await navigate("/products?color=red");
    expect(document.getElementById("grid")!.innerHTML).toBe(
      "<!--p:results--><article>b</article><!--/p:results-->",
    );
    expect(location.pathname + location.search).toBe("/products?color=red");
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  test("Store のマージが Island のハイドレートより先（§7.2.2）", async () => {
    setBody(productsBody);
    const base = clientStore<{ version: number; count: number }>("cart", { version: 41, count: 3 });
    const seen: number[] = [];
    registerIslands({
      CartBadge: () => {
        seen.push(base.value.count);
        return null;
      },
    });
    mockFetch(() =>
      partialResponse(
        '<!--p:count--><script type="application/json" data-store="cart">{"version":42,"count":4}</script>' +
          '<div data-island="CartBadge"></div><!--/p:count-->',
        "count",
      ),
    );
    await navigate("/products?color=red");
    expect(seen[0]).toBe(4);
  });

  test("navigating と pendingPartials が進行中だけ真になる", async () => {
    setBody(productsBody);
    const during: [boolean, string[]][] = [];
    mockFetch(() => {
      during.push([navigating.value, [...pendingPartials.value]]);
      return partialResponse("<!--p:count-->2<!--/p:count-->", "count");
    });
    expect(navigating.value).toBe(false);
    await navigate("/products?color=red", { partials: ["count"] });
    expect(during).toEqual([[true, ["count"]]]);
    expect(navigating.value).toBe(false);
    expect(pendingPartials.value).toEqual([]);
  });

  test("replace オプションなら pushState ではなく replaceState", async () => {
    setBody(productsBody);
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    mockFetch(() => partialResponse("<!--p:count-->2<!--/p:count-->", "count"));
    await navigate("/products?page=2", { replace: true });
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
  });
});

describe("§7.3.1 フォールバックの判定", () => {
  let untouched: string;
  beforeEach(() => {
    setBody("<div data-client-nav><!--p:results-->a<!--/p:results--></div>");
    untouched = document.body.innerHTML;
  });

  const expectFallback = async (res: Response | Promise<never>) => {
    mockFetch(() => res);
    await navigate("/products?color=red");
    expect(hardNavigate).toHaveBeenCalledWith("/products?color=red");
    // 壊れた画面を出さない
    expect(document.body.innerHTML).toBe(untouched);
  };

  test("1: fetch が reject（ネットワークエラー）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("network"))),
    );
    await navigate("/products?color=red");
    expect(hardNavigate).toHaveBeenCalled();
  });

  test("3: opaqueredirect は元 URL へフル遷移する（status は 0 で読めない）", async () => {
    const opaque = {
      type: "opaqueredirect",
      status: 0,
      ok: false,
      headers: new Headers(),
      text: () => Promise.resolve(""),
    } as unknown as Response;
    await expectFallback(opaque);
  });

  test("4: 2xx 以外", async () => {
    await expectFallback(new Response("err", { status: 500 }));
  });

  test("5: Content-Type が text/html でない", async () => {
    await expectFallback(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Partial": "results" },
      }),
    );
  });

  test("6: 応答ヘッダ X-Partial が無い（Partial 非対応の応答）", async () => {
    await expectFallback(
      new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );
  });

  test("7: X-Partial が空（返せる領域が無かった）", async () => {
    await expectFallback(partialResponse("", ""));
  });

  test("8: 返された領域が現在の DOM に 1 つも無い", async () => {
    await expectFallback(partialResponse("<!--p:other-->x<!--/p:other-->", "other"));
  });

  test("9: 一部だけ DOM にある場合はフォールバックしない", async () => {
    mockFetch(() =>
      partialResponse(
        "<!--p:results-->new<!--/p:results--><!--p:other-->x<!--/p:other-->",
        "results,other",
      ),
    );
    await navigate("/products?color=red");
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("new");
  });

  test("応答ヘッダと本文の Partial 名が一致しなければ DOM を触らない", async () => {
    await expectFallback(partialResponse("<!--p:results-->new<!--/p:results-->", "other"));
  });

  test("Content-Type の media type は大文字小文字を区別しない", async () => {
    mockFetch(() =>
      partialResponse("<!--p:results-->new<!--/p:results-->", "results", {
        headers: { "Content-Type": "TEXT/HTML; Charset=UTF-8", "X-Partial": "results" },
      }),
    );
    await navigate("/products?color=red");
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("new");
  });

  test("2: AbortError ではフォールバックしない（新しいナビゲーションが進行中）", async () => {
    let resolveFirst: ((res: Response) => void) | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((resolve, reject) => {
          resolveFirst = resolve;
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(partialResponse("<!--p:results-->2 回目<!--/p:results-->", "results"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = navigate("/products?page=1");
    const second = navigate("/products?page=2");
    await Promise.all([first, second]);

    expect(hardNavigate).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("2 回目");
    expect(resolveFirst).toBeDefined();
  });
});

describe("§7.3.2 連打・競合", () => {
  test("5 回連続で切り替えても最後の結果だけが適用される（§10 の 4）", async () => {
    setBody("<div data-client-nav><!--p:results-->0<!--/p:results--></div>");
    const controllers: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const n = Number(new URL(url, location.href).searchParams.get("n"));
        controllers.push(init!.signal!);
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          // 遅い応答ほど先に返る（到着順は要求順と一致しない）
          setTimeout(
            () => resolve(partialResponse(`<!--p:results-->${n}<!--/p:results-->`, "results")),
            n === 5 ? 5 : 30,
          );
        });
      }),
    );

    const runs = [1, 2, 3, 4, 5].map((n) => navigate(`/products?n=${n}`));
    await Promise.all(runs);
    expect(document.body.textContent).toBe("5");
    expect(controllers.slice(0, 4).every((s) => s.aborted)).toBe(true);
  });
});

describe("§7.1.2 クリック傍受の統合", () => {
  test("傍受したら preventDefault してソフトナビゲーションに入る", async () => {
    setBody("<div data-client-nav><!--p:results-->a<!--/p:results--></div>");
    const a = anchor('<a href="/products?color=red" data-client-nav>絞り込む</a>');
    const fetchMock = mockFetch(() =>
      partialResponse("<!--p:results-->b<!--/p:results-->", "results"),
    );
    document.addEventListener("click", onDocumentClick as EventListener);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(event);
    document.removeEventListener("click", onDocumentClick as EventListener);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(event.defaultPrevented).toBe(true);
  });

  test("data-partial を持つリンクはその領域だけを要求する", async () => {
    setBody(
      '<div id="w" data-client-nav><!--p:results-->a<!--/p:results--><!--p:count-->1<!--/p:count--></div>',
    );
    const a = anchor('<a href="/products?page=2" data-partial="results" data-client-nav>次へ</a>');
    const fetchMock = mockFetch(() =>
      partialResponse("<!--p:results-->b<!--/p:results-->", "results"),
    );
    handleClick(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }), a);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      "X-Partial": "results",
    });
  });
});
