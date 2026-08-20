# Deno example

This example runs zogan with Deno, Hono, Preact, and Vite. It demonstrates
ordinary full-document navigation, explicit cache policies, a separately cached
FragmentSlot and a typed hydrate Island.

```sh
deno task build
deno task start
```

Open <http://localhost:8000>. Pagination remains a native document navigation
with or without JavaScript. The clock uses an explicit `/fragments/clock` route
and is loaded once by the opt-in Fragment runtime. Without JavaScript, its
server fallback remains useful.

Use `deno task dev` for the Vite development server and `deno task test` for the
server integration tests.

The production application is configured from the repository root and is
published to <https://zogan-deno.maya0513.deno.net> by the GitHub repository
connection configured in the Deno web console.
