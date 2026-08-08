/**
 * <StoreSnapshot>（§5.2.1 / 付録 A.1.6）。
 *
 * 存在理由はエスケープを 1 箇所に閉じ込めること。手で
 * <script type="application/json"> を書かないこと。
 *
 * 【不変条件・§5.5】このコンポーネントを含む応答は Cache-Control に
 * no-store を持たなければならない。照合は zogan() ミドルウェアが行う。
 */
import { h, type VNode } from "preact";
import { isValidIdentifier } from "./markers.ts";

export const STORE_SNAPSHOT_SELECTOR = 'script[type="application/json"][data-store]';

/** Props accepted by {@link StoreSnapshot}. */
export interface StoreSnapshotProps<T extends { version: number }> {
  /** clientStore() の登録名と一致すること */
  name: string;
  /** Versioned, JSON-serializable server state. */
  data: T;
}

/**
 * <script> の中身は raw text で、終端条件は "</script" の出現だけ。
 * < が 1 つも無ければ </script は現れない。ゆえに < だけを変換すれば足りる。
 * & や " を変換すると JSON が壊れる（§5.2.1）。
 */
export const serializeSnapshot = (data: unknown): string =>
  JSON.stringify(data).replaceAll("<", "\\u003c");

/** Serializes versioned server state for a matching client store. */
// oxlint-disable-next-line no-explicit-any
export function StoreSnapshot<T extends { version: number }>(
  props: StoreSnapshotProps<T>,
): VNode<any> {
  if (!isValidIdentifier(props.name)) {
    throw new Error(
      `zogan: invalid store name ${JSON.stringify(props.name)}. ` +
        "must match ^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$ (§5.2.1)",
    );
  }
  return h("script", {
    type: "application/json",
    "data-store": props.name,
    dangerouslySetInnerHTML: { __html: serializeSnapshot(props.data) },
  });
}
