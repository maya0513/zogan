import type { ComponentType } from "preact";
import { render } from "preact-render-to-string";
import { describe, expect, test } from "vitest";
import {
  FragmentSlot,
  Island,
  defineClientIsland,
  defineIsland,
  type FragmentElement,
  type FragmentTrigger,
  type JsonObject,
} from "../../src/server/index";

type CounterProps = JsonObject & { count: number; label: string };

const FRAGMENT_TRIGGERS = [
  "load",
  "idle",
  "visible",
  "manual",
  "media:(prefers-reduced-motion)",
] as const satisfies readonly FragmentTrigger[];

const Counter: ComponentType<CounterProps> = ({ count, label }) => (
  <button type="button">
    {label}: {count}
  </button>
);

describe("typed islands", () => {
  test("hydrate descriptor は component を SSR し、固定 marker contract を出力する", () => {
    const counter = defineIsland<CounterProps>({ id: "Counter", component: Counter });
    expect(
      render(<Island of={counter} props={{ count: 3, label: "Cart" }} trigger="visible" />),
    ).toBe(
      '<div data-zogan-island="Counter" data-zogan-mode="hydrate" data-zogan-trigger="visible" data-zogan-props="{&quot;count&quot;:3,&quot;label&quot;:&quot;Cart&quot;}"><button type="button">Cart: 3</button></div>',
    );
  });

  test("mount descriptor は fallback を SSR する", () => {
    const chart = defineClientIsland<CounterProps>({
      id: "Chart",
      fallback: ({ label }) => <p>{label} loading</p>,
    });
    expect(render(<Island of={chart} props={{ count: 3, label: "Sales" }} trigger="idle" />)).toBe(
      '<div data-zogan-island="Chart" data-zogan-mode="mount" data-zogan-trigger="idle" data-zogan-props="{&quot;count&quot;:3,&quot;label&quot;:&quot;Sales&quot;}"><p>Sales loading</p></div>',
    );
  });

  test("props は必須で、空 object も明示的に serialize する", () => {
    const empty = defineIsland<JsonObject>({ id: "Empty", component: () => <span>ok</span> });
    expect(render(<Island of={empty} props={{}} />)).toContain('data-zogan-props="{}"');
    expect(render(<Island of={empty} props={{}} />)).toContain('data-zogan-trigger="load"');
  });

  test("props attribute を HTML escape し、markup injection を防ぐ", () => {
    const search = defineIsland<JsonObject>({ id: "Search", component: () => null });
    const html = render(
      <Island of={search} props={{ q: '"><script>alert(1)</script>' }} trigger="load" />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;script");
  });

  test.each(["", "1Counter", "cart-badge", "a".repeat(65)])(
    "不正な island id を descriptor 定義時に拒否する: %j",
    (id) => expect(() => defineIsland<JsonObject>({ id, component: () => null })).toThrow(/id/i),
  );

  test.each(["manual", "none", "media:", "whenever"])(
    "不正な island trigger を拒否する: %j",
    (trigger) => {
      const descriptor = defineIsland<JsonObject>({ id: "Trigger", component: () => null });
      expect(() =>
        render(
          <Island
            of={descriptor}
            props={{}}
            // @ts-expect-error runtime の境界も検証する
            trigger={trigger}
          />,
        ),
      ).toThrow(/trigger/i);
    },
  );

  test("media trigger は空でない query を受け取る", () => {
    const descriptor = defineIsland<JsonObject>({ id: "Media", component: () => null });
    expect(
      render(<Island of={descriptor} props={{}} trigger="media:(min-width: 60rem)" />),
    ).toContain('data-zogan-trigger="media:(min-width: 60rem)"');
  });

  test.each([
    ["undefined", { value: undefined }],
    ["function", { value: () => undefined }],
    ["symbol", { value: Symbol("x") }],
    ["bigint", { value: 1n }],
    ["NaN", { value: Number.NaN }],
    ["Infinity", { value: Number.POSITIVE_INFINITY }],
    ["Date", { value: new Date(0) }],
    ["Map", { value: new Map() }],
  ])("non-JSON props を拒否する: %s", (_label, props) => {
    const descriptor = defineIsland<JsonObject>({ id: "Strict", component: () => null });
    expect(() => render(<Island of={descriptor} props={props as JsonObject} />)).toThrow(/JSON/i);
  });

  test("cycle と symbol key を拒否する", () => {
    const descriptor = defineIsland<JsonObject>({ id: "Strict", component: () => null });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => render(<Island of={descriptor} props={cyclic as JsonObject} />)).toThrow(
      /cycle|cyclic/i,
    );

    const symbolKey = { ok: true } as Record<PropertyKey, unknown>;
    symbolKey[Symbol("secret")] = true;
    expect(() => render(<Island of={descriptor} props={symbolKey as JsonObject} />)).toThrow(
      /symbol|JSON/i,
    );
  });

  test("descriptor は実行可能な Preact component だけを受け取る", () => {
    expect(() =>
      defineIsland<JsonObject>({
        // @ts-expect-error JavaScript caller が型を迂回した境界を検証する
        component: null,
        id: "Broken",
      }),
    ).toThrow(/component/i);
  });

  test("nested array を含む有限JSONをserializeする", () => {
    const descriptor = defineIsland<JsonObject>({ id: "Arrays", component: () => null });
    const html = render(
      <Island of={descriptor} props={{ values: [null, true, "text", 1, { nested: [false] }] }} />,
    );
    expect(html).toContain(
      "{&quot;values&quot;:[null,true,&quot;text&quot;,1,{&quot;nested&quot;:[false]}]}",
    );
  });

  test("sparse、accessor、symbol、extra propertyを持つarrayを拒否する", () => {
    const descriptor = defineIsland<JsonObject>({ id: "StrictArray", component: () => null });
    const renderValues = (values: unknown[]): string =>
      render(<Island of={descriptor} props={{ values } as JsonObject} />);

    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(() => renderValues(sparse)).toThrow(/JSON/i);

    const accessor = ["safe"];
    Object.defineProperty(accessor, 0, { enumerable: true, get: () => "computed" });
    expect(() => renderValues(accessor)).toThrow(/plain enumerable JSON property/i);

    const symbolKey = ["safe"] as unknown[] & Record<PropertyKey, unknown>;
    symbolKey[Symbol("secret")] = true;
    expect(() => renderValues(symbolKey)).toThrow(/symbol/i);

    const extra = ["safe"] as unknown[] & { extra?: boolean };
    extra.extra = true;
    expect(() => renderValues(extra)).toThrow(/array property/i);
  });

  test("root propsとobject property descriptorもplain JSONに限定する", () => {
    const descriptor = defineIsland<JsonObject>({ id: "StrictRoot", component: () => null });
    for (const props of [null, [], new Date(0)]) {
      expect(() =>
        render(<Island of={descriptor} props={props as unknown as JsonObject} />),
      ).toThrow(/plain JSON object/i);
    }

    const hidden: Record<string, unknown> = {};
    Object.defineProperty(hidden, "value", { enumerable: false, value: "secret" });
    expect(() => render(<Island of={descriptor} props={hidden as JsonObject} />)).toThrow(
      /plain enumerable JSON property/i,
    );
  });
});

describe("FragmentSlot", () => {
  test("既定 div に fragment src、trigger、fallback を出力する", () => {
    expect(
      render(
        <FragmentSlot src="/fragments/cart?compact=1" trigger="visible">
          <span>Loading</span>
        </FragmentSlot>,
      ),
    ).toBe(
      '<div data-zogan-fragment="/fragments/cart?compact=1" data-zogan-trigger="visible"><span>Loading</span></div>',
    );
  });

  test("as と通常 DOM attrs を wrapper へ forward する", () => {
    expect(
      render(
        <FragmentSlot as="section" src="/feed" class="feed" aria-label="Feed" id="feed">
          Fallback
        </FragmentSlot>,
      ),
    ).toBe(
      '<section class="feed" aria-label="Feed" id="feed" data-zogan-fragment="/feed" data-zogan-trigger="load">Fallback</section>',
    );
  });

  test("table/select の contextual container と固有 attrs を許可する", () => {
    expect(
      render(
        <FragmentSlot as="tbody" src="/rows" class="rows">
          <tr>
            <td>Fallback</td>
          </tr>
        </FragmentSlot>,
      ),
    ).toBe(
      '<tbody class="rows" data-zogan-fragment="/rows" data-zogan-trigger="load"><tr><td>Fallback</td></tr></tbody>',
    );
    expect(
      render(
        <FragmentSlot as="select" src="/options" name="choice" multiple>
          <option>Fallback</option>
        </FragmentSlot>,
      ),
    ).toBe(
      '<select name="choice" multiple data-zogan-fragment="/options" data-zogan-trigger="load"><option>Fallback</option></select>',
    );
  });

  test.each(["svg", "template", "img", "input", "script", "style", "textarea", "option"])(
    "置換containerとして未対応な as=%s を型と実行時で拒否する",
    (tag) => {
      expect(() =>
        render(
          <FragmentSlot
            // @ts-expect-error unsupported container を JS 呼び出しでも fail-closed にする
            as={tag}
            src="/fragment"
          />,
        ),
      ).toThrow(/as|container/i);
    },
  );

  test("FragmentElement は対応済み HTML container の閉じた union である", () => {
    const supported: FragmentElement = "span";
    // @ts-expect-error foreign-content container は client parser の契約外
    const unsupported: FragmentElement = "svg";
    expect([supported, unsupported]).toEqual(["span", "svg"]);
  });

  test.each(FRAGMENT_TRIGGERS)("fragment trigger を受け取る: %s", (trigger) =>
    expect(render(<FragmentSlot src="/fragment" trigger={trigger} />)).toContain(
      `data-zogan-trigger="${trigger}"`,
    ),
  );

  test.each(["none", "media:", "whenever"])("不正な fragment trigger を拒否する: %s", (trigger) => {
    expect(() =>
      render(
        <FragmentSlot
          src="/fragment"
          // @ts-expect-error runtime の境界も検証する
          trigger={trigger}
        />,
      ),
    ).toThrow(/trigger/i);
  });

  test.each([
    "",
    "relative/path",
    "//evil.example/x",
    "https://evil.example/x",
    "/x#hash",
    "/x\\y",
    "/a/./b",
    "/a/../b",
    "/a/%2e%2e/b",
  ])("same-origin root-relative でない src を拒否する: %j", (src) => {
    expect(() => render(<FragmentSlot src={src} />)).toThrow(/src|path|segment/i);
  });

  test("内部 data-zogan-* 属性の override を拒否する", () => {
    expect(() =>
      render(
        <FragmentSlot
          src="/safe"
          {...({ "data-zogan-fragment": "/evil" } as Record<string, string>)}
        />,
      ),
    ).toThrow(/data-zogan/i);
    expect(() =>
      render(
        <FragmentSlot
          src="/safe"
          {...({ "data-zogan-extra": "nope" } as Record<string, string>)}
        />,
      ),
    ).toThrow(/data-zogan/i);
  });
});
