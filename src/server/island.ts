/**
 * <Island>（§6.1）。
 *
 * このコンポーネントは Island の実体を import しない。受け取るのは name（文字列）と
 * children だけで、名前からコンポーネントへの解決はクライアントの start({ islands }) が行う。
 * この非対称性が §5.3 の不変条件（Store はクライアント専用）を成立させている。
 */
import { h, type ComponentChildren, type VNode } from "preact";
import { isValidComponentName } from "./markers.ts";
import { currentRenderContext, type RenderContext } from "./render.ts";

/** Conditions supported for hydrating an Island. */
export type IslandTrigger = "load" | "idle" | "visible" | "none" | `media:${string}`;

/** Props accepted by {@link Island}. */
export interface IslandProps {
  /** 登録済みコンポーネント名。^[A-Za-z][A-Za-z0-9_]*$ */
  name: string;
  /** JSON 直列化可能な値のみ。秘密や巨大データを入れない（§6.1.1） */
  props?: Record<string, unknown>;
  /** 既定 'load' */
  trigger?: IslandTrigger;
  /**
   * Fragment の取得先 URL（§6.1.5）。単一の URL のみ。
   * 【不変条件・§4.3】値はサーバが SSR 時に書くもののみ。
   */
  fragment?: string;
  /** Server-rendered fallback content. */
  children?: ComponentChildren;
}

const TRIGGER = /^(load|idle|visible|none|media:.+)$/;

/**
 * data-fragment は fragmentPrefix 配下の同一オリジンでなければならない（付録 B.1.1）。
 * クライアント側でも実行時に検証するが、書いた時点で気付けるほうが安い。
 */
const assertFragmentUrl = (ctx: RenderContext, url: string): void => {
  const isRelative = url.startsWith("/");
  const ok = isRelative && url.startsWith(ctx.fragmentPrefix);
  if (ok) return;
  const message = isRelative
    ? `zogan: fragment URL ${JSON.stringify(url)} must start with ${JSON.stringify(ctx.fragmentPrefix)} (§4.3.3)`
    : `zogan: fragment URL ${JSON.stringify(url)} must be a same-origin path under ${JSON.stringify(ctx.fragmentPrefix)} (§4.3.3)`;
  throw new Error(message);
};

/** Declares a server-rendered region that may hydrate on the client. */
// oxlint-disable-next-line no-explicit-any
export function Island(props: IslandProps): VNode<any> {
  const ctx = currentRenderContext();
  const { name, trigger = "load", fragment } = props;

  if (!isValidComponentName(name)) {
    throw new Error(
      `zogan: invalid island name ${JSON.stringify(name)}. must match ^[A-Za-z][A-Za-z0-9_]*$ (§6.1.1)`,
    );
  }
  if (!TRIGGER.test(trigger)) {
    throw new Error(
      `zogan: invalid trigger ${JSON.stringify(trigger)} on island ${JSON.stringify(name)} (§6.1.2)`,
    );
  }
  if (fragment !== undefined) assertFragmentUrl(ctx, fragment);

  // 属性の順序は出力の安定のために固定する
  const attrs: Record<string, unknown> = { "data-island": name };
  // data-props は HTML 属性値。エスケープは Preact に任せる（付録 B.1.2）
  if (props.props !== undefined) attrs["data-props"] = JSON.stringify(props.props);
  attrs["data-trigger"] = trigger;
  if (fragment !== undefined) attrs["data-fragment"] = fragment;

  return h("div", attrs, props.children);
}
