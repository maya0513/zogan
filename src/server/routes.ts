/**
 * Hono への app.page / app.fragment 拡張（付録 A.1.2 / A.1.3）。
 *
 * 独自のアプリケーションクラスは作らない。Hono のルーターをそのまま使う（§1）。
 */
import { Hono, type Context, type Env, type Schema } from "hono";
import type { ZoganOptions } from "./contracts.ts";

export type ZoganRouteKind = "page" | "fragment";

const KIND_KEY = "__zoganKind";

export const setRouteKind = (c: Context, kind: ZoganRouteKind): void => {
  (c as unknown as { set: (k: string, v: unknown) => void }).set(KIND_KEY, kind);
};

export const getRouteKind = (c: Context): ZoganRouteKind | undefined =>
  (c as unknown as { get: (k: string) => ZoganRouteKind | undefined }).get(KIND_KEY);

export const DEFAULT_FRAGMENT_PREFIX = "/_f/";

export interface AppConfiguration {
  readonly fragmentPrefix: string;
  readonly options: Readonly<ZoganOptions>;
}

const configurations = new WeakMap<object, AppConfiguration>();

export const normalizeFragmentPrefix = (value = DEFAULT_FRAGMENT_PREFIX): string => {
  if (!value.startsWith("/") || value.startsWith("//") || /[?#\\]/.test(value)) {
    throw new TypeError("zogan: fragmentPrefix must be an absolute same-origin path");
  }
  const segments = value.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("zogan: fragmentPrefix must not contain dot segments");
  }
  return `/${segments.join("/")}/`;
};

export const configureApp = (app: object, options: ZoganOptions): AppConfiguration => {
  if (configurations.has(app)) throw new Error("zogan: this Hono app is already configured");
  const configuration = {
    fragmentPrefix: normalizeFragmentPrefix(options.fragmentPrefix),
    options: Object.freeze({ ...options }),
  };
  configurations.set(app, configuration);
  return configuration;
};

export const getAppConfiguration = (app: object): AppConfiguration => {
  const configuration = configurations.get(app);
  if (configuration === undefined) {
    throw new Error("zogan: call zogan(app, options) before registering routes");
  }
  return configuration;
};

let installed = false;

const pageMethod = function (
  this: Hono,
  path: string,
  handler: (c: Context) => Response | Promise<Response>,
): Hono {
  this.get(path, (c) => {
    setRouteKind(c, "page");
    return handler(c);
  });
  return this;
};

const fragmentMethod = function (
  this: Hono,
  name: string,
  handler: (c: Context) => Response | Promise<Response>,
): Hono {
  const path = `${getAppConfiguration(this).fragmentPrefix}${name.replace(/^\//, "")}`;
  this.get(path, (c) => {
    setRouteKind(c, "fragment");
    return handler(c);
  });
  return this;
};

/**
 * Hono のプロトタイプと、zogan() に渡された実体へ route methods を登録する。
 * package manager が同じ Hono を複数実体化しても、対象 app の契約を保証する。
 */
export const installRouteMethods = <E extends Env, S extends Schema, BasePath extends string>(
  app?: Hono<E, S, BasePath>,
): void => {
  if (app === undefined && installed) return;
  if (app === undefined) installed = true;

  const target = (app ?? Hono.prototype) as Hono;
  if (typeof target.page !== "function") {
    target.page = pageMethod as Hono["page"];
  }
  if (typeof target.fragment !== "function") {
    target.fragment = fragmentMethod as Hono["fragment"];
  }
};
