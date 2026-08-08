/**
 * zogan() ミドルウェア（付録 A.1.1）。
 *
 * Hono の既存機構（c.setRenderer）にレンダラを差し込むだけで、独自の
 * アプリケーションクラスを作らない。応答を返す直前に §5.5 の照合を行う。
 */
import { h, type VNode } from "preact";
import type { Context, Env, Hono, MiddlewareHandler, Schema } from "hono";
import {
  appendVary,
  containsStoreSnapshot,
  hasCacheControlDirective,
  isHtmlContentType,
  withHeader,
} from "./cache.ts";
import type { ZoganOptions } from "./contracts.ts";
import { extractPartials } from "./markers.ts";
import { renderZogan } from "./render.ts";
import { configureApp, getRouteKind, installRouteMethods } from "./routes.ts";

installRouteMethods();

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

const detectDev = (): boolean => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.NODE_ENV !== "production";
};

/** X-Partial の解釈（§3.2.1）。空白は無視。ヘッダ非在は null = フルページ要求 */
export const parsePartialHeader = (raw: string | null | undefined): string[] | null => {
  if (raw === null || raw === undefined) return null;
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
};

const withDoctype = (html: string): string =>
  /^\s*<html[\s>]/i.test(html) ? `<!DOCTYPE html>${html}` : html;

const createMiddleware = <E extends Env>(
  options: Readonly<ZoganOptions>,
  fragmentPrefix: string,
): MiddlewareHandler<E> => {
  const dev = options.dev ?? detectDev();
  const layout = options.layout;

  const fail = (message: string): void => {
    if (dev) throw new Error(message);
    console.warn(message);
  };

  return async (c, next) => {
    const raw = c.req.header("X-Partial");
    const partials = parsePartialHeader(raw);
    if (raw !== undefined && partials !== null && partials.length === 0) {
      // 空文字列の X-Partial は不正（§3.2.1）。黙って通さない
      return c.text("zogan: X-Partial must not be empty", 400);
    }
    Object.defineProperty(c.req, "partials", { value: partials, configurable: true });

    c.setRenderer(((vnode: VNode) => {
      const kind = getRouteKind(c as unknown as Context) ?? "page";
      const wrapped = kind === "page" && layout !== undefined ? h(layout, null, vnode) : vnode;
      const { html, markerRanges, partialModes } = renderZogan(wrapped, {
        kind,
        dev,
        fragmentPrefix,
      });

      c.header("Content-Type", HTML_CONTENT_TYPE);

      if (kind === "page" && partials !== null) {
        const extracted = extractPartials(html, partials, markerRanges);
        // 実際に返した領域を宣言順で列挙する（§3.2.2）
        c.header("X-Partial", extracted.names.join(","));
        // mode はマーカーに出さないので応答ヘッダで伝える（付録 A.1.5）。既定 replace は省く
        const modes = extracted.names
          .filter((name) => partialModes.has(name))
          .map((name) => `${name}=${partialModes.get(name)!}`);
        if (modes.length > 0) c.header("X-Partial-Mode", modes.join(","));
        return c.body(extracted.body);
      }

      return c.body(kind === "page" ? withDoctype(html) : html);
    }) as never);

    await next();

    const kind = getRouteKind(c as unknown as Context);
    if (kind === undefined && c.req.method !== "GET" && c.req.method !== "HEAD") return;

    let res = c.res;
    const ok = res.status >= 200 && res.status < 300;

    if (kind === "page" && ok) {
      // フルページ応答にも部分応答にも付ける。片方だけでは CDN が分割しない（§3.2.4）
      res = withHeader(res, "Vary", appendVary(res.headers.get("Vary"), "X-Partial"));
    }

    if (kind !== undefined && ok && res.headers.get("Cache-Control") === null) {
      fail(
        `zogan: ${kind} handler for ${c.req.path} must set Cache-Control explicitly ` +
          "(§4.2.1 / §5.5.3). falling back to private, no-store",
      );
      res = withHeader(res, "Cache-Control", "private, no-store");
    }

    res = await guardSnapshotLeak({ method: c.req.method, path: c.req.path }, res, fail);
    c.res = res;
  };
};

/** Configure a Hono app and install zogan's renderer middleware. */
export const zogan = <E extends Env, S extends Schema, BasePath extends string>(
  app: Hono<E, S, BasePath>,
  options: ZoganOptions = {},
): Hono<E, S, BasePath> => {
  installRouteMethods(app);
  const configuration = configureApp(app, options);
  app.use(createMiddleware<E>(configuration.options, configuration.fragmentPrefix));
  return app;
};

/**
 * 【不変条件・§5.5】snapshot を含む応答がキャッシュ可能なら止める。
 *
 * 応答生成時にしか確定しないため、型でもビルドでも防げない。ここだけが実行時の照合。
 * POST 等は共有キャッシュに載らないので対象外。
 */
const guardSnapshotLeak = async (
  req: { method: string; path: string },
  res: Response,
  fail: (message: string) => void,
): Promise<Response> => {
  if (req.method !== "GET" && req.method !== "HEAD") return res;
  if (res.status < 200 || res.status >= 300) return res;
  if (!isHtmlContentType(res.headers.get("Content-Type"))) return res;
  if (res.body === null) return res;

  const body = await res.clone().text();
  if (!containsStoreSnapshot(body)) return res;
  if (hasCacheControlDirective(res.headers.get("Cache-Control"), "no-store")) return res;

  fail(
    `zogan: response for ${req.path} contains a store snapshot without an exact no-store directive ` +
      `(Cache-Control: ${res.headers.get("Cache-Control") ?? "(unset)"}). ` +
      "a snapshot must never ride on a cacheable response (§5.5). forcing private, no-store",
  );
  return withHeader(res, "Cache-Control", "private, no-store");
};
