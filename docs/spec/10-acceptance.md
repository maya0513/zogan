# §10 Acceptance criteria

The implementation is accepted only when the following automated gates pass. Counts are intentionally omitted; commands and invariants are stable, while test counts are not.

## 10.1 Public contract

- [ ] `zogan(app, options)` preserves Hono `Env`, bindings, variables, schema, and base-path types.
- [ ] Two Hono apps with different `fragmentPrefix` values cannot affect each other.
- [ ] Server, client, and Vite entries expose only documented names; marker, renderer, registry, and graph helpers are not public.
- [ ] `hono`, `preact`, and `@preact/signals` are mandatory peers; Vite 8 is optional; `preact-render-to-string` is an implementation dependency.
- [ ] A packed tarball passes publint, Are The Types Wrong, JavaScript imports, type imports, and peer dependency contract checks.

## 10.2 HTTP and cache safety

- [ ] Full and partial page responses both contain `Vary: X-Partial`.
- [ ] Successful page and Fragment responses require an explicit `Cache-Control`; production falls back to `private, no-store` when missing.
- [ ] A snapshot in a successful HTML GET/HEAD requires an exact `no-store` directive. Similar tokens such as `no-storehouse` are rejected.
- [ ] Public responses never contain a user snapshot; private snapshot responses use `private, no-store` and the necessary `Vary` key.
- [ ] Redirects use manual mode and are never inserted into the DOM.
- [ ] Non-HTML, external-origin, malformed-prefix, and header/body-mismatched responses are rejected before DOM mutation.
- [ ] `HEAD` follows the same cache contract without requiring a readable body.

## 10.3 Client concurrency and forms

- [ ] Rapid navigations apply only the newest response.
- [ ] One canonical Fragment URL produces one in-flight request and fans out to every matching connected Island.
- [ ] Removing an Island during Fragment or component loading prevents delayed hydration.
- [ ] Store snapshots apply only when their numeric version is newer; application optimistic state remains separate.
- [ ] Form enhancement preserves the submitter, duplicate fields, GET query values, `enctype`, and a submit control sharing a name with another field.
- [ ] Forms without enhancement attributes remain native. A failed enhanced response resubmits through the native browser path.
- [ ] Replace navigation restores focus and scroll; append/prepend does not steal focus. Missing View Transition support uses direct DOM mutation.

## 10.4 Workers demonstration

- [ ] Workerd + D1 tests prove cookie-scoped user isolation, monotonic cart version conflict handling, inventory refusal, snapshot non-leakage, and cache headers.
- [ ] With JavaScript enabled, Playwright completes filtering/paging, partial navigation, optimistic cart update, back/forward, and simulated checkout.
- [ ] With JavaScript disabled, Playwright completes browsing, cart addition, and simulated checkout using ordinary HTML and forms.
- [ ] Wrangler binding types are current, the production build succeeds, and `wrangler deploy --dry-run` succeeds. No live deploy is performed.

## 10.5 Quality and reproducibility

- [ ] Overall coverage is at least 95% statements/lines/functions and 90% branches.
- [ ] Cache leakage, middleware boundary, Store, Fragment URL/fan-out, and client-only reachability files meet 100% in every coverage metric.
- [ ] Node 26 benchmark medians do not regress more than 20% from the committed baseline.
- [ ] Gzip sizes do not exceed client 12 KiB, server 7 KiB, and Vite plugin 5 KiB.
- [ ] `just ci`, demo integration tests, and Playwright pass.
- [ ] Stable dependency versions are checked against the registry immediately before the lockfile is finalized.

## 10.6 Deno and JSR

- [ ] Deno 2.9+ type-checks and runs full HTML, Partial, Fragment, Store snapshot, and cache-contract tests while preserving Hono generics.
- [ ] `zogan/client` can be imported without a DOM, and all three public entry points pass `deno check`.
- [ ] A packed npm tarball can be imported, type-checked, and executed by a temporary Deno consumer.
- [ ] The npm and JSR manifests have the same version and documented entry points; JSR includes only source, README files, and LICENSE.
- [ ] `deno publish --dry-run` and documentation linting pass under the documented Hono augmentation constraint.
- [ ] The Deno example builds through Vite, contains no Node-only browser import, serves full/Partial/asset requests, and passes Playwright with JavaScript enabled and disabled.
- [ ] `just deno-ci` passes independently of `just ci`.

The high-risk failures are cross-user state, cacheable snapshots, stale write acceptance, and redirect/body insertion. They require regression tests at their actual boundary rather than a unit test of a nearby helper.
