import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as publicApi from "../../src/vite/index";
import { zoganVite } from "../../src/vite/index";
import { generateIslandsEntry, listIslandModules } from "../../src/vite/islands-entry";

type Hook = (...args: never[]) => unknown;

const temporaryDirectories: string[] = [];
const createTemporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("公開エントリは zoganVite を維持する", () => {
  // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys creates a fresh array
  expect(Object.keys(publicApi).sort()).toEqual(["default", "zoganVite"]);
});

/** Rollup のプラグインコンテキストを最小限だけ真似る。 */
const context = (
  modules: Record<string, { isEntry?: boolean; imports?: string[] }>,
  consumer: "client" | "server" = "server",
) => ({
  environment: { config: { consumer } },
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
        .filter(([, module]) => (module.imports ?? []).includes(id))
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
  return (handler as (this: unknown, ...values: unknown[]) => unknown).apply(ctx, args);
};

const reachableGraph = {
  "src/server/entry.ts": { isEntry: true, imports: ["src/routes/products.tsx"] },
  "src/routes/products.tsx": { imports: ["src/islands/CartBadge.tsx"] },
  "src/islands/CartBadge.tsx": { imports: ["src/stores/cart.ts"] },
  "src/stores/cart.ts": {},
};

describe("client-only のサーバ到達境界", () => {
  test("'use client-only' へ SSR entry から到達すると経路付きで失敗する", () => {
    const plugin = zoganVite();
    const ctx = context(reachableGraph);
    call(plugin, "configResolved", ctx, { build: { ssr: true } });
    call(
      plugin,
      "transform",
      ctx,
      "'use client-only'\nexport const cart = {}",
      "src/stores/cart.ts",
    );

    expect(() => call(plugin, "buildEnd", ctx, undefined)).toThrow(
      /client-only module reached from server bundle/,
    );
    let message = "";
    try {
      call(plugin, "buildEnd", ctx, undefined);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("src/islands/CartBadge.tsx");
    expect(message).toContain("src/stores/cart.ts");
  });

  test("options.clientOnly の明示 glob も client-only として扱う", () => {
    const plugin = zoganVite({ clientOnly: ["**/stores/**"] });
    const ctx = context(reachableGraph);
    call(plugin, "configResolved", ctx, { build: { ssr: true } });
    call(plugin, "transform", ctx, "export const cart = {}", "src/stores/cart.ts");

    expect(() => call(plugin, "buildEnd", ctx, undefined)).toThrow(/src\/stores\/cart\.ts/);
  });

  test("clientStore import と stores ディレクトリは暗黙には client-only にしない", () => {
    const plugin = zoganVite();
    const ctx = context(reachableGraph);
    call(plugin, "configResolved", ctx, { build: { ssr: true } });
    call(
      plugin,
      "transform",
      ctx,
      "import { clientStore } from 'zogan/client'",
      "src/stores/cart.ts",
    );

    expect(() => call(plugin, "buildEnd", ctx, undefined)).not.toThrow();
  });

  test("client environment では global SSR flag に関係なく到達検査を行わない", () => {
    const plugin = zoganVite({ clientOnly: ["**/stores/**"] });
    const ctx = context(reachableGraph, "client");
    call(plugin, "configResolved", ctx, { build: { ssr: true } });
    call(plugin, "transform", ctx, "'use client-only'", "src/stores/cart.ts");

    expect(() => call(plugin, "buildEnd", ctx, undefined)).not.toThrow();
  });

  test("multi-environment server は global SSR flag が false でも到達検査する", () => {
    const plugin = zoganVite();
    const ctx = context(reachableGraph, "server");
    call(plugin, "configResolved", ctx, { build: { ssr: false } });
    call(plugin, "transform", ctx, "'use client-only'", "src/stores/cart.ts");

    expect(() => call(plugin, "buildEnd", ctx, undefined)).toThrow(
      /client-only module reached from server bundle/,
    );
  });

  test("SSR graph の entry から到達していなければ成功する", () => {
    const plugin = zoganVite();
    const ctx = context({
      "src/server/entry.ts": { isEntry: true, imports: ["src/routes/products.tsx"] },
      "src/routes/products.tsx": {},
      "src/stores/cart.ts": {},
    });
    call(plugin, "configResolved", ctx, { build: { ssr: true } });
    call(plugin, "transform", ctx, "'use client-only'", "src/stores/cart.ts");

    expect(() => call(plugin, "buildEnd", ctx, undefined)).not.toThrow();
  });

  test("先行する build error がある場合は追加診断しない", () => {
    const plugin = zoganVite();
    const ctx = context(reachableGraph);
    call(plugin, "configResolved", ctx, { build: { ssr: true } });
    call(plugin, "transform", ctx, "'use client-only'", "src/stores/cart.ts");

    expect(() => call(plugin, "buildEnd", ctx, new Error("earlier failure"))).not.toThrow();
  });
});

describe("server-only のクライアント到達境界", () => {
  test("'use server-only' へ client entry から到達すると失敗する", () => {
    const graph = {
      "src/client/entry.ts": { isEntry: true, imports: ["src/islands/Account.tsx"] },
      "src/islands/Account.tsx": { imports: ["src/server/database.ts"] },
      "src/server/database.ts": {},
    };
    const plugin = zoganVite();
    const ctx = context(graph, "client");
    call(plugin, "transform", ctx, "'use server-only'", "src/server/database.ts");

    expect(() => call(plugin, "buildEnd", ctx, undefined)).toThrow(
      /server-only module reached from client bundle/,
    );
  });

  test("options.serverOnly の明示 glob も検査する", () => {
    const plugin = zoganVite({ serverOnly: ["**/database/**"] });
    const ctx = context(
      {
        "src/client.ts": { isEntry: true, imports: ["src/database/query.ts"] },
        "src/database/query.ts": {},
      },
      "client",
    );
    call(plugin, "transform", ctx, "export const query = 1", "src/database/query.ts");
    expect(() => call(plugin, "buildEnd", ctx, undefined)).toThrow(/server-only/);
  });
});

describe("Island の lazy client entry", () => {
  test("islandsDir 直下の *.tsx stem を ID として loader map を生成する", () => {
    const dir = createTemporaryDirectory("zogan-islands-");
    writeFileSync(join(dir, "CartBadge.tsx"), "export default () => null");
    writeFileSync(join(dir, "ProductGallery.tsx"), "export default () => null");
    writeFileSync(join(dir, "Ignored.jsx"), "export default () => null");
    writeFileSync(join(dir, "ignored.ts"), "export default () => null");

    const modules = listIslandModules(dir);
    expect(modules.map((module) => module.id)).toEqual(["CartBadge", "ProductGallery"]);

    const code = generateIslandsEntry(modules);
    expect(code).toContain("import { start } from 'zogan/client'");
    expect(code).toContain(`CartBadge: () => import(${JSON.stringify(modules[0]!.file)})`);
    expect(code).toContain(`ProductGallery: () => import(${JSON.stringify(modules[1]!.file)})`);
    expect(code).not.toMatch(/import\s+CartBadge\s+from/);
    expect(code).toContain("export const runtime = start({ islands })");
  });

  test("Island が 0 件でも空 loader map で start する", () => {
    const code = generateIslandsEntry([]);
    expect(code).toContain("export const islands = {");
    expect(code).toContain("export const runtime = start({ islands })");
    expect(code).not.toContain("=> import(");
  });

  test.each(["bad-name.tsx", "1Cart.tsx", "Cart.Bad.tsx", `${"A".repeat(65)}.tsx`])(
    "不正な filename stem を拒否する: %s",
    (filename) => {
      const dir = createTemporaryDirectory("zogan-islands-invalid-");
      writeFileSync(join(dir, filename), "export default () => null");
      expect(() => listIslandModules(dir)).toThrow(/invalid island ID/);
      expect(() => listIslandModules(dir)).toThrow(filename.slice(0, -4));
    },
  );

  test("重複 ID は entry 生成前に拒否する", () => {
    expect(() =>
      generateIslandsEntry([
        { id: "CartBadge", file: "/app/islands/CartBadge.tsx" },
        { id: "CartBadge", file: "/other/islands/CartBadge.tsx" },
      ]),
    ).toThrow(/duplicate island ID.*CartBadge/);
  });

  test("virtual:zogan/islands を解決し、Island 0 件でも読み込める", () => {
    const plugin = zoganVite({ islandsDir: "does-not-exist" });
    const ctx = context({});
    expect(call(plugin, "resolveId", ctx, "virtual:zogan/islands")).toBe("\0virtual:zogan/islands");
    const code = call(plugin, "load", ctx, "\0virtual:zogan/islands") as string;
    expect(code).toContain("export const runtime = start({ islands })");
    expect(code).not.toContain("=> import(");
  });

  test("相対 islandsDir は Vite root 基準の絶対 dynamic import にする", () => {
    const root = createTemporaryDirectory("zogan-root-");
    const dir = join(root, "app/islands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CartBadge.tsx"), "export default () => null");
    const plugin = zoganVite({ islandsDir: "app/islands" });
    const ctx = context({});
    call(plugin, "configResolved", ctx, { root, build: { ssr: false } });

    const code = call(plugin, "load", ctx, "\0virtual:zogan/islands") as string;
    expect(code).toContain(
      `CartBadge: () => import(${JSON.stringify(join(dir, "CartBadge.tsx"))})`,
    );
  });
});
