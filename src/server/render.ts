/**
 * SSR の入口。Preact の描画結果に Partial マーカーを埋め込む。
 *
 * preact-render-to-string はラッパー要素なしに生のコメントを出力できない
 * （Fragment への dangerouslySetInnerHTML は無視される）。そこで <Partial> は
 * 制御文字のセンチネルをテキストとして描画し、描画後に HTML コメントへ置換する。
 *
 * センチネルには 1 回の描画ごとに使い捨てのノンスを埋める。ノンスが無いと、
 * 商品名などの本文に同じ制御文字列を混ぜるだけで偽の領域を作れてしまう
 * （§3.1.1 の検証は name しか守らない）。
 */
import type { VNode } from "preact";
import { render as renderToString } from "preact-render-to-string";
import { findMarkers, type MarkerRange } from "./markers.ts";

/** props の形はページ側が決めるので、ここでは問わない */
// oxlint-disable-next-line no-explicit-any
export type AnyVNode = VNode<any>;

export type RenderKind = "page" | "fragment";

export interface RenderContext {
  readonly kind: RenderKind;
  readonly dev: boolean;
  readonly fragmentPrefix: string;
  /** 1 文書内の Partial 名の重複検出用（§3.1.1） */
  readonly seenPartials: Set<string>;
  /** 領域名 → mode。マーカーには出さず応答ヘッダで伝える（付録 A.1.5） */
  readonly modes: Map<string, string>;
  readonly nonce: string;
}

export interface RenderOptions {
  readonly kind: RenderKind;
  readonly dev: boolean;
  readonly fragmentPrefix: string;
}

export interface RenderResult {
  readonly html: string;
  /** 宣言順の Partial 名。応答ヘッダ X-Partial の素になる */
  readonly partialNames: string[];
  /** 領域名 → mode。既定 replace のものは含まない */
  readonly partialModes: Map<string, string>;
  /** Parsed once during rendering and reused when producing a partial response. */
  readonly markerRanges: readonly MarkerRange[];
}

const SENTINEL_START = "\u0000";
const SENTINEL_END = "\u0001";
// 制御文字そのものが対象。マーカーになりそこねた残骸を落とすための正規表現
// oxlint-disable-next-line no-control-regex
const STRAY_SENTINEL = /[\u0000\u0001]/g;

let current: RenderContext | null = null;

export const currentRenderContext = (): RenderContext => {
  if (current === null) {
    throw new Error(
      "zogan: this component must be rendered through c.render() (zogan middleware not applied?)",
    );
  }
  return current;
};

const newNonce = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export const partialSentinel = (ctx: RenderContext, name: string, closing: boolean): string =>
  `${SENTINEL_START}${ctx.nonce}${closing ? "/" : ""}p:${name}${SENTINEL_END}`;

/**
 * VNode を描画し、センチネルを HTML コメントのマーカーへ変換する。
 * 描画は同期処理なので、コンテキストはこの呼び出しの中でのみ生きる。
 */
export const renderZogan = (vnode: AnyVNode, options: RenderOptions): RenderResult => {
  const ctx: RenderContext = {
    kind: options.kind,
    dev: options.dev,
    fragmentPrefix: options.fragmentPrefix,
    seenPartials: new Set(),
    modes: new Map(),
    nonce: newNonce(),
  };

  const previous = current;
  current = ctx;
  let raw: string;
  try {
    raw = renderToString(vnode);
  } finally {
    current = previous;
  }

  const sentinel = new RegExp(
    `${SENTINEL_START}${ctx.nonce}(/?)p:([A-Za-z][A-Za-z0-9_-]*)${SENTINEL_END}`,
    "g",
  );
  const html = raw
    .replace(sentinel, (_all, closing: string, name: string) => `<!--${closing}p:${name}-->`)
    // ノンス無しの制御文字は本文由来。マーカーになりそこねた残骸を落とす
    .replace(STRAY_SENTINEL, "");

  const markerRanges = findMarkers(html);
  return {
    html,
    partialNames: markerRanges.map((m) => m.name),
    partialModes: ctx.modes,
    markerRanges,
  };
};
