/** Internal nominal brand used to prevent unchecked cache strings. */
const cachePolicyBrand: unique symbol = Symbol("zogan.CachePolicy");

/**
 * An explicitly constructed Cache-Control policy.
 *
 * The brand is intentionally private: rendering helpers accept policies made by
 * this module, never an unchecked string at the call site.
 */
export type CachePolicy = {
  readonly [cachePolicyBrand]: typeof cachePolicyBrand;
};

/** Structured options for shared-cache responses. */
export interface PublicCacheOptions {
  /** Browser freshness in seconds. Defaults to zero. */
  readonly maxAge?: number;
  /** Shared-cache freshness in seconds. */
  readonly sMaxAge?: number;
  /** Shared-cache stale-while-revalidate window in seconds. */
  readonly staleWhileRevalidate?: number;
  /** Mark the representation immutable for its freshness lifetime. */
  readonly immutable?: boolean;
  /** Response header names merged into the existing Vary header. */
  readonly vary?: readonly string[];
}

/** Options shared by private and raw cache policies. */
export interface CachePolicyOptions {
  /** Response header names merged into the existing Vary header. */
  readonly vary?: readonly string[];
}

/** Internal normalized policy state consumed by response factories. */
export interface CachePolicyState {
  /** Validated Cache-Control field value. */
  readonly value: string;
  /** Validated and case-insensitively deduplicated Vary fields. */
  readonly vary: readonly string[];
}

const states = new WeakMap<CachePolicy, CachePolicyState>();
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const isHttpFieldValue = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== 0x09 &&
      (codePoint === undefined || codePoint < 0x20 || codePoint === 0x7f || codePoint > 0xff)
    ) {
      return false;
    }
  }
  return true;
};

const normalizeVary = (tokens: readonly string[] | undefined): readonly string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens ?? []) {
    if (!HTTP_TOKEN.test(token)) {
      throw new TypeError(
        `zogan: Vary token ${JSON.stringify(token)} must be a non-empty HTTP field name without CR/LF`,
      );
    }
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(token);
  }
  return Object.freeze(result);
};

const makePolicy = (value: string, vary?: readonly string[]): CachePolicy => {
  if (/[\r\n]/.test(value)) {
    throw new TypeError("zogan: Cache-Control value must not contain CR or LF");
  }
  if (!isHttpFieldValue(value)) {
    throw new TypeError("zogan: Cache-Control value must be a valid HTTP field value");
  }
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw new TypeError("zogan: Cache-Control value must not be empty");
  }

  const policy: CachePolicy = Object.freeze({ [cachePolicyBrand]: cachePolicyBrand });
  states.set(
    policy,
    Object.freeze({
      value: normalizedValue,
      vary: normalizeVary(vary),
    }),
  );
  return policy;
};

const duration = (name: string, value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`zogan: ${name} must be a finite non-negative integer`);
  }
  return value;
};

/** Build a shared-cache policy. `max-age` deliberately defaults to zero. */
export const publicCache = (options: PublicCacheOptions = {}): CachePolicy => {
  const maxAge = duration("maxAge", options.maxAge) ?? 0;
  const sMaxAge = duration("sMaxAge", options.sMaxAge);
  const staleWhileRevalidate = duration("staleWhileRevalidate", options.staleWhileRevalidate);
  const directives = ["public", `max-age=${maxAge}`];
  if (sMaxAge !== undefined) directives.push(`s-maxage=${sMaxAge}`);
  if (staleWhileRevalidate !== undefined) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidate}`);
  }
  if (options.immutable === true) directives.push("immutable");
  return makePolicy(directives.join(", "), options.vary);
};

/** Build the safe default policy for user-specific HTML. */
export const privateNoStore = (options: CachePolicyOptions = {}): CachePolicy =>
  makePolicy("private, no-store", options.vary);

/**
 * Escape hatch for Cache-Control directives not covered by the typed helpers.
 * Header injection is still rejected.
 */
export const cachePolicy = (value: string, options: CachePolicyOptions = {}): CachePolicy =>
  makePolicy(value, options.vary);

/** Internal accessor used by the response factories. */
export const cachePolicyState = (policy: CachePolicy): CachePolicyState => {
  const state = states.get(policy);
  if (state === undefined) {
    throw new TypeError(
      "zogan: invalid CachePolicy; use publicCache(), privateNoStore(), or cachePolicy()",
    );
  }
  return state;
};

/** Merge Vary values without changing the spelling or order of earlier tokens. */
export const mergeVary = (current: string | null, additions: readonly string[]): string | null => {
  const existing = (current ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");
  if (existing.includes("*") || additions.includes("*")) return "*";

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const token of [...existing, ...additions]) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(token);
  }
  return merged.length === 0 ? null : merged.join(", ");
};
