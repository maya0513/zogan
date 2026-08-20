import { describe, expect, expectTypeOf, test } from "vitest";
import { cachePolicy, privateNoStore, publicCache, type CachePolicy } from "../../src/server/index";
import { cachePolicyState, mergeVary } from "../../src/server/cache";

describe("CachePolicy", () => {
  test("public policy は安全な既定値と安定した directive 順を持つ", () => {
    expect(cachePolicyState(publicCache())).toEqual({
      value: "public, max-age=0",
      vary: [],
    });
    expect(
      cachePolicyState(
        publicCache({
          maxAge: 60,
          sMaxAge: 300,
          staleWhileRevalidate: 30,
          immutable: true,
          vary: ["Accept-Encoding", "Cookie"],
        }),
      ),
    ).toEqual({
      value: "public, max-age=60, s-maxage=300, stale-while-revalidate=30, immutable",
      vary: ["Accept-Encoding", "Cookie"],
    });
  });

  test("privateNoStore と raw escape hatch を opaque policy にする", () => {
    const privatePolicy = privateNoStore({ vary: ["Cookie"] });
    const rawPolicy = cachePolicy("private, max-age=17", { vary: ["Authorization"] });
    expectTypeOf(privatePolicy).toEqualTypeOf<CachePolicy>();
    expectTypeOf(rawPolicy).toEqualTypeOf<CachePolicy>();
    expect(cachePolicyState(privatePolicy)).toEqual({
      value: "private, no-store",
      vary: ["Cookie"],
    });
    expect(cachePolicyState(rawPolicy)).toEqual({
      value: "private, max-age=17",
      vary: ["Authorization"],
    });
  });

  test.each([
    [{ maxAge: -1 }, "maxAge"],
    [{ maxAge: 1.5 }, "maxAge"],
    [{ maxAge: Number.NaN }, "maxAge"],
    [{ maxAge: Number.POSITIVE_INFINITY }, "maxAge"],
    [{ sMaxAge: -1 }, "sMaxAge"],
    [{ staleWhileRevalidate: -1 }, "staleWhileRevalidate"],
  ] as const)("duration を非負有限整数に限定する: %o", (options, field) => {
    expect(() => publicCache(options)).toThrow(field);
  });

  test("raw policy の空値と header injection を拒否する", () => {
    expect(() => cachePolicy("")).toThrow(/empty/i);
    expect(() => cachePolicy("   ")).toThrow(/empty/i);
    expect(() => cachePolicy("public\r\nX-Evil: yes")).toThrow(/CR|LF|line/i);
  });

  test.each(["public\0", "public\u0001", "public\u007F", "public😀"])(
    "raw policy の不正な HTTP field-value 文字を拒否する: %j",
    (value) => expect(() => cachePolicy(value)).toThrow(/field value/i),
  );

  test("raw policy は HTAB、visible ASCII、obs-text を許可する", () => {
    expect(cachePolicyState(cachePolicy("\tpublic, extension=é\t"))).toEqual({
      value: "public, extension=é",
      vary: [],
    });
  });

  test.each(["", "   ", "Cookie\r\nX-Evil: yes", "Accept Language", "Cookie, Origin"])(
    "不正な Vary token を拒否する: %j",
    (token) => expect(() => publicCache({ vary: [token] })).toThrow(/vary/i),
  );

  test("Vary token を case-insensitive に merge し、最初の表記と順序を保つ", () => {
    expect(mergeVary("Accept-Encoding, cookie", ["Cookie", "Origin", "origin"])).toBe(
      "Accept-Encoding, cookie, Origin",
    );
    expect(mergeVary(null, [])).toBeNull();
    expect(mergeVary("*", ["Cookie"])).toBe("*");
  });
});
