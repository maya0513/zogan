import { describe, expect, test } from "vitest";
import {
  appendVary,
  cacheControlDirectives,
  containsStoreSnapshot,
  hasCacheControlDirective,
  isCacheableBySharedCache,
  isHtmlContentType,
  withHeader,
} from "../../src/server/cache";

describe("HTTP cache directive parser", () => {
  test("directive 名を正確な token として解析する", () => {
    expect([...cacheControlDirectives(null)]).toEqual([]);
    expect([...cacheControlDirectives('public, Foo="a,b", no-store, , MAX-AGE=10')]).toEqual([
      "public",
      "foo",
      "no-store",
      "max-age",
    ]);
    expect(hasCacheControlDirective("NO-STORE", "no-store")).toBe(true);
    expect(hasCacheControlDirective("no-storehouse", "no-store")).toBe(false);
  });

  test("共有 cache 可否は no-store/private の exact directive で決まる", () => {
    expect(isCacheableBySharedCache(null)).toBe(true);
    expect(isCacheableBySharedCache("public, max-age=60")).toBe(true);
    expect(isCacheableBySharedCache("no-store")).toBe(false);
    expect(isCacheableBySharedCache("private")).toBe(false);
  });

  test("HTML media type を case-insensitive に判定する", () => {
    expect(isHtmlContentType("TEXT/HTML; Charset=UTF-8")).toBe(true);
    expect(isHtmlContentType("application/xhtml+xml")).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
  });
});

describe("snapshot and response header helpers", () => {
  test("snapshot script だけを検出する", () => {
    expect(containsStoreSnapshot("<p>x</p>")).toBe(false);
    expect(containsStoreSnapshot("<script>data-store</script>")).toBe(false);
    expect(containsStoreSnapshot('<script data-store="x" type="text/plain"></script>')).toBe(false);
    expect(
      containsStoreSnapshot('<SCRIPT DATA-STORE="x" TYPE="application/json">{}</SCRIPT>'),
    ).toBe(true);
  });

  test("Vary を重複させず追加する", () => {
    expect(appendVary(null, "X-Partial")).toBe("X-Partial");
    expect(appendVary(" Cookie, x-partial ", "X-Partial")).toBe("Cookie, x-partial");
  });

  test("immutable response headers は Response を作り直して更新する", () => {
    const response = Response.redirect("https://example.com/next", 302);
    const updated = withHeader(response, "Cache-Control", "no-store");
    expect(updated.status).toBe(302);
    expect(updated.headers.get("Cache-Control")).toBe("no-store");
  });
});
