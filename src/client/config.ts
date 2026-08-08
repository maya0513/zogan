/**
 * クライアント側の設定。start() で上書きされる。
 *
 * サーババンドルでも評価できるよう、ここでは document / window に触れない（§7.3.2）。
 */
export const DEFAULT_FRAGMENT_PREFIX = "/_f/";

let fragmentPrefix: string = DEFAULT_FRAGMENT_PREFIX;

export const setFragmentPrefix = (prefix: string): void => {
  if (!prefix.startsWith("/") || prefix.startsWith("//") || /[?#\\]/.test(prefix)) {
    throw new TypeError("zogan: fragmentPrefix must be an absolute same-origin path");
  }
  const segments = prefix.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("zogan: fragmentPrefix must not contain dot segments");
  }
  fragmentPrefix = `/${segments.join("/")}/`;
};

export const getFragmentPrefix = (): string => fragmentPrefix;
