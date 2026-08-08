import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { h } from "preact";
import { browser } from "../../src/client/browser";
import { __resetFragments } from "../../src/client/fragments";
import { __resetIslands } from "../../src/client/islands";
import { start, __resetStart } from "../../src/client/start";
import { __resetStores, clientStore } from "../../src/client/store";
import { savePreserved, restorePreserved } from "../../src/client/preserve";
import { parseHTMLFragment } from "../../src/client/dom";
import { focusAndScroll } from "../../src/client/nav";

const htmlResponse = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });

beforeEach(() => {
  __resetStores();
  __resetIslands();
  __resetFragments();
  __resetStart();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/products");
  vi.stubGlobal("scrollTo", vi.fn());
  browser.hardNavigate = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("付録 A.2.1 start()", () => {
  test("文書全体の snapshot を先にマージしてから Island をハイドレートする", async () => {
    document.body.innerHTML =
      '<script type="application/json" data-store="cart">{"version":41,"count":3}</script>' +
      '<div data-island="CartBadge"><span>—</span></div>';
    const base = clientStore<{ version: number; count: number }>("cart", { version: 0, count: 0 });
    const seen: number[] = [];

    start({
      islands: {
        CartBadge: () => {
          seen.push(base.value.count);
          return null;
        },
      },
    });

    await vi.waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0]).toBe(3);
  });

  test("クリックのリスナを登録する", async () => {
    document.body.innerHTML =
      "<div data-client-nav><!--p:results-->a<!--/p:results-->" +
      '<a id="l" href="/products?color=red">絞り込む</a></div>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        htmlResponse("<!--p:results-->b<!--/p:results-->", { "X-Partial": "results" }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    start({ islands: {} });
    document
      .getElementById("l")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await vi.waitFor(() => expect(document.body.textContent).toContain("b"));
  });

  test("2 回呼んでも 2 度目は無視する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    start({ islands: {} });
    start({ islands: {} });
    expect(warn).toHaveBeenCalled();
  });

  test("BFCache 復帰時に指定された Fragment を 1 回だけ取り直す（§8.3.2）", async () => {
    document.body.innerHTML = '<div data-island="CartBadge" data-fragment="/_f/cart-badge"></div>';
    const fetchMock = vi.fn(() => Promise.resolve(htmlResponse("<span>9</span>")));
    vi.stubGlobal("fetch", fetchMock);

    start({
      islands: { CartBadge: () => h("span", null, "9") },
      refreshOnRestore: ["/_f/cart-badge"],
    });
    // load trigger の初回取得ぶんを数えてから比べる
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(document.querySelector("[data-island]")?.textContent).toBe("9"));

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  test("fragmentPrefix を設定し popstate では履歴を追加しない", async () => {
    document.body.innerHTML = "<!--p:results-->a<!--/p:results-->";
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        htmlResponse("<!--p:results-->b<!--/p:results-->", { "X-Partial": "results" }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const push = vi.spyOn(history, "pushState");
    start({ islands: {}, fragmentPrefix: "/fragments" });
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(document.body.textContent).toBe("b"));
    expect(push).not.toHaveBeenCalled();
  });
});

describe("§7.3.4 preserve", () => {
  test("同じ ID の要素は古い DOM ノードのまま移送される", () => {
    document.body.innerHTML =
      '<div id="host"><div data-preserve="player-1"><video id="v"></video></div></div>';
    const host = document.getElementById("host")!;
    const video = document.getElementById("v")!;
    const old = [...host.childNodes];

    const saved = savePreserved(old);
    host.innerHTML = "";
    const fresh = parseHTMLFragment('<div data-preserve="player-1"><video></video></div>');
    for (const node of fresh) host.appendChild(node);
    restorePreserved(fresh, saved);

    // 新しい要素ではなく、退避しておいた古いノードそのものが入っている
    expect(document.getElementById("v")).toBe(video);
  });

  test("新 DOM に対応が無い要素は破棄される", () => {
    document.body.innerHTML = '<div id="host"><div data-preserve="gone"><b>x</b></div></div>';
    const host = document.getElementById("host")!;
    const saved = savePreserved([...host.childNodes]);
    host.innerHTML = "";
    const fresh = parseHTMLFragment("<p>new</p>");
    for (const node of fresh) host.appendChild(node);
    restorePreserved(fresh, saved);

    expect(host.innerHTML).toBe("<p>new</p>");
  });

  test("空 id と重複 id は無視し警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML =
      '<div data-preserve=""></div><div data-preserve="same"></div><div data-preserve="same"></div>';
    const saved = savePreserved([...document.body.childNodes]);
    expect(saved.size).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});

describe("§7.3.3 focus とスクロール", () => {
  test("replace では先頭のフォーカス可能要素へ移し、スクロールは先頭へ", () => {
    document.body.innerHTML = '<div><a id="first" href="/x">x</a></div>';
    const nodes = [document.getElementById("first")!];
    const focus = vi.spyOn(nodes[0]!, "focus");

    focusAndScroll(nodes, "");

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  test('フォーカス可能な要素が無ければ tabindex="-1" を付けて focus する', () => {
    document.body.innerHTML = '<div id="r"><p>text</p></div>';
    const nodes = [document.getElementById("r")!];
    focusAndScroll(nodes, "");
    expect(document.getElementById("r")!.getAttribute("tabindex")).toBe("-1");
  });

  test("append / prepend では focus もスクロールも動かさない", () => {
    focusAndScroll(null, "");
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  test("アンカー付きならその要素へスクロールする", () => {
    document.body.innerHTML = '<div id="r"><p>x</p></div><section id="reviews"></section>';
    const target = document.getElementById("reviews")!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "scrollIntoView", { value: scrollIntoView });

    focusAndScroll([document.getElementById("r")!], "#reviews");
    expect(scrollIntoView).toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  test("CSS selector として特殊な id のアンカーも安全に扱う", () => {
    document.body.innerHTML = '<div id="r">x</div><section id="price:usd"></section>';
    const target = document.getElementById("price:usd")!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "scrollIntoView", { value: scrollIntoView });

    expect(() => focusAndScroll([document.getElementById("r")!], "#price%3Ausd")).not.toThrow();
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
