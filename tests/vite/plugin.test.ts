import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import * as publicApi from "../../src/vite/index";
import { zoganVite } from "../../src/vite/index";
import { generateIslandsEntry, listIslandModules } from "../../src/vite/islands-entry";
import { validateSource } from "../../src/vite/validate";

type Hook = (...args: never[]) => unknown;

test("公開エントリは文書化されたプラグインだけを公開する", () => {
  expect(Object.keys(publicApi).sort()).toEqual(["default", "zoganVite"]);
});

/** rollup のプラグインコンテキストを最小限だけ真似る */
const context = (modules: Record<string, { isEntry?: boolean; imports?: string[] }>) => ({
  error: (message: string | Error) => {
    throw typeof message === "string" ? new Error(message) : message;
  },
  warn: vi.fn(),
  getModuleInfo: (id: string) => {
    const info = modules[id];
    if (info === undefined) return null;
    return {
      id,
      isEntry: info.isEntry === true,
      importers: Object.entries(modules)
        .filter(([, m]) => (m.imports ?? []).includes(id))
        .map(([importer]) => importer),
      dynamicImporters: [],
    };
  },
});

const call = (
  plugin: ReturnType<typeof zoganVite>,
  hook: string,
  ctx: unknown,
  ...args: unknown[]
) => {
  const fn = (plugin as unknown as Record<string, Hook>)[hook];
  const handler = typeof fn === "function" ? fn : (fn as unknown as { handler: Hook }).handler;
  return (handler as (this: unknown, ...a: unknown[]) => unknown).apply(ctx, args);
};

describe("付録 A.3 の 1：client-only の到達検出", () => {
  const graph = {
    "src/server/entry.ts": { isEntry: true, imports: ["src/routes/products.tsx"] },
    "src/routes/products.tsx": { imports: ["src/islands/CartBadge.tsx"] },
    "src/islands/CartBadge.tsx": { imports: ["src/stores/cart.ts"] },
    "src/stores/cart.ts": {},
  };

  const markStore = (plugin: ReturnType<typeof zoganVite>, ctx: unknown) => {
    call(
      plugin,
      "transform",
      ctx,
      "import { clientStore } from 'zogan/client'",
      "src/stores/cart.ts",
    );
  };

  test("SSR ビルドで到達していれば到達パス付きで失敗する", () => {
    const plugin = zoganVite();
    const ctx = context(graph);
    call(plugin, "configResolved", ctx, { build: { ssr: true } });
    markStore(plugin, ctx);

    expect(() => call(plugin, "buildEnd", ctx, undefined)).toThrow(
      /client-only module reached from server bundle/,
    );
    try {
      call(plugin, "buildEnd", ctx, undefined);
    } catch (error) {
      expect((error as Error).message).toContain("src/islands/CartBadge.tsx");
      expect((error as Error).message).toContain("src/stores/cart.ts");
    }
  });

  test("クライアントビルドでは検査しない（Island のエントリはここから伸びる）", () => {
    const plugin = zoganVite();
    const ctx = context(graph);
    call(plugin, "configResolved", ctx, { build: { ssr: false } });
    markStore(plugin, ctx);
    expect(() => call(plugin, "buildEnd", ctx, undefined)).not.toThrow();
  });

  test("到達していなければ成功する", () => {
    const plugin = zoganVite();
    const ctx = context({
      "src/server/entry.ts": { isEntry: true, imports: ["src/routes/products.tsx"] },
      "src/routes/products.tsx": {},
      "src/stores/cart.ts": {},
    });
    call(plugin, "configResolved", ctx, { build: { ssr: true } });
    markStore(plugin, ctx);
    expect(() => call(plugin, "buildEnd", ctx, undefined)).not.toThrow();
  });

  test("navigating を読むだけの Island はビルドを落とさない（§5.3.2 の補足）", () => {
    const plugin = zoganVite();
    const ctx = context({
      "src/server/entry.ts": { isEntry: true, imports: ["src/islands/Spinner.tsx"] },
      "src/islands/Spinner.tsx": {},
    });
    call(plugin, "configResolved", ctx, { build: { ssr: true } });
    call(
      plugin,
      "transform",
      ctx,
      "import { navigating } from 'zogan/client'\nexport default () => navigating.value",
      "src/islands/Spinner.tsx",
    );
    expect(() => call(plugin, "buildEnd", ctx, undefined)).not.toThrow();
  });
});

describe("付録 A.3 の 2・3：ソースの静的検証", () => {
  test("不正な Partial 名を検出する", () => {
    const issues = validateSource('<Partial name="bad--name">x</Partial>', "a.tsx");
    expect(issues[0]!.level).toBe("error");
  });

  test("同一ファイル内の重複を検出する", () => {
    const issues = validateSource(
      '<Partial name="results">a</Partial><Partial name="results">b</Partial>',
      "a.tsx",
    );
    expect(issues.some((i) => i.message.includes("duplicate"))).toBe(true);
  });

  test("append で key が無ければ警告", () => {
    const issues = validateSource('<Partial name="items" mode="append">x</Partial>', "a.tsx");
    expect(issues[0]!.level).toBe("warn");
  });

  test("key があれば警告しない（式でもよい）", () => {
    expect(
      validateSource('<Partial name="items" mode="append" key={page}>x</Partial>', "a.tsx"),
    ).toEqual([]);
  });

  test("正しい宣言では何も出ない", () => {
    expect(
      validateSource('<Partial name="results"><Island name="CartBadge" /></Partial>', "a.tsx"),
    ).toEqual([]);
  });

  test("動的 name は静的検査を省略する", () => {
    expect(
      validateSource("<Partial name={name}>x</Partial><Island name={kind} />", "a.tsx"),
    ).toEqual([]);
  });

  test("不正な Island 名を検出する", () => {
    expect(validateSource('<Island name="bad-name" />', "a.tsx")[0]?.level).toBe("error");
  });
});

describe("付録 A.3 の 4：Island のクライアントエントリ生成", () => {
  test("ディレクトリからコンポーネント名を集めて start({ islands }) を生成する", () => {
    const dir = mkdtempSync(join(tmpdir(), "zogan-islands-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CartBadge.tsx"), "export default () => null");
    writeFileSync(join(dir, "ProductGallery.tsx"), "export default () => null");
    writeFileSync(join(dir, "notes.md"), "無視される");

    const modules = listIslandModules(dir);
    expect(modules.map((m) => m.name)).toEqual(["CartBadge", "ProductGallery"]);

    const code = generateIslandsEntry(modules);
    expect(code).toContain("import { start } from 'zogan/client'");
    expect(code).toContain("import CartBadge from");
    expect(code).toContain("start({ islands })");
  });

  test("virtual:zogan/islands を解決して読み込める", () => {
    const plugin = zoganVite({ islandsDir: "does-not-exist" });
    const ctx = context({});
    expect(call(plugin, "resolveId", ctx, "virtual:zogan/islands")).toBe("\0virtual:zogan/islands");
    const code = call(plugin, "load", ctx, "\0virtual:zogan/islands") as string;
    expect(code).toContain("start({ islands })");
  });

  test("相対 islandsDir は Vite root を基準にし、絶対 import を生成する", () => {
    const root = mkdtempSync(join(tmpdir(), "zogan-root-"));
    const dir = join(root, "app/islands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CartBadge.tsx"), "export default () => null");
    const plugin = zoganVite({ islandsDir: "app/islands" });
    const ctx = context({});
    call(plugin, "configResolved", ctx, { root, build: { ssr: false } });
    const code = call(plugin, "load", ctx, "\0virtual:zogan/islands") as string;
    expect(code).toContain(join(root, "app/islands/CartBadge.tsx"));
  });

  test("同じ Island 名の拡張子違いは曖昧なので失敗する", () => {
    const dir = mkdtempSync(join(tmpdir(), "zogan-islands-collision-"));
    writeFileSync(join(dir, "CartBadge.tsx"), "export default () => null");
    writeFileSync(join(dir, "CartBadge.jsx"), "export default () => null");
    expect(() => listIslandModules(dir)).toThrow(/CartBadge/);
  });
});
