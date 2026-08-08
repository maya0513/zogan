import { describe, expect, test, vi } from "vitest";
import { currentRenderContext } from "../../src/server/render";
import { Island, Partial, StoreSnapshot } from "../../src/server/index";
import { renderZogan } from "../../src/server/render";

const page = (vnode: Parameters<typeof renderZogan>[0], dev = true) =>
  renderZogan(vnode, { kind: "page", dev, fragmentPrefix: "/_f/" });

test("render context は c.render() 相当の描画外では参照できない", () => {
  expect(() => currentRenderContext()).toThrow(/c\.render/);
});

describe("§3.3 <Partial> のマーカー出力", () => {
  test("ラッパー要素を挟まずコメントで範囲を示す", () => {
    const html = page(
      <div class="grid">
        <Partial name="results">
          <article>a</article>
        </Partial>
      </div>,
    ).html;
    expect(html).toBe(
      '<div class="grid"><!--p:results--><article>a</article><!--/p:results--></div>',
    );
  });

  test("入れ子を許可する（§3.1.2）", () => {
    const html = page(
      <Partial name="results">
        <Partial name="pager">1</Partial>
      </Partial>,
    ).html;
    expect(html).toBe("<!--p:results--><!--p:pager-->1<!--/p:pager--><!--/p:results-->");
  });

  test("<tbody> の中にも置ける（§3.3.3）", () => {
    const html = page(
      <table>
        <tbody>
          <Partial name="rows">
            <tr>
              <td>x</td>
            </tr>
          </Partial>
        </tbody>
      </table>,
    ).html;
    expect(html).toContain("<tbody><!--p:rows--><tr><td>x</td></tr><!--/p:rows--></tbody>");
  });

  test("名前が不正なら例外（§3.1.1）", () => {
    expect(() => page(<Partial name="bad--name">x</Partial>).html).toThrow(/bad--name/);
    expect(() => page(<Partial name="1bad">x</Partial>).html).toThrow(/1bad/);
  });

  test("同じ name を 2 回使うと例外（§3.1.1）", () => {
    expect(
      () =>
        page(
          <div>
            <Partial name="results">a</Partial>
            <Partial name="results">b</Partial>
          </div>,
        ).html,
    ).toThrow(/results/);
  });

  test("本文にマーカーを偽装する制御文字が混ざっても外に出ない", () => {
    const evil = `\u0000p:results\u0001<!--p:injected-->`;
    const html = page(<Partial name="results">{evil}</Partial>).html;
    expect(html).toBe("<!--p:results-->p:results&lt;!--p:injected--><!--/p:results-->");
    // 偽の領域が生えていないこと
    expect(html.match(/<!--p:/g)).toHaveLength(1);
  });

  test("宣言順に領域名を報告する", () => {
    const out = page(
      <div>
        <Partial name="count">1</Partial>
        <Partial name="results">a</Partial>
      </div>,
    );
    expect(out.partialNames).toEqual(["count", "results"]);
  });
});

describe("§3.4.1 mode と key", () => {
  test("append で key が無ければ開発ビルドで例外", () => {
    expect(
      () =>
        page(
          <Partial name="results" mode="append">
            a
          </Partial>,
        ).html,
    ).toThrow(/key/);
  });

  test("本番ビルドでは警告に留め、描画は続行する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = page(
      <Partial name="results" mode="append">
        a
      </Partial>,
      false,
    ).html;
    expect(html).toContain("<!--p:results-->a<!--/p:results-->");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test("key があれば通る。mode と key はマーカーに出力しない（付録 A.1.5）", () => {
    const html = page(
      <Partial name="results" mode="append" key={3}>
        a
      </Partial>,
    ).html;
    expect(html).toBe("<!--p:results-->a<!--/p:results-->");
  });

  test("replace では key が無くてよい", () => {
    expect(() => page(<Partial name="results">a</Partial>).html).not.toThrow();
  });
});

describe("§4.2.2 Fragment は Partial を含まない", () => {
  test("Fragment のレンダリングで <Partial> を使うと例外", () => {
    expect(() =>
      renderZogan(<Partial name="results">a</Partial>, {
        kind: "fragment",
        dev: true,
        fragmentPrefix: "/_f/",
      }),
    ).toThrow(/fragment/i);
  });
});

describe("§6.1 <Island>", () => {
  test("data-* 属性を出力し、children を SSR する", () => {
    const html = page(
      <Island name="ProductGallery" trigger="visible" props={{ variant: "compact" }}>
        <img src="/a.jpg" alt="" />
      </Island>,
    ).html;
    expect(html).toBe(
      '<div data-island="ProductGallery" data-props="{&quot;variant&quot;:&quot;compact&quot;}" data-trigger="visible"><img src="/a.jpg" alt/></div>',
    );
  });

  test("trigger の既定は load。props 省略時は data-props を出さない", () => {
    const html = page(
      <Island name="CartBadge" fragment="/_f/cart-badge">
        <span>—</span>
      </Island>,
    ).html;
    expect(html).toBe(
      '<div data-island="CartBadge" data-trigger="load" data-fragment="/_f/cart-badge"><span>—</span></div>',
    );
  });

  test("data-props は HTML 属性値としてエスケープされる（付録 B.1.2）", () => {
    const html = page(<Island name="X" props={{ q: '"><script>alert(1)</script>' }} />).html;
    // 二重引用符属性から脱出できないこと。" と < と & が実体化されていれば足りる
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;script");
    expect(html).toMatch(/^<div data-island="X" data-props="[^"]*" data-trigger="load"><\/div>$/);
  });

  test("コンポーネント名が不正なら例外（§6.1.1）", () => {
    expect(() => page(<Island name="cart-badge" />).html).toThrow(/cart-badge/);
  });

  test("fragmentPrefix 配下でない fragment は例外（§4.3.3）", () => {
    expect(() => page(<Island name="X" fragment="/api/cart" />).html).toThrow(/_f/);
    expect(() => page(<Island name="X" fragment="https://evil.example/_f/x" />).html).toThrow(
      /origin|_f/i,
    );
  });

  test("trigger が不正なら例外", () => {
    // @ts-expect-error 不正な trigger
    expect(() => page(<Island name="X" trigger="whenever" />).html).toThrow(/whenever/);
  });
});

describe("§5.2.1 <StoreSnapshot>", () => {
  test("application/json として出力し、< のみを \\u003c に変換する", () => {
    const html = page(
      <StoreSnapshot name="cart" data={{ version: 41, note: '</script><b>&"' }} />,
    ).html;
    expect(html).toBe(
      '<script type="application/json" data-store="cart">{"version":41,"note":"\\u003c/script>\\u003cb>&\\""}</script>',
    );
    expect(html).not.toContain("</script><b>");
  });

  test("Store 名が不正なら例外", () => {
    expect(() => page(<StoreSnapshot name="ca rt" data={{ version: 1 }} />).html).toThrow(/ca rt/);
  });
});
