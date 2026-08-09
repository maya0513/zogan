# Deno example

This example runs zogan with Deno, Hono, Preact, and Vite. It demonstrates full-page rendering, partial navigation, a separately cached Fragment, an Island, and a versioned Store snapshot.

```sh
deno task build
deno task start
```

Open <http://localhost:8000>. Use `deno task dev` for the Vite development server and `deno task test` for the server integration tests.

The production application is configured from the repository root and is published to <https://zogan-deno.maya0513.deno.net> by the GitHub repository connection configured in the Deno web console.
