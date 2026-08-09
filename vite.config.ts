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
  /**
   * リポジトリをまたぐタスクの正本。人間向けの入口は justfile に置き、
   * package 固有の処理は各 package.json、Deno 固有の処理は deno.json に置く。
   * justfile と workflow には手順を複製せず、ここか package の単一タスクを呼ばせる。
   */
  run: {
    tasks: {
      build: {
        command: "node scripts/build-package.mjs",
        input: [
          "src/**",
          "scripts/build-package.mjs",
          "package.json",
          "pnpm-lock.yaml",
          "tsconfig.json",
          "vite.config.ts",
        ],
        output: ["dist/**"],
      },
      bench: {
        command: [
          "node scripts/run-benchmarks.mjs benchmarks/baseline.node24.json",
          "node scripts/compare-benchmarks.mjs benchmarks/baseline.node24.json benchmarks/current.json",
        ],
        cache: false,
      },
      "package:check": {
        command: [
          "node scripts/check-bundle-sizes.mjs",
          "node scripts/check-package.mjs",
          "node scripts/check-vite-peer.mjs",
        ],
        dependsOn: ["build"],
        input: [
          "dist/**",
          "scripts/check-bundle-sizes.mjs",
          "scripts/check-package.mjs",
          "scripts/check-vite-peer.mjs",
          "package.json",
          "pnpm-lock.yaml",
          "tsconfig.json",
        ],
        output: [],
      },
      "demo:check": {
        command: [
          "vp run @zogan/shop#build",
          "vp run @zogan/shop#cf-typegen:check",
          "vp run @zogan/shop#test",
        ],
        dependsOn: ["build"],
        cache: false,
      },
      "deploy:check": {
        command: [
          "vp run @zogan/site#build",
          "vp run @zogan/site#deploy:dry",
          "vp run @zogan/shop#build",
          "vp run @zogan/shop#deploy:dry",
        ],
        dependsOn: ["build"],
        cache: false,
      },
      "deploy:demo:prepare": {
        command: ["node scripts/validate-deployment-config.mjs", "vp run @zogan/shop#build"],
        dependsOn: ["build"],
        cache: false,
      },
      "deps:check": {
        command: "pnpm outdated --recursive",
        cache: false,
      },
      "ci:quality": {
        command: [
          "vp check",
          "vp test run --coverage",
          "vp run package:check",
          "vp run @zogan/site#build",
          "vp run demo:check",
          "vp run bench",
        ],
        dependsOn: ["build"],
        cache: false,
      },
      "ci:browser": {
        command: [
          "vp run @zogan/site#e2e",
          "vp run @zogan/shop#e2e",
          "vp run @zogan/deno-example#e2e",
          "vp run @zogan/site#deploy:dry",
          "vp run @zogan/shop#deploy:dry",
        ],
        dependsOn: ["build"],
        cache: false,
      },
      "ci:deno": {
        command: [
          "deno install --frozen --lockfile-only",
          "vp run build",
          "deno task deno:check",
          "deno task deno:test",
          "node scripts/check-deno-package.mjs",
          "deno task deno:example:build",
          "node scripts/check-deno-contract.mjs",
          "deno task deno:jsr",
          "vp run @zogan/deno-example#e2e",
        ],
        cache: false,
      },
      "ci:node-current": {
        command: ["vp run build", "vp test run", "node scripts/check-vite-peer.mjs"],
        cache: false,
      },
    },
  },
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
