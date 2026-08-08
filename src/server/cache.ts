/**
 * キャッシュ規則の照合（§4.2.1 / §5.5）。純粋な文字列判定に閉じている。
 */

/**
 * 共有キャッシュ（CDN・プロキシ）が保持しうる応答か。
 * §5.5.2 の判定そのもの：未指定、または no-store / private のいずれも無ければ「保持しうる」。
 */
export const cacheControlDirectives = (cacheControl: string | null): ReadonlySet<string> => {
  const directives = new Set<string>();
  if (cacheControl === null) return directives;
  let token = "";
  let quoted = false;
  for (const character of `${cacheControl},`) {
    if (character === '"') quoted = !quoted;
    if (character !== "," || quoted) {
      token += character;
      continue;
    }
    const name = token.trim().split("=", 1)[0]?.trim().toLowerCase();
    if (name) directives.add(name);
    token = "";
  }
  return directives;
};

export const hasCacheControlDirective = (cacheControl: string | null, name: string): boolean =>
  cacheControlDirectives(cacheControl).has(name.toLowerCase());

export const isCacheableBySharedCache = (cacheControl: string | null): boolean =>
  !hasCacheControlDirective(cacheControl, "no-store") &&
  !hasCacheControlDirective(cacheControl, "private");

export const isHtmlContentType = (contentType: string | null): boolean =>
  contentType?.split(";", 1)[0]?.trim().toLowerCase() === "text/html";

const SCRIPT_TAG = /<script\b[^>]*>/gi;

/**
 * 応答本文に Store snapshot が含まれるか。
 *
 * <StoreSnapshot> を経由しない手書きの <script data-store> も捕まえるため、
 * 出力側のフラグではなく本文の走査で判定する（§5.5.2）。
 */
export const containsStoreSnapshot = (body: string): boolean => {
  SCRIPT_TAG.lastIndex = 0;
  for (let m = SCRIPT_TAG.exec(body); m !== null; m = SCRIPT_TAG.exec(body)) {
    const tag = m[0].toLowerCase();
    if (!tag.includes("data-store")) continue;
    if (/type\s*=\s*["']?application\/json/.test(tag)) return true;
  }
  return false;
};

/** Vary は上書きではなく追加。ハンドラが書いた Cookie を潰さない（§4.4） */
export const appendVary = (current: string | null, value: string): string => {
  const existing = (current ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
  if (existing.some((v) => v.toLowerCase() === value.toLowerCase())) return existing.join(", ");
  return [...existing, value].join(", ");
};

/**
 * ヘッダを書き換える。Response のヘッダが immutable な環境があるため、
 * 失敗したら作り直す。
 */
export const withHeader = (res: Response, name: string, value: string): Response => {
  try {
    res.headers.set(name, value);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    headers.set(name, value);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
};
