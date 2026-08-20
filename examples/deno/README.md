# Deno example

This example runs zogan with Deno, Hono, Preact, and Vite. It demonstrates
ordinary full-document navigation, explicit cache policies, a separately cached
FragmentSlot, and typed hydrate and client-only Islands.

```sh
deno task build
deno task start
```

Open <http://localhost:8000>. Pagination remains a native document navigation
with or without JavaScript. The clock uses an explicit `/fragments/clock` route
and is refreshed by the `RefreshClock` Island after it mounts.

Use `deno task dev` for the Vite development server and `deno task test` for the
server integration tests.

The production application is configured from the repository root and is
published to <https://zogan-deno.maya0513.deno.net> by the GitHub repository
connection configured in the Deno web console.
