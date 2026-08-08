import { describe, expect, test } from "vitest";
import {
  findServerReachPath,
  formatReachError,
  hasClientOnlyDirective,
  importsClientStore,
  matchesGlob,
} from "../../src/vite/client-only";

describe("§5.3.2 判定は clientStore の named import", () => {
  test("clientStore を named import しているモジュールは client-only", () => {
    expect(importsClientStore("import { clientStore } from 'zogan/client'")).toBe(true);
    expect(
      importsClientStore(
        'import { signal } from "@preact/signals"\nimport { clientStore, navigating } from "zogan/client"',
      ),
    ).toBe(true);
    expect(importsClientStore("import { clientStore as base } from 'zogan/client'")).toBe(true);
    expect(importsClientStore("import {\n  clientStore,\n} from 'zogan/client'")).toBe(true);
  });

  test("navigating / pendingPartials だけの import は対象外", () => {
    // これを client-only 扱いにすると、スピナーを出すだけの Island までビルドが落ちる
    expect(importsClientStore("import { navigating } from 'zogan/client'")).toBe(false);
    expect(importsClientStore("import { pendingPartials, navigate } from 'zogan/client'")).toBe(
      false,
    );
  });

  test("別のモジュールからの clientStore は対象外", () => {
    expect(importsClientStore("import { clientStore } from './my-utils'")).toBe(false);
  });

  test.each([
    ["namespace", "import * as zogan from 'zogan/client'\nzogan.clientStore('cart', {})"],
    ["dynamic", "const client = await import('zogan/client')\nclient.clientStore('cart', {})"],
    ["named re-export", "export { clientStore } from 'zogan/client'"],
    ["star re-export", "export * from 'zogan/client'"],
  ])("%s 経路を client-only として検出する", (_label, source) => {
    expect(importsClientStore(source)).toBe(true);
  });

  test("コメントや文字列中の偽 import は検出しない", () => {
    expect(importsClientStore("// import { clientStore } from 'zogan/client'")).toBe(false);
    expect(importsClientStore("const example = `import('zogan/client')`")).toBe(false);
  });

  test("type-only import は実行時到達として扱わない", () => {
    expect(importsClientStore("import type { clientStore } from 'zogan/client'")).toBe(false);
  });

  test("構文エラーは解析失敗として安全に無視する", () => {
    expect(importsClientStore("import { from")).toBe(false);
  });

  test("存在しない default import は安全側で client-only とする", () => {
    expect(importsClientStore("import client from 'zogan/client'")).toBe(true);
  });

  test("side-effect import だけなら Store 到達とは扱わない", () => {
    expect(importsClientStore("import 'zogan/client'")).toBe(false);
  });

  test("'use client-only' ディレクティブも補助判定になる", () => {
    expect(hasClientOnlyDirective("'use client-only'\nexport const x = 1")).toBe(true);
    expect(hasClientOnlyDirective('"use client-only"\n')).toBe(true);
    expect(hasClientOnlyDirective("export const x = 1")).toBe(false);
  });

  test("ディレクトリ規約（glob）も補助判定になる", () => {
    expect(matchesGlob("/app/src/stores/cart.ts", "**/stores/**")).toBe(true);
    expect(matchesGlob("/app/src/islands/CartBadge.tsx", "**/stores/**")).toBe(false);
  });
});

describe("§5.3.2 到達検出", () => {
  const graph = (edges: Record<string, string[]>, entries: string[]) => {
    const ids = new Set([...Object.keys(edges), ...Object.values(edges).flat(), ...entries]);
    return {
      getModuleInfo: (id: string) =>
        ids.has(id)
          ? {
              id,
              isEntry: entries.includes(id),
              importers: Object.entries(edges)
                .filter(([, imports]) => imports.includes(id))
                .map(([importer]) => importer),
              dynamicImporters: [],
            }
          : null,
    };
  };

  test("サーババンドルから client-only に到達したら経路を返す", () => {
    const g = graph(
      {
        "src/server/entry.ts": ["src/routes/products.tsx"],
        "src/routes/products.tsx": ["src/islands/CartBadge.tsx"],
        "src/islands/CartBadge.tsx": ["src/stores/cart.ts"],
      },
      ["src/server/entry.ts"],
    );
    expect(findServerReachPath(g, "src/stores/cart.ts")).toEqual([
      "src/server/entry.ts",
      "src/routes/products.tsx",
      "src/islands/CartBadge.tsx",
      "src/stores/cart.ts",
    ]);
  });

  test("エントリから到達しないなら null", () => {
    const g = graph({ "src/islands/CartBadge.tsx": ["src/stores/cart.ts"] }, [
      "src/server/entry.ts",
    ]);
    expect(findServerReachPath(g, "src/stores/cart.ts")).toBe(null);
  });

  test("循環があっても止まる", () => {
    const g = graph({ a: ["b"], b: ["a", "store"] }, ["entry"]);
    expect(findServerReachPath(g, "store")).toBe(null);
  });

  test("dynamic importer もサーバー到達経路として辿る", () => {
    const g = {
      getModuleInfo: (id: string) => {
        if (id === "store")
          return { id, isEntry: false, importers: [], dynamicImporters: ["entry"] };
        if (id === "entry") return { id, isEntry: true, importers: [], dynamicImporters: [] };
        return null;
      },
    };
    expect(findServerReachPath(g, "store")).toEqual(["entry", "store"]);
  });

  test("graph に存在しない target は null", () => {
    expect(findServerReachPath({ getModuleInfo: () => null }, "missing")).toBe(null);
  });

  test("dynamicImporters が省略された ModuleInfo も辿れる", () => {
    const info = {
      store: { id: "store", isEntry: false, importers: ["entry"] },
      entry: { id: "entry", isEntry: true, importers: [] },
    };
    expect(
      findServerReachPath(
        { getModuleInfo: (id) => info[id as keyof typeof info] ?? null },
        "store",
      ),
    ).toEqual(["entry", "store"]);
  });

  test("target 自身が entry の場合も表示できる", () => {
    const path = ["store"];
    expect(formatReachError(path)).toContain("store");
  });

  test("エラーメッセージに到達パスを全部出す", () => {
    const message = formatReachError([
      "src/server/entry.ts",
      "src/routes/products.tsx",
      "src/islands/CartBadge.tsx",
      "src/stores/cart.ts",
    ]);
    expect(message).toContain("client-only module reached from server bundle");
    expect(message).toContain("src/server/entry.ts");
    expect(message).toContain("src/islands/CartBadge.tsx");
    expect(message).toContain("src/stores/cart.ts");
    expect(message).toContain("§5.3.2");
  });
});
