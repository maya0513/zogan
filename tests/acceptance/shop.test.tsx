import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  __resetFragments,
  startFragments,
  type FragmentClientRuntime,
} from "../../src/client/fragments";
import { __resetIslands } from "../../src/client/islands";
import { createShop, type Shop } from "../fixtures/shop";
import { urlOf } from "../helpers/url";

let shop: Shop;
let cookie: string;
let fragmentRuntime: FragmentClientRuntime | undefined;

const wireFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(urlOf(input), location.href);
    const headers = new Headers(init.headers);
    headers.set("Cookie", cookie);
    return shop.app.request(`${url.pathname}${url.search}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined || init.body === null ? {} : { body: init.body }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const load = async (path: string): Promise<Response> => {
  const response = await shop.app.request(path, { headers: { Cookie: cookie } });
  const html = await response.text();
  document.documentElement.innerHTML = html
    .replace(/^<!DOCTYPE html>/u, "")
    .replace(/^<html[^>]*>/u, "")
    .replace(/<\/html>$/u, "");
  history.replaceState(null, "", path);
  return new Response(html, response);
};

beforeEach(() => {
  shop = createShop();
  cookie = "u=alice";
  __resetFragments();
  __resetIslands();
  document.body.replaceChildren();
});

afterEach(() => {
  fragmentRuntime?.dispose();
  fragmentRuntime = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("one URL, one representation", () => {
  test("X-Partial cannot turn a page into a fragment", async () => {
    const normal = await shop.app.request("/products");
    const attemptedPartial = await shop.app.request("/products", {
      headers: { "X-Partial": "results" },
    });
    expect(await attemptedPartial.text()).toBe(await normal.text());
    expect(attemptedPartial.headers.get("X-Partial")).toBeNull();
    expect(attemptedPartial.headers.get("Vary")).toBeNull();
  });

  test("public shell contains no user state; private fragment carries only that user", async () => {
    shop.setCart("alice", { version: 1, count: 3 });
    shop.setCart("bob", { version: 2, count: 7 });

    const shell = await shop.app.request("/products", { headers: { Cookie: "u=alice" } });
    const shellBody = await shell.text();
    expect(shell.headers.get("Cache-Control")).toContain("s-maxage=60");
    expect(shellBody).not.toContain("data-store");
    expect(shellBody).not.toContain("カート 3");

    const fragment = await shop.app.request("/fragments/cart-badge", {
      headers: { Cookie: "u=bob" },
    });
    expect(fragment.headers.get("Cache-Control")).toBe("private, no-store");
    expect(fragment.headers.get("Vary")).toBe("Cookie");
    expect(await fragment.text()).toContain("カート 7");
  });
});

describe("local enhancement boundaries", () => {
  test("start loads explicit fragments without intercepting document navigation", async () => {
    shop.setCart("alice", { version: 1, count: 3 });
    await load("/products");
    const fetchMock = wireFetch();
    const documentListeners = vi.spyOn(document, "addEventListener");
    const windowListeners = vi.spyOn(window, "addEventListener");

    fragmentRuntime = startFragments();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-cart-count]")?.textContent).toBe("カート 3"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(documentListeners.mock.calls.map(([name]) => name)).not.toContain("click");
    expect(documentListeners.mock.calls.map(([name]) => name)).not.toContain("submit");
    expect(windowListeners.mock.calls.map(([name]) => name)).not.toContain("popstate");
  });

  test("fresh fragment HTML remains a read-only HTML include", async () => {
    shop.setInventory(9);
    await load("/products/ABC-1");
    wireFetch();

    fragmentRuntime = startFragments();
    await vi.waitFor(() => expect(document.body.textContent).toContain("9 available"));
    expect(document.querySelector("[data-zogan-island]")).toBeNull();
    expect(document.body.textContent).not.toContain("Stock unavailable");
  });
});

describe("native correctness", () => {
  test("forms remain native and canonical POST uses PRG", async () => {
    await load("/products");
    const fetchMock = wireFetch();
    fragmentRuntime = startFragments();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const form = document.querySelector<HTMLFormElement>('form[action="/cart/add"]');
    expect(form).not.toBeNull();
    const event = new SubmitEvent("submit", { bubbles: true, cancelable: true });
    form?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();

    const response = await shop.app.request("/cart/add", {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie },
      body: new URLSearchParams({ sku: "ABC-1" }),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/cart");
  });

  test("parallel private fragments never mix users", async () => {
    shop.setCart("alice", { version: 1, count: 3 });
    shop.setCart("bob", { version: 1, count: 7 });
    const responses = await Promise.all(
      Array.from({ length: 200 }, async (_, index) => {
        const user = index % 2 === 0 ? "alice" : "bob";
        const response = await shop.app.request("/fragments/cart-badge", {
          headers: { Cookie: `u=${user}` },
        });
        return { body: await response.text(), user };
      }),
    );
    for (const { body, user } of responses) {
      expect(body).toContain(user === "alice" ? "カート 3" : "カート 7");
    }
  });

  test("SSR alone contains usable links, forms, and meaningful fragment fallbacks", async () => {
    const response = await shop.app.request("/products");
    const html = await response.text();
    expect(html).toContain('<a href="/products/ABC-1">');
    expect(html).toContain('<form action="/cart/add" method="post">');
    expect(html).toContain('<a href="/cart">カート —</a>');
  });
});
