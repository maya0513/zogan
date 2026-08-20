import { beforeEach, describe, expect, test } from "vitest";
import { collect, parseHTMLFragment } from "../../src/client/dom";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("DOM utilities", () => {
  test("collect includes matching roots and descendants", () => {
    const nodes = parseHTMLFragment(
      '<div data-zogan-island="A"><span data-zogan-island="B"></span></div>text',
    );
    expect(
      collect(nodes, "[data-zogan-island]").map((el) => el.getAttribute("data-zogan-island")),
    ).toEqual(["A", "B"]);
  });

  test("parses table and select fragments in their insertion context", () => {
    expect(parseHTMLFragment("<tr><td>x</td></tr>", "tbody")[0]).toBeInstanceOf(
      HTMLTableRowElement,
    );
    expect(parseHTMLFragment("<option>x</option>", "select")[0]).toBeInstanceOf(HTMLOptionElement);
    expect(parseHTMLFragment('<col span="2">', "colgroup")[0]).toBeInstanceOf(HTMLTableColElement);
    expect(parseHTMLFragment("<option>x</option>", "optgroup")[0]).toBeInstanceOf(
      HTMLOptionElement,
    );
  });

  test("returns an empty list if a contextual wrapper cannot be traversed", () => {
    expect(parseHTMLFragment("", "tbody")).toEqual([]);
  });

  test("context tag type is the same closed contract as FragmentSlot.as", () => {
    type ContextTag = NonNullable<Parameters<typeof parseHTMLFragment>[1]>;
    const supported: ContextTag = "section";
    // @ts-expect-error SVG parsing is deliberately outside the FragmentSlot contract
    const unsupported: ContextTag = "svg";
    expect([supported, unsupported]).toEqual(["section", "svg"]);
  });
});
