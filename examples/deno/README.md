# Deno code sample

This example is intentionally not a deployed website. It is a small, runnable
set of Deno source files showing how to use zogan with Hono and Preact:

- `src/sample.tsx` creates explicit Page and Fragment routes with cache policies.
- `src/islands/PageStatus.tsx` is a typed SSR/hydrate Island component.
- `src/client.ts` starts the Island and opt-in Fragment runtimes explicitly.
- `tests/sample_test.ts` exercises the rendered HTML, cache boundaries,
  representation rules, and app-instance isolation.

Run the sample checks from this directory:

```sh
deno task check
deno task test
```

The same tests run in the repository Deno CI task. The sample is source and
test documentation, not a web deployment target.
