/** Repository-wide Vite+ tasks. Package-specific commands stay in each workspace manifest. */
export const tasks = {
  build: {
    command: "node scripts/build-package.mjs",
    input: [
      "src/**",
      "scripts/build-package.mjs",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "vite.config.ts",
      "vite.tasks.ts",
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
};
