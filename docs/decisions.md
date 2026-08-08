# Design decisions

This record explains implementation choices that materially affect zogan's public contract. The specification remains authoritative.

## Application setup and configuration ownership

The public setup API is `zogan(app, options)`. It installs the renderer middleware and associates options with that specific Hono instance. A `WeakMap` keyed by the app owns `fragmentPrefix` and other configuration; no module-global application configuration exists. This prevents two Hono apps in the same isolate from changing each other's fragment routes.

Hono's `Env`, schema, and base-path generics are preserved by the return type. `PageHandler`, `FragmentHandler`, and renderer contracts are compile-tested.

## Public contract and implementation boundary

The three public entries are `zogan`, `zogan/client`, and `zogan/vite`. They expose only the documented components, functions, and types. Marker parsing, renderer internals, import graph helpers, protocol parsing, registries, and test resets stay in implementation modules. Implementations may be regenerated or reorganized without changing the contract layer.

## Dependency classification

- `hono`, `preact`, and `@preact/signals` are mandatory peers and development dependencies. The host application and zogan must use compatible shared runtime instances and types.
- `preact-render-to-string` is a normal dependency because zogan imports it internally to implement SSR; applications should not need to install it directly.
- Vite 8 is an optional peer. Only consumers of `zogan/vite` require it; earlier Vite majors are outside the compatibility contract.
- Tooling versions are pinned through `package.json` and `pnpm-lock.yaml`; pre-release versions are not selected.

## Rendering markers

Preact's string renderer cannot emit raw sibling comments through an ordinary component. SSR therefore emits render-scoped nonce sentinels, converts only matching sentinels to HTML comments, and strips unmatched control sequences. Marker ranges are parsed once and reused for partial extraction and snapshot checks.

Partial modes travel in `X-Partial-Mode`; HTML markers remain limited to ordered region boundaries.

## HTTP safety boundary

Cache-Control is parsed as directives, not substring-matched text. A successful HTML GET/HEAD containing a store snapshot requires an exact `no-store` directive. Development throws; production replaces the policy with `private, no-store` and warns.

Fragment, navigation, and form responses are validated for same origin, normalized prefix, manual redirects, HTML content type, ordered response headers, and body markers before any DOM mutation. Redirects always use `redirect: "manual"`.

## Client state and concurrency

Navigation state, fragment coordination, island activation, and store registration have separate owners. Pure URL/header/body parsing is kept outside mutable registries.

Concurrent refreshes of the same canonical fragment URL share one request and fan out to every connected target. Island hydration receives an activation token; removing or replacing an island invalidates delayed work.

## Vite analysis

Client-only reachability is based on lexer output and the Vite module graph, including named and namespace imports, dynamic imports, and re-export paths. Virtual island entries resolve from Vite's root, use absolute normalized paths internally, and reject ambiguous same-name files.

## Performance gate

Vitest benchmarks cover SSR, partial extraction, snapshot scanning, DOM replacement, Store merge, and fragment fan-out. The committed baseline is measured on Node 26. A median regression greater than 20% fails comparison. This tolerance is intended to catch structural regressions while avoiding ordinary shared-runner noise.

Published gzip limits are 12 KiB for the client, 7 KiB for the server, and 5 KiB for the Vite plugin.

## Workers demonstration

`examples/shop` is a workspace package that separates pure domain code, a D1 repository, Hono/Preact presentation, and client-owned optimistic state. It demonstrates public/private cache headers, cookie-scoped users, monotonic cart versions, full HTML fallback, local migrations and seed data, Workerd integration tests, Playwright flows, production build, and Wrangler dry-run. No deployment command is part of CI.

## README and introduction site

The repository README is the short adoption path, not a second copy of the specification. Its order follows the recurring pattern found in the public documentation of mizchi/similarity, Hono, Ky, Unhead, and esbuild: state the purpose, explain why the project exists, show a minimal runnable path, name the core concepts, and move detailed contracts into dedicated documentation.

`examples/site` is a framework-free Vite build so the introduction can be hosted as static files and does not suggest that zogan requires a documentation framework. It uses the same hierarchy as the README, adds a visual response model, and keeps the Workers + D1 application as a concrete example instead of the main product definition. The source review is recorded in [README and introduction-site precedents](precedents.md).

## Cloudflare deployment

Both public examples deploy as separate Cloudflare Workers. The introduction uses Workers Static Assets rather than the legacy Workers Sites feature or a framework adapter. The demo uses the Cloudflare Vite plugin, Worker SSR, generated Static Assets, and a production D1 binding.

Deployment runs only after the main CI workflow succeeds for a push to `main`, or by explicit manual dispatch. The introduction and demo have separate protected GitHub environments but share a non-cancelling concurrency group. Production D1 migrations run before the demo deployment; seed data remains a one-time manual operation because re-seeding would overwrite mutable inventory. Cloudflare credentials stay in GitHub secrets, while the non-secret D1 resource ID remains in the Wrangler source-of-truth configuration.

## Deno, JSR, and Deno Deploy

Deno 2.9 and later is a supported runtime. The root `deno.json` exposes the same server, client, and Vite entry points from TypeScript source under `@maya0513/zogan`; dependency ranges mirror npm peer compatibility through npm import mappings. `examples/deno` is a workspace member and resolves `zogan` to repository source, so it can be built before the JSR package exists.

The Hono methods and request fields are intentionally expressed as module augmentation so existing `zogan(app); app.page(...)` code remains typed. JSR classifies any ambient module augmentation as a slow type and cannot publish it otherwise. Therefore the JSR dry-run uses `--allow-slow-types` only for this contract; removing the flag would require a breaking API that returns a different app type.

Documentation linting still executes `deno doc --lint` across all three entries. Deno 2.9 reports peer-owned Hono, Preact, Signals, and Vite names as private because they are not re-exported from zogan. Re-exporting those dependencies would violate the deliberately narrow public surface. A strict wrapper accepts only the enumerated `private-type-ref` diagnostics for peer types and fails on missing documentation, missing return types, internal zogan types, or any new diagnostic.

Deno quality checks live in a separate `deno-ci` job and `just deno-ci`; they are not added to the Node `just ci` path. Deno Deploy uses a dynamic runtime configured in the root manifest and the new `deno deploy` CLI. Its GitHub environment and token are isolated from both Cloudflare deployments.
