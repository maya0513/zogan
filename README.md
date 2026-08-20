# zogan

[English](README.md) | [日本語](README.ja.md)

> Explicit HTML responses and typed islands for Hono and Preact.

zogan keeps the server-rendered request/response cycle small and visible. Routes explicitly return either a complete Page or raw Fragment HTML, every HTML response carries an opaque CachePolicy, and only declared Islands run in the browser. The browser continues to own links, forms, navigation, and history.

> [!IMPORTANT]
> zogan is pre-release software. Breaking changes may be made before 1.0.

## Why zogan?

Hono already routes Web-standard requests. Preact already renders components. zogan adds a narrow boundary between them without becoming an application framework:

- one URL has one declared representation;
- Page and Fragment routes are ordinary Hono routes;
- every HTML response requires an explicit cache policy;
- FragmentSlot updates only an explicitly marked region;
- typed Islands receive validated JSON props and load lazily;
- links, forms, redirects, and history retain native browser behavior.

Your application owns routes, data access, authorization, mutations, and domain state. zogan owns HTML response factories and the activation of explicit Fragment and Island markers.

## Install

Install zogan with the runtimes shared with your application:

```sh
pnpm add zogan hono preact
```

Install Vite only when using the optional lazy-Island entry generator:

```sh
pnpm add -D vite
```

With Deno 2.9 or later:

```sh
deno add jsr:@maya0513/zogan npm:hono npm:preact
```

The JSR package exposes four entries corresponding to `zogan`, `zogan/client`, `zogan/fragments`, and `zogan/vite` on npm.

## Quick start

Create response helpers once, then use normal Hono routes. The third argument to both `page()` and `fragment()` is mandatory.

```tsx
import type { ComponentChildren } from "preact";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  createZogan,
  defineIsland,
  FragmentSlot,
  Island,
  privateNoStore,
  publicCache,
} from "zogan";
import Counter, { type CounterProps } from "./islands/Counter";

const Layout = ({ children }: { children?: ComponentChildren }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>My app</title>
    </head>
    <body>
      {children}
      <script type="module" src="/src/client.ts" />
    </body>
  </html>
);

const app = new Hono();
const zogan = createZogan({ layout: Layout });
const counter = defineIsland<CounterProps>({ id: "Counter", component: Counter });

app.get("/", (c) =>
  zogan.page(
    c,
    <main>
      <h1>My app</h1>
      <a href="/about">About</a>
      <form action="/search" method="get">
        <input name="q" />
        <button type="submit">Search</button>
      </form>
      <FragmentSlot as="span" src="/fragments/cart-badge">
        <a href="/cart">Cart —</a>
      </FragmentSlot>
      <Island of={counter} props={{ initial: 0 }} trigger="visible" />
    </main>,
    { cache: publicCache({ sMaxAge: 60, staleWhileRevalidate: 300 }) },
  ),
);

app.get("/fragments/cart-badge", (c) => {
  const count = getCookie(c, "cart_count") ?? "0";
  return zogan.fragment(c, <a href="/cart">Cart {count}</a>, {
    cache: privateNoStore({ vary: ["Cookie"] }),
  });
});

export default app;
```

The Fragment endpoint returns only the children that replace the slot contents. It does not return a document or repeat the `<span>` wrapper.

Define the component in `src/islands/Counter.tsx`. `defineIsland()` renders this component on the server and makes its exact props type flow into `<Island>`.

```tsx
import { useState } from "preact/hooks";
import type { JsonObject } from "zogan";

export type CounterProps = JsonObject & {
  readonly initial: number;
};

export default function Counter({ initial }: CounterProps) {
  const [count, setCount] = useState(initial);
  return <button onClick={() => setCount((value) => value + 1)}>Count {count}</button>;
}
```

Configure the optional Vite plugin. The filename stem `Counter` is the lazy-loader ID and must exactly match the server descriptor ID `"Counter"`; the module's default export is the browser component.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { zoganVite } from "zogan/vite";

export default defineConfig({
  plugins: [zoganVite({ islandsDir: "src/islands" })],
});
```

Import the generated entry once from the browser entry. The generated module itself calls `start()` and registers dynamic-import loaders; an Island module is not requested until its trigger fires. The named import and `void` expression below only keep strict no-side-effect-import lint rules satisfied.

```ts
// src/client.ts
import { islands } from "virtual:zogan/islands";
import { startFragments } from "zogan/fragments";

void islands;
startFragments();
```

Add an ambient declaration for the virtual module:

```ts
// src/virtual.d.ts
declare module "virtual:zogan/islands" {
  export const islands: Readonly<Record<string, import("zogan/client").IslandLoader>>;
  export const runtime: import("zogan/client").ClientRuntime;
}
```

Without the Vite plugin, start the browser runtime with an explicit loader map instead:

```ts
import { start } from "zogan/client";

start({ islands: { Counter: () => import("./islands/Counter") } });
```

## The model

| Boundary | Server contract                                                                             | Browser contract                                                    |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Cache    | Construct an opaque `CachePolicy`; pass it to every Page and Fragment response.             | Normal HTTP caching applies; zogan adds no client cache.            |
| Page     | `zogan.page(c, vnode, { cache })` returns a doctype, optional layout, and complete HTML.    | The browser navigates to it normally.                               |
| Fragment | An explicit route returns raw HTML with `zogan.fragment(c, vnode, { cache })`.              | A matching `FragmentSlot` may replace only its own children.        |
| Island   | `defineIsland()` or `defineClientIsland()` declares an ID, mode, component, and props type. | The matching lazy module hydrates or mounts when its trigger fires. |

### CachePolicy

`CachePolicy` is opaque so a route cannot accidentally omit or casually construct its cache behavior.

- `publicCache({ maxAge, sMaxAge, staleWhileRevalidate, immutable, vary })` creates a shared-cache policy. `maxAge` defaults to `0`.
- `privateNoStore({ vary })` produces `private, no-store` for user-specific HTML.
- `cachePolicy(value, { vary })` is the validated escape hatch for other directives.

`Vary` names from a policy are merged case-insensitively with values already present on the Hono context.

### Page and Fragment

`createZogan({ layout })` returns stateless `page` and `fragment` response factories. It does not register routes or modify Hono. A Page uses the optional layout and starts with a doctype; a Fragment is raw HTML and never uses the layout.

Give each Fragment its own root-relative, same-origin URL. `<FragmentSlot>` renders its children as a useful server fallback. The opt-in `zogan/fragments` runtime fetches that URL once on `load`, `idle`, `visible`, or `media:…`; `load` is the default. Fragment responses cannot contain another Fragment or Island marker.

### Typed Island

`defineIsland({ id, component })` uses `hydrate` mode and server-renders `component`. `defineClientIsland({ id, fallback })` uses `mount` mode and server-renders `fallback`. `<Island>` always emits a fixed `<div>` owner.

Island props are required and must be a plain JSON object: nested arrays and plain objects are accepted; cycles, `undefined`, functions, symbols, bigint, non-finite numbers, and class instances are rejected. Activation triggers are `load`, `idle`, `visible`, and `media:…`.

The descriptor checks server rendering and `<Island>` props at compile time. Runtime lookup is intentionally explicit: the descriptor ID must match a registered loader ID, which the Vite plugin derives from each `src/islands/*.tsx` filename.

## Native baseline and failure behavior

zogan does not intercept links or forms and does not manage browser history. Build complete Pages, use ordinary form actions, and use redirects such as POST/Redirect/GET after successful mutations. The application remains usable when JavaScript is disabled.

Fragment and Island enhancement is fail-closed. A bad URL, redirect, non-success status, wrong content type, protocol mismatch, loader error, or render error leaves or restores the server fallback. Nested owners are rejected during server rendering.

An interactive Island can enhance a native form with an application JSON endpoint. When other regions must reflect a successful mutation, navigate to a complete Page and read authoritative server state again. A failed POST cannot distinguish a pre-commit failure from a lost response after commit, so never replay the native form automatically after dispatch:

```ts
try {
  const response = await updateApplicationState();
  if (!response.ok) throw new Error(`unexpected response ${response.status}`);
  location.assign("/cart");
} catch {
  showReloadRequired();
}
```

## Examples

- [Introduction site](examples/site) — the Cache, Page, Fragment, and Island model at a glance.
- [Workers + D1 shop](examples/shop) — public product Pages, private cart HTML, native filtering and mutation flows, and an optional Add-to-Cart Island.
- [Deno example](examples/deno) — explicit Page and Fragment routes plus a hydrated Island. [Live demo](https://zogan-deno.maya0513.deno.net)

## Documentation

- [Specification](docs/spec/README.md)
- [Public API](docs/spec/appendix-a-api.md)
- [HTTP and DOM contract](docs/spec/appendix-b-markup.md)

## Compatibility

- Hono `>=4.13.0 <5`
- Preact `>=10.29.8 <11`
- Vite `^8.0.0` when using `zogan/vite` (optional)
- Deno 2.9+ for the JSR package and Deno example
- Node.js 24.11+ for npm development and packaging
- standards-based server runtimes supported by Hono
- ESM only

`hono` and `preact` are peer dependencies. `vite` is an optional peer dependency. `preact-render-to-string` is installed as zogan's internal rendering dependency.

## License

[MIT](LICENSE)
