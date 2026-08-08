import { beforeEach, describe, expect, test } from "vitest";
import {
  collect,
  findMarkerRange,
  listMarkerNames,
  parseHTMLFragment,
  replaceRange,
  splitPartials,
} from "../../src/client/dom";

const setBody = (html: string) => {
  document.body.innerHTML = html;
};

beforeEach(() => setBody(""));

describe("§3.3 マーカーの走査", () => {
  test("文書内の全マーカー名を宣言順で返す（§7.2.3 の既定）", () => {
    setBody("<!--p:count-->1<!--/p:count--><div><!--p:results-->a<!--/p:results--></div>");
    expect(listMarkerNames(document)).toEqual(["count", "results"]);
  });

  test("開始・終了コメントと親ノードを引ける", () => {
    setBody('<div id="g"><!--p:results-->a<!--/p:results--></div>');
    const range = findMarkerRange(document, "results");
    expect(range).not.toBeNull();
    expect((range!.parent as Element).id).toBe("g");
  });

  test("存在しない領域は null", () => {
    expect(findMarkerRange(document, "nope")).toBe(null);
  });

  test("開始・終了マーカーの親が異なれば拒否する", () => {
    document.body.append(document.createComment("p:x"));
    const child = document.createElement("div");
    child.append(document.createComment("/p:x"));
    document.body.append(child);
    expect(() => findMarkerRange(document, "x")).toThrow(/siblings/);
  });
});

describe("§3.3.3 ラッパーが置けない場所でも往復できる", () => {
  test("<tbody> の中の <tr> が失われない", () => {
    setBody("<table><tbody><!--p:rows--><tr><td>a</td></tr><!--/p:rows--></tbody></table>");
    const nodes = parseHTMLFragment("<tr><td>b</td></tr>");
    replaceRange(document, "rows", nodes, "replace");
    expect(document.querySelectorAll("tbody tr").length).toBe(1);
    expect(document.querySelector("tbody td")!.textContent).toBe("b");
  });

  test("<select> の中の <option> が失われない", () => {
    setBody("<select><!--p:variants--><option>a</option><!--/p:variants--></select>");
    replaceRange(document, "variants", parseHTMLFragment("<option>b</option>"), "replace");
    expect(document.querySelectorAll("select option").length).toBe(1);
    expect(document.querySelector("option")!.textContent).toBe("b");
  });
});

describe("§3.3.2 差し替えアルゴリズム", () => {
  beforeEach(() => setBody('<div id="g"><!--p:r-->old<!--/p:r--></div>'));

  test("replace は中身を入れ替え、マーカーは残す", () => {
    replaceRange(document, "r", parseHTMLFragment("<b>new</b>"), "replace");
    expect(document.getElementById("g")!.innerHTML).toBe("<!--p:r--><b>new</b><!--/p:r-->");
  });

  test("append は終了マーカーの直前に足す", () => {
    replaceRange(document, "r", parseHTMLFragment("<b>2</b>"), "append");
    expect(document.getElementById("g")!.innerHTML).toBe("<!--p:r-->old<b>2</b><!--/p:r-->");
  });

  test("prepend は開始マーカーの直後に足す", () => {
    replaceRange(document, "r", parseHTMLFragment("<b>0</b>"), "prepend");
    expect(document.getElementById("g")!.innerHTML).toBe("<!--p:r--><b>0</b>old<!--/p:r-->");
  });

  test("挿入されたノードを返す（Store マージと hydrate の走査対象になる）", () => {
    const inserted = replaceRange(document, "r", parseHTMLFragment("<b>x</b><i>y</i>"), "replace");
    expect(inserted!.map((n) => (n as Element).tagName)).toEqual(["B", "I"]);
  });

  test("マーカーが無ければ null（呼び出し元がフォールバックする）", () => {
    expect(replaceRange(document, "nope", [], "replace")).toBe(null);
  });
});

describe("§3.2.2 部分応答の分解", () => {
  test("領域ごとに中身だけを取り出す（受け取ったマーカーは含めない）", () => {
    const parts = splitPartials(
      "<!--p:count-->842 件<!--/p:count--><!--p:results--><article>a</article><!--/p:results-->",
    );
    expect([...parts.keys()]).toEqual(["count", "results"]);
    expect(parts.get("count")).toBe("842 件");
    expect(parts.get("results")).toBe("<article>a</article>");
  });

  test("入れ子のマーカーは中身として残す（親を差し替えれば子も入れ替わる）", () => {
    const parts = splitPartials(
      "<!--p:results--><article>a</article><!--p:pager-->1<!--/p:pager--><!--/p:results-->",
    );
    expect([...parts.keys()]).toEqual(["results"]);
    expect(parts.get("results")).toBe("<article>a</article><!--p:pager-->1<!--/p:pager-->");
  });

  test("挿入先が <tbody> なら <tr> を落とさずに解析する（§3.3.3）", () => {
    // 応答全体を 1 つの <template> に流すと、先行するテキストでパーサが
    // in-body モードに落ちて <tr> が捨てられる。挿入先の文脈で解析する
    const parts = splitPartials(
      "<!--p:count-->842 件<!--/p:count--><!--p:rows--><tr><td>a</td></tr><!--/p:rows-->",
    );
    const nodes = parseHTMLFragment(parts.get("rows")!, "TBODY");
    expect(nodes.map((n) => (n as Element).tagName)).toEqual(["TR"]);
  });

  test("挿入先が <select> なら <option> を落とさない", () => {
    const nodes = parseHTMLFragment("<option>a</option><option>b</option>", "SELECT");
    expect(nodes.map((n) => (n as Element).tagName)).toEqual(["OPTION", "OPTION"]);
  });

  test("終端が欠けていれば例外（§7.3.1 の 10 番）", () => {
    expect(() => splitPartials("<!--p:results-->a")).toThrow();
  });

  test("空 body は空の Map", () => {
    expect(splitPartials("").size).toBe(0);
  });
});

describe("§5.2.3 / §6.1.3 走査はノード自身と子孫の両方を見る", () => {
  test("ノード自身がセレクタに一致する場合を取り逃がさない", () => {
    const nodes = parseHTMLFragment(
      '<script type="application/json" data-store="cart">{"version":1}</script>' +
        '<div><script type="application/json" data-store="user">{"version":2}</script></div>',
    );
    const found = collect(nodes, 'script[type="application/json"][data-store]');
    expect(found.map((el) => el.getAttribute("data-store"))).toEqual(["cart", "user"]);
  });

  test("テキストノードは無視する", () => {
    const nodes = parseHTMLFragment('text<div data-island="X"></div>');
    expect(collect(nodes, "[data-island]").length).toBe(1);
  });
});
