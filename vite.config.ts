import { defineConfig } from "vite-plus";

/**
 * サーバ側とクライアント側で必要な環境が違うため project を分ける。
 * client は jsdom を使う。<template> による <tr>/<option> の往復が
 * happy-dom では実装差があるため（§3.3.3 が要求する挙動）。
 *
 * テストは 'zogan' / 'zogan/client' を自己参照 import で解決する。
 * package.json の exports がそのまま検証対象になる。
 */
export default defineConfig({
  // 仕様書は原文のまま保つ。整形の対象にしない
  fmt: {
    ignorePatterns: [
      "docs/spec/**",
      "examples/shop/src/worker-configuration.d.ts",
      "examples/site/index.html",
    ],
  },
  // 型検査も vp check で回す（oxlint-tsgolint）
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/contracts.ts", "src/**/index.ts"],
      reporter: ["text", "json", "html"],
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 95,
        branches: 90,
        "src/server/cache.ts": {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 100,
        },
        "src/server/middleware.ts": {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 100,
        },
        "src/client/store.ts": {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 100,
        },
        "src/client/fragments.ts": {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 100,
        },
        "src/vite/client-only.ts": {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 100,
        },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: [
            "tests/server/**/*.test.ts?(x)",
            "tests/tooling/**/*.test.ts?(x)",
            "tests/vite/**/*.test.ts?(x)",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          include: ["tests/client/**/*.test.ts?(x)", "tests/acceptance/**/*.test.ts?(x)"],
        },
      },
    ],
  },
});
