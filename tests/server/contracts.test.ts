import { Hono, type Context } from "hono";
import { h, type ComponentType } from "preact";
import { describe, expect, expectTypeOf, test } from "vitest";
import * as server from "../../src/server/index";
import {
  createZogan,
  defineClientIsland,
  defineIsland,
  type CachePolicy,
  type IslandComponentFor,
  type IslandDescriptor,
  type IslandProps,
  type JsonObject,
  type ZoganRenderOptions,
} from "../../src/server/index";

type CounterProps = JsonObject & { count: number };
type HasRequiredProps =
  Record<never, never> extends Pick<IslandProps<JsonObject>, "props"> ? false : true;

const Counter: ComponentType<CounterProps> = ({ count }) => h("span", null, count);

const legacyPartials = (context: Context): unknown => {
  // @ts-expect-error -- request-scoped Partial state is not part of Hono
  return context.req.partials;
};

describe("公開サーバー契約", () => {
  test("狭い明示 API だけを value export する", () => {
    // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys() is already a fresh array
    expect(Object.keys(server).sort()).toEqual([
      "FragmentSlot",
      "Island",
      "cachePolicy",
      "createZogan",
      "defineClientIsland",
      "defineIsland",
      "privateNoStore",
      "publicCache",
    ]);
  });

  test("Hono prototype を変更しない", () => {
    const app = new Hono();
    expect(Hono.prototype).not.toHaveProperty("page");
    expect(Hono.prototype).not.toHaveProperty("fragment");
    // @ts-expect-error -- legacy ambient augmentation must never return
    expect(app.page).toBeUndefined();
    // @ts-expect-error -- legacy ambient augmentation must never return
    expect(app.fragment).toBeUndefined();

    expectTypeOf(legacyPartials).returns.toEqualTypeOf<unknown>();
  });

  test("createZogan は Context と必須 CachePolicy を取る明示的な factory", () => {
    type Zogan = ReturnType<typeof createZogan>;

    expectTypeOf<Parameters<Zogan["page"]>[0]>().toEqualTypeOf<Context>();
    expectTypeOf<Parameters<Zogan["fragment"]>[0]>().toEqualTypeOf<Context>();
    expectTypeOf<Parameters<Zogan["page"]>[2]>().toEqualTypeOf<ZoganRenderOptions>();
    expectTypeOf<Parameters<Zogan["fragment"]>[2]["cache"]>().toEqualTypeOf<CachePolicy>();
  });

  test("descriptor から component props 型を保つ", () => {
    const descriptor = defineIsland<CounterProps>({ component: Counter, id: "Counter" });
    const clientDescriptor = defineClientIsland<CounterProps>({
      fallback: ({ count }) => h("span", null, count),
      id: "ClientCounter",
    });

    expectTypeOf(descriptor).toEqualTypeOf<IslandDescriptor<CounterProps>>();
    expectTypeOf<IslandComponentFor<typeof descriptor>>().toEqualTypeOf<
      ComponentType<CounterProps>
    >();
    expectTypeOf(clientDescriptor).toEqualTypeOf<IslandDescriptor<CounterProps>>();
    expectTypeOf<HasRequiredProps>().toEqualTypeOf<true>();
  });
});
