# Quality report

Measurements in this report are reproducible from the repository. Generated reports and current benchmark output are not treated as source-of-truth; commands fail when committed gates are missed.

## Test coverage

Command: `pnpm run coverage`

| Metric     | Measured | Required |
| ---------- | -------: | -------: |
| Statements |   98.01% |      95% |
| Lines      |   99.16% |      95% |
| Functions  |   99.43% |      95% |
| Branches   |   94.07% |      90% |

Cache enforcement, middleware safety boundaries, Store reconciliation, Fragment URL/fan-out behavior, and client-only reachability each require 100% statements, lines, functions, and branches through per-file thresholds.

## Performance baseline

Command: `pnpm run bench`

Environment: Node 26.6.0 from nixpkgs revision `e72e4f2` dated 2026-08-04. Files run serially; the comparison uses the median of three run medians and fails when it is more than 20% slower than the committed baseline.

| Benchmark                             |      Median |
| ------------------------------------- | ----------: |
| SSR: 100 products and 3 partials      | 0.151257 ms |
| Partial extraction: 10 of 100 markers | 0.006250 ms |
| Snapshot scan: rendered document      | 0.005941 ms |
| DOM replacement: 20 product cards     | 1.099989 ms |
| Store merge: versioned snapshot       | 0.000209 ms |
| Fragment fan-out: 75 of 100 islands   | 0.383043 ms |

The machine-readable source is [`benchmarks/baseline.node26.json`](../benchmarks/baseline.node26.json).

## Published bundle sizes

Command: `pnpm run package:check`

| Entry          | Measured gzip |  Limit |
| -------------- | ------------: | -----: |
| `zogan/client` |     11.69 KiB | 12 KiB |
| `zogan` server |      6.24 KiB |  7 KiB |
| `zogan/vite`   |      3.87 KiB |  5 KiB |

The same command packs the actual tarball, runs publint and Are The Types Wrong, imports every JavaScript entry from the tarball, compiles type imports against it, and verifies optional-peer metadata.

## Runtime and browser verification

- Root unit, contract, and regression tests run with Vitest.
- Workers/D1 integration tests run in Workerd with isolated D1 storage.
- Playwright runs Chromium with JavaScript enabled and disabled.
- `nix flake check --all-systems` evaluates every supported flake system.
- `wrangler deploy --dry-run` validates the demo bundle without deploying it.

## Deno and JSR verification

Command: `just deno-ci`

- Deno 2.9+ checks and executes the server, DOM-free client import, and Vite entry.
- A temporary Deno consumer imports, type-checks, and executes the packed npm tarball.
- The JSR manifest version, export map, npm dependency mappings, source-only publish boundary, and npm/JSR runtime exports are compared automatically.
- `deno publish --dry-run` validates the JSR upload without publishing it. The command permits slow types only because the documented Hono module augmentation is itself classified as a slow type by JSR.
- Deno runs the Vite production build, and the resulting browser bundle is rejected if it contains a Node-only import.
- Playwright verifies soft navigation and Island hydration with JavaScript, plus ordinary navigation without JavaScript.
