import { computed, useSignal } from "@preact/signals";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseHTMLFragment } from "../../src/client/dom";
import { disposeIslandsIn, hydrateIslands, registerIslands } from "../../src/client/islands";
import { __resetStores, clientStore } from "../../src/client/store";
import { __resetFragments } from "../../src/client/fragments";
import { urlOf } from "../helpers/url";

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  disconnected = false;
  targets: Element[] = [];
  constructor(
    private callback: (entries: { isIntersecting: boolean; target: Element }[]) => void,
    readonly options?: { rootMargin?: string },
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve(el: Element) {
    this.targets = this.targets.filter((t) => t !== el);
  }
  enter() {
    this.callback(this.targets.map((target) => ({ isIntersecting: true, target })));
  }
}

const setBody = (html: string) => {
  document.body.innerHTML = html;
  return [...document.body.childNodes];
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __resetStores();
  __resetFragments();
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("§6.1.3 ハイドレートの手順", () => {
  test("load trigger は走査した時点でハイドレートする", async () => {
    const Counter = ({ label }: { label: string }) => <button>{label}</button>;
    registerIslands({ Counter });
    const nodes = setBody(
      '<div data-island="Counter" data-props=\'{"label":"押す"}\'><button>押す</button></div>',
    );

    hydrateIslands(nodes);
    await flush();
    expect(document.querySelector("button")!.textContent).toBe("押す");
  });

  test("対話できるようになる（SSR 済みの DOM を再利用する）", async () => {
    const Toggle = () => {
      // 消えてよい状態は useSignal（§6.2.1）
      const open = useSignal(false);
      return <button onClick={() => (open.value = !open.value)}>{open.value ? "閉" : "開"}</button>;
    };
    registerIslands({ Toggle });
    hydrateIslands(setBody('<div data-island="Toggle"><button>開</button></div>'));
    await flush();

    document.querySelector("button")!.click();
    await flush();
    expect(document.querySelector("button")!.textContent).toBe("閉");
  });

  test("未登録のコンポーネントは警告して継続。SSR 済みの中身は残る", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    hydrateIslands(setBody('<div data-island="Nope"><span>SSR</span></div>'));
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("SSR");
    expect(warn).toHaveBeenCalled();
  });

  test("data-props が壊れていても落ちない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const View = (props: { label?: string }) => <span>{props.label ?? "なし"}</span>;
    registerIslands({ View });
    hydrateIslands(setBody('<div data-island="View" data-props="{oops"><span>SSR</span></div>'));
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("なし");
    expect(warn).toHaveBeenCalled();
  });

  test("2 回走査してもハイドレートは 1 回だけ", async () => {
    let renders = 0;
    const Once = () => {
      renders += 1;
      return <span>x</span>;
    };
    registerIslands({ Once });
    const nodes = setBody('<div data-island="Once"><span>x</span></div>');
    hydrateIslands(nodes);
    hydrateIslands(nodes);
    await flush();
    expect(renders).toBe(1);
  });

  test("走査対象は渡された範囲のみ。ページ全体を毎回走査しない", async () => {
    let renders = 0;
    const Only = () => {
      renders += 1;
      return <span>x</span>;
    };
    registerIslands({ Only });
    setBody('<div data-island="Only"><span>x</span></div>');
    hydrateIslands(parseHTMLFragment("<p>無関係</p>"));
    await flush();
    expect(renders).toBe(0);
  });
});

describe("§6.1.2 trigger", () => {
  test("visible は IntersectionObserver、既定の rootMargin は 200px", async () => {
    const V = () => <span>hydrated</span>;
    registerIslands({ V });
    hydrateIslands(setBody('<div data-island="V" data-trigger="visible"><span>ssr</span></div>'));
    await flush();

    const io = FakeIntersectionObserver.instances[0]!;
    expect(io.options?.rootMargin).toBe("200px");
    expect(document.querySelector("span")!.textContent).toBe("ssr");

    io.enter();
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("hydrated");
  });

  test("idle は requestIdleCallback が無ければ setTimeout にフォールバックする", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const I = () => <span>hydrated</span>;
    registerIslands({ I });
    hydrateIslands(setBody('<div data-island="I" data-trigger="idle"><span>ssr</span></div>'));
    expect(document.querySelector("span")!.textContent).toBe("ssr");
    await new Promise((r) => setTimeout(r, 5));
    expect(document.querySelector("span")!.textContent).toBe("hydrated");
  });

  test("idle は requestIdleCallback があれば利用し dispose で cancel する", () => {
    const run = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", run);
    vi.stubGlobal("cancelIdleCallback", cancel);
    registerIslands({ I: () => <span>x</span> });
    const nodes = setBody('<div data-island="I" data-trigger="idle"><span>ssr</span></div>');
    hydrateIslands(nodes);
    disposeIslandsIn(nodes);
    expect(run).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  test("none は発火しない", async () => {
    const N = () => <span>hydrated</span>;
    registerIslands({ N });
    hydrateIslands(setBody('<div data-island="N" data-trigger="none"><span>ssr</span></div>'));
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("ssr");
  });

  test("media: はメディアクエリが真になったら発火する", async () => {
    const listeners: ((e: { matches: boolean }) => void)[] = [];
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      matches: false,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
      removeEventListener: () => {},
    }));
    const M = () => <span>hydrated</span>;
    registerIslands({ M });
    hydrateIslands(
      setBody(
        '<div data-island="M" data-trigger="media:(min-width: 768px)"><span>ssr</span></div>',
      ),
    );
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("ssr");

    listeners[0]!({ matches: true });
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("hydrated");
  });

  test("media: が最初から一致すれば直ちに hydrate する", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    registerIslands({ M: () => <span>hydrated</span> });
    hydrateIslands(setBody('<div data-island="M" data-trigger="media:any"><span>ssr</span></div>'));
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("hydrated");
  });

  test("未知 trigger は警告して hydrate しない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerIslands({ U: () => <span>hydrated</span> });
    hydrateIslands(setBody('<div data-island="U" data-trigger="later"><span>ssr</span></div>'));
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("ssr");
    expect(warn).toHaveBeenCalled();
  });
});

describe("§6.1.3 古い Island の後始末", () => {
  test("差し替えで消える Island の IntersectionObserver を解除する", async () => {
    const V = () => <span>x</span>;
    registerIslands({ V });
    const nodes = setBody('<div data-island="V" data-trigger="visible"><span>x</span></div>');
    hydrateIslands(nodes);
    await flush();

    expect(FakeIntersectionObserver.instances[0]!.disconnected).toBe(false);
    disposeIslandsIn(nodes);
    expect(FakeIntersectionObserver.instances[0]!.disconnected).toBe(true);
  });

  test("hydrate 済み Island は Preact tree を dispose する", async () => {
    registerIslands({ V: () => <span>x</span> });
    const nodes = setBody('<div data-island="V"><span>x</span></div>');
    hydrateIslands(nodes);
    await flush();
    disposeIslandsIn(nodes);
    expect((nodes[0] as Element).childNodes).toHaveLength(0);
  });
});

describe("§6.1.5 Fragment を取得する Island", () => {
  const fragmentHtml =
    '<script type="application/json" data-store="cart">{"version":41,"count":3}</script><span>3</span>';

  const mockFetch = (impl: (url: string) => Promise<Response> | Response) => {
    const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      return Promise.resolve(impl(urlOf(input)));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  };

  const htmlResponse = (body: string) =>
    new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

  test("trigger 発火時に 1 回だけ取得し、中身を丸ごと置換する", async () => {
    const fetchMock = mockFetch(() => htmlResponse(fragmentHtml));
    const CartBadge = () => <span>x</span>;
    registerIslands({ CartBadge });
    hydrateIslands(
      setBody(
        '<div data-island="CartBadge" data-fragment="/_f/cart-badge" data-trigger="load"><span>—</span></div>',
      ),
    );
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe("same-origin");
    expect(init?.redirect).toBe("manual");
  });

  test("同じ Fragment を使う複数 Island は取得を 1 リクエストへ集約する", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const CartBadge = () => <span>7</span>;
    registerIslands({ CartBadge });
    hydrateIslands(
      setBody(
        '<div id="first" data-island="CartBadge" data-fragment="/_f/cart-badge"><span>—</span></div>' +
          '<div id="second" data-island="CartBadge" data-fragment="/_f/cart-badge"><span>—</span></div>',
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse?.(htmlResponse("<span>7</span>"));
    await flush();
    expect(document.getElementById("first")!.textContent).toBe("7");
    expect(document.getElementById("second")!.textContent).toBe("7");
  });

  test("取得中に削除された Island へ遅延応答を反映・hydrate しない", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );
    let renders = 0;
    registerIslands({
      Late: () => {
        renders += 1;
        return <span>hydrated</span>;
      },
    });
    const nodes = setBody(
      '<div data-island="Late" data-fragment="/_f/late"><span>ssr</span></div>',
    );
    hydrateIslands(nodes);
    disposeIslandsIn(nodes);
    document.body.replaceChildren();

    resolveResponse?.(htmlResponse("<span>late</span>"));
    await flush();
    expect(renders).toBe(0);
  });

  test("snapshot のマージが hydrate より先（§7.2.2）", async () => {
    mockFetch(() => htmlResponse(fragmentHtml));
    const base = clientStore<{ version: number; count: number }>("cart", { version: 0, count: 0 });
    const seen: number[] = [];
    const CartBadge = () => {
      seen.push(base.value.count);
      return <span>{base.value.count}</span>;
    };
    registerIslands({ CartBadge });
    hydrateIslands(
      setBody(
        '<div data-island="CartBadge" data-fragment="/_f/cart-badge" data-trigger="load"><span>—</span></div>',
      ),
    );
    await flush();

    // 最初の描画から確定値を読んでいること。0 を挟んだら「3 が一瞬 0 になる」
    expect(seen[0]).toBe(3);
    expect(document.querySelector("span")!.textContent).toBe("3");
  });

  test("取得に失敗したら警告して SSR 済みの中身を残す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch(() => new Response("boom", { status: 500 }));
    const CartBadge = () => <span>—</span>;
    registerIslands({ CartBadge });
    hydrateIslands(
      setBody(
        '<div data-island="CartBadge" data-fragment="/_f/cart-badge" data-trigger="load"><span>—</span></div>',
      ),
    );
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("—");
    expect(warn).toHaveBeenCalled();
  });

  test("fragmentPrefix 配下でない URL は拒否する（§10 の 15）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = mockFetch(() => htmlResponse(fragmentHtml));
    const X = () => <span>x</span>;
    registerIslands({ X });
    hydrateIslands(
      setBody(
        '<div data-island="X" data-fragment="/api/cart" data-trigger="load"><span>x</span></div>',
      ),
    );
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test("外部オリジンの URL は拒否する", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = mockFetch(() => htmlResponse(fragmentHtml));
    const X = () => <span>x</span>;
    registerIslands({ X });
    hydrateIslands(
      setBody(
        '<div data-island="X" data-fragment="https://evil.example/_f/cart-badge" data-trigger="load"><span>x</span></div>',
      ),
    );
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("prefix の類似文字列は拒否する", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = mockFetch(() => htmlResponse(fragmentHtml));
    registerIslands({ X: () => <span>x</span> });
    hydrateIslands(setBody('<div data-island="X" data-fragment="/_f_evil/x"><span>x</span></div>'));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ["redirect", new Response("", { status: 302, headers: { Location: "/login" } })],
    [
      "non-html",
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    ],
  ])("%s 応答は DOM へ反映しない", async (_label, response) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch(() => response);
    registerIslands({ X: () => <span>ssr</span> });
    hydrateIslands(setBody('<div data-island="X" data-fragment="/_f/x"><span>ssr</span></div>'));
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("ssr");
  });

  test("network error は null に畳んで現在の DOM を残す", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    registerIslands({ X: () => <span>ssr</span> });
    hydrateIslands(setBody('<div data-island="X" data-fragment="/_f/x"><span>ssr</span></div>'));
    await flush();
    expect(document.querySelector("span")!.textContent).toBe("ssr");
  });

  test("trigger が none なら取得しない", async () => {
    const fetchMock = mockFetch(() => htmlResponse(fragmentHtml));
    const X = () => <span>x</span>;
    registerIslands({ X });
    hydrateIslands(
      setBody(
        '<div data-island="X" data-fragment="/_f/x" data-trigger="none"><span>x</span></div>',
      ),
    );
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("§7.1.4 refreshFragment", () => {
  test("data-fragment が完全一致する Island を全部同じ応答で更新する", async () => {
    const { refreshFragment } = await import("../../src/client/fragments");
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("<span>7</span>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const CartBadge = () => <span>7</span>;
    registerIslands({ CartBadge });
    setBody(
      '<div id="a" data-island="CartBadge" data-fragment="/_f/cart-badge"><span>—</span></div>' +
        '<div id="b" data-island="CartBadge" data-fragment="/_f/cart-badge"><span>—</span></div>' +
        '<div id="c" data-island="CartBadge" data-fragment="/_f/other"><span>—</span></div>',
    );

    await refreshFragment("/_f/cart-badge");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.getElementById("a")!.textContent).toBe("7");
    expect(document.getElementById("b")!.textContent).toBe("7");
    expect(document.getElementById("c")!.textContent).toBe("—");
  });

  test("反映先が 1 つも無ければ警告のみ。例外にしない", async () => {
    const { refreshFragment } = await import("../../src/client/fragments");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshFragment("/_f/nowhere")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test("取得した snapshot を反映する", async () => {
    const { refreshFragment } = await import("../../src/client/fragments");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            '<script type="application/json" data-store="cart">{"version":42,"count":9}</script><span>9</span>',
            { status: 200, headers: { "Content-Type": "text/html" } },
          ),
        ),
      ),
    );
    const base = clientStore<{ version: number; count: number }>("cart", { version: 41, count: 3 });
    const cart = computed(() => base.value.count);
    const CartBadge = () => <span>{base.value.count}</span>;
    registerIslands({ CartBadge });
    setBody('<div data-island="CartBadge" data-fragment="/_f/cart-badge"><span>3</span></div>');

    await refreshFragment("/_f/cart-badge");
    await flush();
    expect(cart.value).toBe(9);
  });

  test("取得失敗なら対象を変更しない", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("no", { status: 500 }))),
    );
    setBody('<div data-island="X" data-fragment="/_f/x"><span>old</span></div>');
    const { refreshFragment } = await import("../../src/client/fragments");
    await refreshFragment("/_f/x");
    expect(document.querySelector("span")!.textContent).toBe("old");
  });

  test("取得中に対象が DOM から消えた場合は反映しない", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );
    setBody('<div id="gone" data-island="X" data-fragment="/_f/x"><span>old</span></div>');
    const { refreshFragment } = await import("../../src/client/fragments");
    const refreshing = refreshFragment("/_f/x");
    document.getElementById("gone")!.remove();
    resolveResponse?.(
      new Response("<span>new</span>", { headers: { "Content-Type": "text/html" } }),
    );
    await refreshing;
    expect(document.getElementById("gone")).toBe(null);
  });

  test("reset された古い in-flight 完了は新しい coordinator 状態を消さない", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );
    const { fetchFragment } = await import("../../src/client/fragments");
    const pending = fetchFragment("/_f/x");
    __resetFragments();
    resolveResponse?.(new Response("<span>x</span>", { headers: { "Content-Type": "text/html" } }));
    await expect(pending).resolves.toBe("<span>x</span>");
  });
});
