import { defineConfig } from "vite-plus";
import { tasks } from "./vite.tasks.ts";

/**
 * サーバ側とクライアント側で必要な環境が違うため project を分ける。
 * client は jsdom を使う。<template> による <tr>/<option> の往復が
 * happy-dom では実装差があるため。
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
    tasks,
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
    categories: {
      correctness: "error",
      // Experimental rules are intentionally gated as errors: a rule upgrade must
      // be reviewed instead of silently weakening the repository policy.
      nursery: "error",
      pedantic: "error",
      perf: "error",
      // The restriction category contains mutually exclusive policy rules
      // (for example no-ternary and prefer-ternary), so strict rules from it
      // are selected individually below instead of enabling it wholesale.
      restriction: "off",
      // Oxfmt is the single formatting authority. Oxlint's style category also
      // contains competing API preferences, so it is not duplicated here.
      style: "off",
      suspicious: "error",
    },
    // `no-undef` is useful only when each runtime receives its actual globals.
    // Start from ECMAScript built-ins and add Node/browser/worker scopes below.
    env: {
      builtin: true,
    },
    ignorePatterns: [
      "coverage/**",
      "dist/**",
      "examples/**/dist/**",
      "examples/shop/src/worker-configuration.d.ts",
    ],
    // Enable every native plugin relevant to this Hono/Preact/Vitest package.
    // Jest, Next.js, Vue, and React-specific memo-allocation heuristics do not
    // model this stack and would introduce false framework assumptions.
    plugins: [
      "eslint",
      "import",
      "jsdoc",
      "jsx-a11y",
      "node",
      "oxc",
      "promise",
      "react",
      "typescript",
      "unicorn",
      "vitest",
    ],
    options: {
      denyWarnings: true,
      maxWarnings: 0,
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["tests/**/*.{ts,tsx}", "examples/**/e2e/**/*.ts", "examples/**/tests/**/*.ts"],
        // Async test doubles deliberately preserve Promise-returning interfaces,
        // while callback assertions often return matcher/cleanup void values.
        rules: {
          "eslint/no-promise-executor-return": "off",
          "eslint/require-await": "off",
          "typescript/no-confusing-void-expression": "off",
          // Fixtures assert DOM nodes they just constructed and deliberately
          // exercise undefined/cyclic inputs; these assertions stay test-only.
          "typescript/no-non-null-assertion": "off",
          "typescript/require-await": "off",
          "typescript/no-unsafe-type-assertion": "off",
          "typescript/strict-void-return": "off",
          "unicorn/no-immediate-mutation": "off",
          "unicorn/no-useless-undefined": "off",
          // Error-path tests sometimes branch solely to capture thrown messages.
          "vitest/no-conditional-in-test": "off",
          "vitest/require-mock-type-parameters": "off",
        },
      },
      {
        files: ["scripts/**/*.mjs"],
        env: {
          node: true,
        },
        rules: {
          // Command-line validators report their successful result to stdout.
          "eslint/no-console": "off",
          "typescript/no-unsafe-argument": "off",
          "typescript/no-unsafe-assignment": "off",
          "typescript/no-unsafe-call": "off",
          "typescript/no-unsafe-member-access": "off",
          "typescript/no-unsafe-return": "off",
        },
      },
      {
        files: ["**/*.d.ts"],
        rules: {
          // Ambient module declarations cannot place imports inside the declared
          // module, so inline import() types are the least leaky representation.
          "typescript/consistent-type-imports": "off",
        },
      },
      {
        files: [
          "vite.config.ts",
          "vite.tasks.ts",
          "**/*.config.ts",
          "src/vite/**/*.ts",
          "tests/server/**/*.{ts,tsx}",
          "tests/tooling/**/*.ts",
          "tests/vite/**/*.ts",
          "tests/helpers/**/*.ts",
          "benchmarks/**/*.{ts,tsx}",
        ],
        env: {
          node: true,
        },
      },
      {
        files: [
          "src/client/**/*.ts",
          "tests/client/**/*.{ts,tsx}",
          "tests/acceptance/**/*.{ts,tsx}",
          "tests/fixtures/**/*.{ts,tsx}",
          "examples/**/e2e/**/*.ts",
          "examples/deno/src/**/*.{ts,tsx}",
          "examples/shop/src/islands/**/*.{ts,tsx}",
          "examples/site/src/**/*.ts",
          "benchmarks/client.bench.ts",
        ],
        env: {
          browser: true,
        },
      },
      {
        files: [
          "examples/deno/server.tsx",
          "examples/deno/tests/**/*.{ts,tsx}",
          "tests/deno/**/*.{ts,tsx}",
        ],
        env: {
          worker: true,
        },
        globals: {
          Deno: "readonly",
        },
        rules: {
          "typescript/no-unsafe-type-assertion": "off",
        },
      },
      {
        files: ["examples/shop/src/**/*.{ts,tsx}", "examples/shop/tests/**/*.{ts,tsx}"],
        env: {
          worker: true,
        },
      },
      // The Cloudflare demo is kept as an integration fixture. Its platform
      // adapters intentionally accept nullable request/config values, so only
      // the exact files and rules that model those boundaries are exempted.
      {
        files: ["examples/shop/src/repository/shop-repository.ts"],
        rules: {
          "eslint/require-await": "off",
          "typescript/no-unnecessary-condition": "off",
          "typescript/strict-boolean-expressions": "off",
        },
      },
      {
        files: ["examples/shop/src/worker.tsx"],
        rules: {
          "typescript/prefer-nullish-coalescing": "off",
          "typescript/strict-boolean-expressions": "off",
        },
      },
      {
        files: ["examples/shop/src/islands/AddToCart.tsx", "examples/shop/playwright.config.ts"],
        rules: {
          "typescript/strict-boolean-expressions": "off",
        },
      },
      {
        files: ["examples/shop/src/presentation/views.tsx"],
        rules: {
          "react/checked-requires-onchange-or-readonly": "off",
          "typescript/strict-boolean-expressions": "off",
        },
      },
      {
        files: ["examples/shop/vite.config.ts"],
        rules: {
          "typescript/no-deprecated": "off",
        },
      },
      {
        files: ["examples/shop/vitest.config.ts"],
        rules: {
          "unicorn/prefer-import-meta-properties": "off",
        },
      },
      // The static site's copy helper retains execCommand strictly as a legacy
      // fallback. Its DOM event shorthands are isolated from the library runtime.
      {
        files: ["examples/site/src/main.ts"],
        rules: {
          "typescript/no-confusing-void-expression": "off",
          "typescript/no-deprecated": "off",
          "typescript/strict-boolean-expressions": "off",
        },
      },
    ],
    rules: {
      "import/no-cycle": "error",
      // These size limits encode arbitrary refactoring preferences, not safety
      // or correctness. Complexity and runtime hazards remain enabled.
      "eslint/max-classes-per-file": "off",
      "eslint/max-lines": "off",
      "eslint/max-lines-per-function": "off",
      "no-alert": "error",
      // Library and test code must not leak ad-hoc logs. Runtime diagnostics are
      // deliberately warnings so enhancement failures preserve their fallback.
      "no-console": ["error", { allow: ["warn"] }],
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "react/button-has-type": "error",
      "react/exhaustive-deps": "error",
      "react/react-in-jsx-scope": "off",
      "react/rules-of-hooks": "error",
      // Applying readonly to every callback parameter is incompatible with
      // Hono/Preact callback types and would churn the public API without
      // preventing mutation inside those frameworks.
      "typescript/prefer-readonly-parameter-types": "off",
      "typescript/no-explicit-any": "error",
      "typescript/no-floating-promises": "error",
      "typescript/consistent-type-imports": "error",
      "typescript/no-import-type-side-effects": "error",
      "typescript/no-misused-promises": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-unsafe-argument": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-call": "error",
      "typescript/no-unsafe-member-access": "error",
      "typescript/no-unsafe-return": "error",
      // The protocol intentionally uses raw data-* names and distinguishes
      // missing attributes from empty values; getAttribute is clearer here.
      "unicorn/prefer-dom-node-dataset": "off",
      "import/no-duplicates": "error",
      // Adding `u` changes regexp parsing and matching semantics. Unicode-aware
      // expressions are chosen case by case instead of rewritten globally.
      "eslint/require-unicode-regexp": "off",
      // TypeScript already carries parameter and return types. Repeating them
      // in JSDoc creates a second, drift-prone type system; all other JSDoc
      // validity rules remain enabled through the native plugin.
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      // Comma expressions obscure control flow and are never required here.
      "eslint/no-sequences": "error",
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
          statements: 95,
          lines: 95,
          functions: 100,
          branches: 95,
        },
        "src/server/zogan.ts": {
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
          branches: 90,
        },
        "src/vite/islands-entry.ts": {
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
