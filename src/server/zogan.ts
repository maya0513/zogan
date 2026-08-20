import type { Context } from "hono";
import { h, type ComponentChildren, type ComponentType, type VNode } from "preact";
import { render as renderToString } from "preact-render-to-string";
import { renderKind } from "./boundary-context.ts";
import { cachePolicyState, mergeVary, type CachePolicy } from "./cache.ts";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

/** Props received by an optional full-page layout component. */
export interface ZoganLayoutProps {
  /** Page content rendered inside the layout. */
  readonly children?: ComponentChildren;
}

/** Configuration for an isolated zogan response factory. */
export interface ZoganOptions {
  /** Component wrapped around full-page output. Fragments never use it. */
  readonly layout?: ComponentType<ZoganLayoutProps>;
}

/** Required options for every Page or Fragment render. */
export interface ZoganRenderOptions {
  /** Every HTML response must make its cache behavior explicit. */
  readonly cache: CachePolicy;
}

/** Stateless Page and Fragment response factories. */
export interface Zogan {
  /** Render a full document through the optional layout and prepend a doctype. */
  page(c: Context, vnode: VNode, options: ZoganRenderOptions): Response;
  /** Render raw HTML suitable for an explicitly registered fragment route. */
  fragment(c: Context, vnode: VNode, options: ZoganRenderOptions): Response;
}

const respond = (c: Context, html: string, options: ZoganRenderOptions): Response => {
  const assignedResponse = c.finalized
    ? { status: c.res.status, statusText: c.res.statusText }
    : null;
  const policy = cachePolicyState(options.cache);
  const vary = mergeVary(c.res.headers.get("Vary"), policy.vary);

  c.header("Content-Type", HTML_CONTENT_TYPE);
  c.header("Cache-Control", policy.value);
  if (vary !== null) c.header("Vary", vary);
  if (assignedResponse !== null) {
    return new globalThis.Response(html, {
      headers: c.res.headers,
      status: assignedResponse.status,
      statusText: assignedResponse.statusText,
    });
  }
  return c.body(html);
};

/**
 * Create stateless response helpers. Route registration remains ordinary Hono
 * code, so there is no application mutation or hidden request protocol.
 */
export const createZogan = (options: ZoganOptions = {}): Zogan => {
  const layout = options.layout;
  return Object.freeze({
    page(c: Context, vnode: VNode, renderOptions: ZoganRenderOptions): Response {
      const document = layout === undefined ? vnode : h(layout, null, vnode);
      const guarded = h(renderKind.Provider, { value: "page" }, document);
      return respond(c, `<!DOCTYPE html>${renderToString(guarded)}`, renderOptions);
    },
    fragment(c: Context, vnode: VNode, renderOptions: ZoganRenderOptions): Response {
      const guarded = h(renderKind.Provider, { value: "fragment" }, vnode);
      return respond(c, renderToString(guarded), renderOptions);
    },
  });
};
