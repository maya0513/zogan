import { describe, expect, test } from "vitest";
import { fragmentUrl, isHtmlContentType, isManualRedirect } from "../../src/client/protocol";

describe("client protocol guards", () => {
  test("accepts only explicit root-relative same-origin fragment paths", () => {
    expect(fragmentUrl("/fragments/cart?compact=1")?.href).toBe(
      new URL("/fragments/cart?compact=1", location.href).href,
    );

    for (const input of [
      "relative",
      "//evil.example/x",
      "/fragment#section",
      "/fragment#",
      "/back\\slash",
      "/encoded%5Cslash",
      "/a/%2e%2e/b",
      "/bad/%E0%A4%A",
      "/line\nbreak",
    ]) {
      expect(fragmentUrl(input)).toBeNull();
    }
  });

  test("recognizes HTML media types case-insensitively", () => {
    expect(isHtmlContentType(" Text/HTML ; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("application/json")).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
  });

  test("recognizes each browser representation of a manual redirect", () => {
    expect(isManualRedirect({ type: "opaqueredirect", redirected: false, status: 0 })).toBe(true);
    expect(isManualRedirect({ type: "basic", redirected: true, status: 200 })).toBe(true);
    expect(isManualRedirect({ type: "basic", redirected: false, status: 307 })).toBe(true);
    expect(isManualRedirect({ type: "basic", redirected: false, status: 200 })).toBe(false);
  });
});
