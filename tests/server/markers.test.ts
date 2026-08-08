import { describe, expect, test } from "vitest";
import {
  endMarker,
  extractPartials,
  findMarkers,
  isValidIdentifier,
  isValidComponentName,
} from "../../src/server/markers";

describe("§3.1.1 識別子", () => {
  test.each([
    ["results", true],
    ["count", true],
    ["a", true],
    ["A1_b", true],
    ["product-grid", true],
    ["product-grid-2", true],
    ["1results", false], // 先頭が英字でない
    ["results-", false], // 末尾ハイフン
    ["results--x", false], // 連続ハイフン
    ["-results", false],
    ["res ults", false],
    ["", false],
    ["a".repeat(64), true],
    ["a".repeat(65), false], // 64 文字以内
  ])("isValidIdentifier(%j) === %j", (name, expected) => {
    expect(isValidIdentifier(name)).toBe(expected);
  });

  test("コンポーネント名はハイフンを許さない（JS 識別子として書けること）", () => {
    expect(isValidComponentName("CartBadge")).toBe(true);
    expect(isValidComponentName("cart_badge2")).toBe(true);
    expect(isValidComponentName("cart-badge")).toBe(false);
  });
});

describe("§3.3 マーカーの走査", () => {
  test("宣言順に開始・終了位置を返す", () => {
    const html = "<div><!--p:count-->1件<!--/p:count--><!--p:results-->a<!--/p:results--></div>";
    const found = findMarkers(html);
    expect(found.map((m) => m.name)).toEqual(["count", "results"]);
    expect(html.slice(found[0]!.start, found[0]!.end)).toBe("<!--p:count-->1件<!--/p:count-->");
  });

  test("入れ子の親子関係を認識する", () => {
    const html = "<!--p:results-->x<!--p:pager-->1<!--/p:pager--><!--/p:results-->";
    const found = findMarkers(html);
    expect(found.map((m) => [m.name, m.parent])).toEqual([
      ["results", null],
      ["pager", "results"],
    ]);
  });

  test("終了マーカーが無ければ例外", () => {
    expect(() => findMarkers("<!--p:results-->x")).toThrow(/results/);
  });

  test("対応しない終了マーカーは例外", () => {
    expect(() => findMarkers("<!--p:a--><!--/p:b-->")).toThrow(/mismatch/);
  });

  test("終了マーカーを生成する", () => {
    expect(endMarker("results")).toBe("<!--/p:results-->");
  });
});

describe("§3.2.2 部分応答の切り出し", () => {
  const html =
    "<html><body><!--p:count-->842 件<!--/p:count--><div><!--p:results--><article>a</article><!--/p:results--></div></body></html>";

  test("要求された領域をマーカー込みで宣言順に連結する", () => {
    // リクエスト順が results,count でも宣言順（count → results）で返る
    const out = extractPartials(html, ["results", "count"]);
    expect(out.names).toEqual(["count", "results"]);
    expect(out.body).toBe(
      "<!--p:count-->842 件<!--/p:count--><!--p:results--><article>a</article><!--/p:results-->",
    );
  });

  test("存在しない領域は無視され、返せた領域だけが列挙される", () => {
    const out = extractPartials(html, ["results", "nope"]);
    expect(out.names).toEqual(["results"]);
  });

  test("1 つも返せなければ空になる（§3.2.3）", () => {
    const out = extractPartials(html, ["nope"]);
    expect(out.names).toEqual([]);
    expect(out.body).toBe("");
  });

  test("§3.1.2 親子が同時に要求されたら親だけを返す", () => {
    const nested =
      "<!--p:results--><article>a</article><!--p:pager-->1<!--/p:pager--><!--/p:results-->";
    const out = extractPartials(nested, ["results", "pager"]);
    expect(out.names).toEqual(["results"]);
    expect(out.body).toBe(nested);
  });

  test("親が要求されていなければ子は単独で返る", () => {
    const nested =
      "<!--p:results--><article>a</article><!--p:pager-->1<!--/p:pager--><!--/p:results-->";
    const out = extractPartials(nested, ["pager"]);
    expect(out.names).toEqual(["pager"]);
    expect(out.body).toBe("<!--p:pager-->1<!--/p:pager-->");
  });
});
