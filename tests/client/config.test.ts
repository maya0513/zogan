import { afterEach, describe, expect, test, vi } from "vitest";
import { browser } from "../../src/client/browser";
import { getFragmentPrefix, setFragmentPrefix } from "../../src/client/config";
import { isManualRedirect, sameOriginUrl } from "../../src/client/protocol";

afterEach(() => vi.unstubAllGlobals());

describe("client configuration and browser boundary", () => {
  test("fragmentPrefix を正規化する", () => {
    setFragmentPrefix("/fragments");
    expect(getFragmentPrefix()).toBe("/fragments/");
    setFragmentPrefix("/_f/");
  });

  test.each(["relative", "//evil.example/x", "/x?query", "/x#hash", "/x\\y"])(
    "不正な fragmentPrefix を拒否する: %s",
    (prefix) => expect(() => setFragmentPrefix(prefix)).toThrow(),
  );

  test.each(["/./x", "/../x"])("dot segment を拒否する: %s", (prefix) => {
    expect(() => setFragmentPrefix(prefix)).toThrow(/dot/);
  });

  test("URL parse error と外部 origin を null に畳む", () => {
    expect(sameOriginUrl("http://[")).toBe(null);
    expect(sameOriginUrl("https://evil.example/x")).toBe(null);
    expect(sameOriginUrl("/same")).toBeInstanceOf(URL);
  });

  test("redirected flag も manual redirect として扱う", () => {
    const response = new Response("ok");
    Object.defineProperty(response, "redirected", { value: true });
    expect(isManualRedirect(response)).toBe(true);
  });

  test("hard navigation と reload を browser boundary から呼べる", () => {
    const assign = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal("location", { assign, reload });
    browser.hardNavigate("/next");
    browser.reload();
    expect(assign).toHaveBeenCalledWith("/next");
    expect(reload).toHaveBeenCalled();
  });
});
