import { describe, expect, test } from "vitest";
import {
  findServerReachPath,
  formatReachError,
  hasClientOnlyDirective,
  hasServerOnlyDirective,
  matchesGlob,
} from "../../src/vite/client-only";

const createGraph = (edges: Record<string, string[]>, entries: string[]) => {
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

describe("client-only の明示判定", () => {
  test("'use client-only' directive を検出する", () => {
    expect(hasClientOnlyDirective("'use client-only'\nexport const x = 1")).toBe(true);
    expect(hasClientOnlyDirective('"use client-only";\n')).toBe(true);
    expect(hasClientOnlyDirective("export const x = 1")).toBe(false);
  });

  test("'use server-only' directive を対称に検出する", () => {
    expect(hasServerOnlyDirective("'use server-only'\nexport const secret = 1")).toBe(true);
    expect(hasServerOnlyDirective("'use client-only'\nexport const browser = 1")).toBe(false);
  });

  test("leading trivia と先行 directive の後でも検出する", () => {
    expect(hasClientOnlyDirective("/* license */\n'use client-only';\nexport {}")).toBe(true);
    expect(hasClientOnlyDirective('// generated\n"use client-only"\nexport {}')).toBe(true);
    expect(hasClientOnlyDirective("\uFEFF#!/usr/bin/env node\n'use client-only';")).toBe(true);
    expect(hasClientOnlyDirective("'use strict';\n/* boundary */\n'use client-only';")).toBe(true);
  });

  test("directive scanner のcommentとstring境界をfail closedで扱う", () => {
    expect(hasClientOnlyDirective("/* license\n * second line */'use client-only';")).toBe(true);
    expect(hasClientOnlyDirective("/* unterminated")).toBe(false);
    expect(hasClientOnlyDirective("'ordinary\\ value';\n'use client-only';")).toBe(true);
    expect(hasClientOnlyDirective("'ordinary\\\r\nvalue';\n'use client-only';")).toBe(true);
    expect(hasClientOnlyDirective("'use strict'\n'use client-only';")).toBe(true);
    expect(hasClientOnlyDirective("'unterminated\n'use client-only';")).toBe(false);
    expect(hasClientOnlyDirective("'unterminated")).toBe(false);
    expect(hasClientOnlyDirective("'use strict';")).toBe(false);
  });

  test("comment、nested scope、通常の string expression は directive と誤認しない", () => {
    expect(hasClientOnlyDirective("/* 'use client-only' */\nexport {}")).toBe(false);
    expect(hasClientOnlyDirective("export function run() { 'use client-only'; }")).toBe(false);
    expect(hasClientOnlyDirective("const marker = 'use client-only'")).toBe(false);
    expect(hasClientOnlyDirective("'not a directive' + 'use client-only'")).toBe(false);
  });

  test("明示 glob に一致する path を検出する", () => {
    expect(matchesGlob("/app/src/browser/cart.ts", "**/browser/**")).toBe(true);
    expect(matchesGlob("/app/src/islands/CartBadge.tsx", "**/browser/**")).toBe(false);
  });
});

describe("client-only の SSR 到達検出", () => {
  test("server entry から到達した経路を返す", () => {
    const moduleGraph = createGraph(
      {
        "src/server/entry.ts": ["src/routes/products.tsx"],
        "src/routes/products.tsx": ["src/islands/CartBadge.tsx"],
        "src/islands/CartBadge.tsx": ["src/browser/cart.ts"],
      },
      ["src/server/entry.ts"],
    );
    expect(findServerReachPath(moduleGraph, "src/browser/cart.ts")).toEqual([
      "src/server/entry.ts",
      "src/routes/products.tsx",
      "src/islands/CartBadge.tsx",
      "src/browser/cart.ts",
    ]);
  });

  test("entry から到達しないなら null", () => {
    const moduleGraph = createGraph({ "src/islands/CartBadge.tsx": ["src/browser/cart.ts"] }, [
      "src/server/entry.ts",
    ]);
    expect(findServerReachPath(moduleGraph, "src/browser/cart.ts")).toBe(null);
  });

  test("循環があっても停止する", () => {
    const moduleGraph = createGraph({ a: ["b"], b: ["a", "browser"] }, ["entry"]);
    expect(findServerReachPath(moduleGraph, "browser")).toBe(null);
  });

  test("dynamic importer も server 到達経路として辿る", () => {
    const moduleGraph = {
      getModuleInfo: (id: string) => {
        if (id === "browser") {
          return { id, isEntry: false, importers: [], dynamicImporters: ["entry"] };
        }
        if (id === "entry") {
          return { id, isEntry: true, importers: [], dynamicImporters: [] };
        }
        return null;
      },
    };
    expect(findServerReachPath(moduleGraph, "browser")).toEqual(["entry", "browser"]);
  });

  test("graph に存在しない target は null", () => {
    expect(findServerReachPath({ getModuleInfo: () => null }, "missing")).toBe(null);
  });

  test("dynamicImporters を省略した ModuleInfo も辿れる", () => {
    const info: Record<string, { id: string; isEntry: boolean; importers: string[] }> = {
      browser: { id: "browser", isEntry: false, importers: ["entry"] },
      entry: { id: "entry", isEntry: true, importers: [] },
    };
    expect(findServerReachPath({ getModuleInfo: (id) => info[id] ?? null }, "browser")).toEqual([
      "entry",
      "browser",
    ]);
  });

  test("診断は到達経路をすべて表示する", () => {
    const message = formatReachError([
      "src/server/entry.ts",
      "src/routes/products.tsx",
      "src/islands/CartBadge.tsx",
      "src/browser/cart.ts",
    ]);
    expect(message).toContain("client-only module reached from server bundle");
    expect(message).toContain("src/server/entry.ts");
    expect(message).toContain("src/islands/CartBadge.tsx");
    expect(message).toContain("src/browser/cart.ts");
  });

  test("単一要素の診断も安全に整形する", () => {
    const message = formatReachError(["src/browser/cart.ts"]);
    expect(message).toContain("src/browser/cart.ts");
    expect(message).not.toContain("← client-only");
  });
});
