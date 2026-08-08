/**
 * <Partial>（§3）。囲むだけでその範囲が差し替え可能になる。
 * 意味論は Fresh の同名コンポーネントと同じ（§12.1）。
 */
import { Fragment, h, options, type ComponentChildren, type VNode } from "preact";
import { isValidIdentifier } from "./markers.ts";
import { currentRenderContext, partialSentinel } from "./render.ts";

/** How a partial response is applied to the current marker range. */
export type PartialMode = "replace" | "append" | "prepend";

/** Props accepted by {@link Partial}. */
export interface PartialProps {
  /** 領域名。^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$（§3.1.1） */
  name: string;
  /** 既定 'replace' */
  mode?: PartialMode;
  /** mode が append/prepend のとき必須（§3.4.1） */
  key?: string | number;
  /** Renderable content inside the partial boundary. */
  children?: ComponentChildren;
}

/** key は Preact の予約 prop で props に届かないため、vnode から拾い直す（付録 A.1.5） */
const KEY_SLOT = "__zoganKey";

/** Marks a named page region that can be replaced by a partial response. */
// oxlint-disable-next-line no-explicit-any
export function Partial(props: PartialProps): VNode<any> {
  const ctx = currentRenderContext();
  const { name, mode = "replace" } = props;

  if (ctx.kind === "fragment") {
    throw new Error(
      `zogan: <Partial name="${name}"> cannot be rendered inside a fragment response (§4.2.2)`,
    );
  }
  if (!isValidIdentifier(name)) {
    throw new Error(
      `zogan: invalid partial name ${JSON.stringify(name)}. ` +
        "must match ^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$ and be 64 chars or less (§3.1.1)",
    );
  }
  if (ctx.seenPartials.has(name)) {
    throw new Error(
      `zogan: duplicate partial name ${JSON.stringify(name)} in one document (§3.1.1)`,
    );
  }
  ctx.seenPartials.add(name);
  if (mode !== "replace") ctx.modes.set(name, mode);

  if (mode !== "replace") {
    const key = (props as unknown as Record<string, unknown>)[KEY_SLOT];
    if (key === undefined || key === null || key === "") {
      const message =
        `zogan: <Partial name="${name}" mode="${mode}"> requires a stable key (§3.4.1). ` +
        "without it Preact cannot tell old and new children apart";
      // 本番で例外にしない。壊れた描画のほうが真っ白な画面よりマシ（§3.4.1）
      if (ctx.dev) throw new Error(message);
      console.warn(message);
    }
  }

  return h(Fragment, null, [
    partialSentinel(ctx, name, false),
    props.children,
    partialSentinel(ctx, name, true),
  ]);
}

// key は createElement の時点で vnode へ抜き出されるので、props へ写しておく
const previousVNodeHook = options.vnode?.bind(options);
options.vnode = (vnode) => {
  if (vnode.type === Partial && vnode.key != null) {
    (vnode.props as Record<string, unknown>)[KEY_SLOT] = vnode.key;
  }
  previousVNodeHook?.(vnode);
};
