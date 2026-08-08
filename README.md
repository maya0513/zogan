# zogan

[English](README.md) | [日本語](README.ja.md)

> Server-rendered pages with precise update and cache boundaries for Hono and Preact.

zogan keeps the HTML request-response cycle at the center of an application. A page can return a full document, one or more named regions, or an independently cached fragment from the same Hono and Preact code. Browser navigation and islands are progressive enhancements; links and forms continue to work without JavaScript.

> [!IMPORTANT]
> zogan is pre-release software. The public contract is tested, but breaking changes may be made before 1.0.

## Why zogan?

Hono provides routing and Web-standard responses. Preact provides components and hydration. zogan connects the space between them without becoming a router, data loader, or application framework:

- render a full page and named partials through one handler;
- give user-specific and public fragments separate cache policies;
- hydrate only the components that need browser behavior;
- reconcile versioned server state without owning domain logic;
- enhance same-origin links and forms while preserving native fallback.

The application still owns routing, data access, authorization, and cache infrastructure. zogan owns the rendering protocol and validates it before changing the DOM.

## Quick start

Install zogan with the runtimes it shares with your application:

```sh
pnpm add zogan hono preact @preact/signals
pnpm add -D vite
```

With Deno 2.9 or later, install the JSR package and its shared npm runtimes:

```sh
deno add jsr:@maya0513/zogan npm:hono npm:preact npm:@preact/signals
```

The same three entry points are available as `@maya0513/zogan`, `@maya0513/zogan/client`, and `@maya0513/zogan/vite`.

Configure a Hono app and register a page:

```tsx
import { Hono } from "hono";
import { Partial, zogan } from "zogan";

const app = new Hono();

zogan(app, {
  layout: ({ children }) => (
    <html>
      <body data-client-nav>{children}</body>
    </html>
  ),
});

app.page("/articles", (c) => {
  const page = Number(c.req.query("page") ?? 1);
  c.header("Cache-Control", "public, max-age=0, s-maxage=60");

  return c.render(
    <main>
      <Partial name="articles">
        <ArticleList page={page} />
      </Partial>
      <a href={`/articles?page=${page + 1}`} data-partial="articles">
        Next page
      </a>
    </main>,
  );
});

export default app;
```

Start the browser runtime once:

```ts
import { start } from "zogan/client";

start({ islands: {} });
```

The link is an ordinary link until the client starts. After that, zogan requests `articles`, verifies the response contract, and replaces only the marked region.

## The rendering model

```text
ordinary request ────────────────> full HTML document
X-Partial: results ──────────────> named regions from the same page
GET /_f/account-summary ─────────> independently cached HTML fragment
data-island="AccountMenu" ───────> selective Preact hydration
```

### Partial

`<Partial name="results">` marks a region produced by a page handler. Links and GET forms with `data-partial="results"` request that region without introducing a second data-loading path.

### Fragment

`app.fragment()` registers a small HTML endpoint below `/_f/` by default. A fragment has its own `Cache-Control` policy and can be shared by multiple islands with one in-flight request.

```tsx
app.fragment("account-summary", async (c) => {
  const account = await readAccount(c);
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie");
  return c.render(<AccountSummary account={account} />);
});
```

### Island

`<Island>` sends useful server-rendered HTML first, then hydrates a named Preact component on load, idle, visibility, a media query, or an explicit trigger. Component lookup stays in the client entry so client-only code does not have to enter the server graph.

```tsx
<Island name="AccountMenu" fragment="/_f/account-summary" trigger="visible">
  <a href="/account">Account</a>
</Island>
```

```ts
import { start } from "zogan/client";
import AccountMenu from "./islands/AccountMenu";

start({ islands: { AccountMenu } });
```

### Store

`clientStore()` exposes a read-only signal containing the latest server-confirmed value. `<StoreSnapshot>` updates it only when the numeric version increases. Optimistic changes and business rules remain application state.

## Vite integration

The optional Vite plugin generates island entries and prevents client-only store modules from becoming reachable from a server bundle, including through dynamic imports and re-export chains.

```ts
import { defineConfig } from "vite";
import { zoganVite } from "zogan/vite";

export default defineConfig({
  plugins: [zoganVite({ islandsDir: "src/islands" })],
});
```

Vite is optional unless the `zogan/vite` entry is used.

## Failure and cache boundaries

Every successful page and fragment handler sets `Cache-Control` explicitly. Responses containing a store snapshot require an exact `no-store` directive. Before any DOM update, the browser runtime checks origin, redirect behavior, content type, protocol headers, requested markers, and fragment prefix. An invalid enhanced response falls back to ordinary browser behavior.

This is deliberately stricter than a general-purpose HTML fetch helper. See the [HTTP and DOM contract](docs/spec/appendix-b-markup.md) before adding a proxy or cache in front of zogan responses.

## Examples

- [Introduction site](examples/site) — a compact guide to the rendering model and adoption path.
- [Workers + D1 shop](examples/shop) — browsing, filtering, private cart state, simulated checkout, cache policies, and JavaScript-disabled flows.
- [Deno example](examples/deno) — dynamic SSR, partial navigation, a Fragment, an Island, and a Store on Deno. [Live demo](https://zogan-deno.maya0513.deno.net)

## Documentation

- [Specification](docs/spec/README.md)
- [Public API](docs/spec/appendix-a-api.md)
- [HTTP and DOM contract](docs/spec/appendix-b-markup.md)

## Compatibility

- Hono 4.13+
- Preact 10.29+
- `@preact/signals` 2.11+
- Vite 5–8 for `zogan/vite`
- Deno 2.9+ for the JSR package and Deno example
- Node.js 24.11+ for development and packaging
- standards-based server runtimes supported by Hono
- ESM only

`hono`, `preact`, and `@preact/signals` are peer dependencies so zogan and the host application share their runtimes and types. `preact-render-to-string` is an internal implementation dependency and is installed with zogan.

## License

[MIT](LICENSE)
