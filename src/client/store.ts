/**
 * Store の base 層（§5.1 / §5.2.3）。
 *
 * framework が持つのは base だけ。pending と applyDeltas はアプリケーションに残す。
 * 楽観差分の形はドメインごとに違うので、抽象化しても当たらない（§5.3.3）。
 */
import { signal, type ReadonlySignal, type Signal } from "@preact/signals";
import { isValidIdentifier } from "../server/markers.ts";
import { collect } from "./dom.ts";
import { readonlyView } from "./signals.ts";

/** Minimum shape required for monotonically merged Store values. */
export interface Versioned {
  /** Monotonically increasing server version. */
  version: number;
}

export const STORE_SELECTOR = 'script[type="application/json"][data-store]';

/** registry が持つのは書き込み可能なハンドル。アプリケーションには読み取り専用ビューだけ渡す */
const registry = new Map<string, Signal<Versioned>>();

/** まだ登録されていない Store の snapshot。clientStore の登録時に引かれる */
const deferred = new Map<string, Versioned>();

/** テスト用。アプリケーションからは呼ばない */
export const __resetStores = (): void => {
  registry.clear();
  deferred.clear();
};

/** version 比較。古い snapshot が届くのは異常系ではなく通常系（§5.1.1） */
const isNewer = (next: Versioned, current: Versioned): boolean => next.version > current.version;

const isVersioned = (value: unknown): value is Versioned =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { version?: unknown }).version === "number";

const applySnapshot = (name: string, snapshot: unknown): void => {
  if (!isVersioned(snapshot)) {
    console.warn(`zogan: store snapshot "${name}" has no numeric version. ignored (§5.1.2)`);
    return;
  }

  const handle = registry.get(name);
  if (handle === undefined) {
    // 未登録。Island の遅延読み込みでは普通に起こる。捨てずに保持する（§5.2.3）
    const held = deferred.get(name);
    if (held === undefined || isNewer(snapshot, held)) deferred.set(name, snapshot);
    return;
  }

  if (!isNewer(snapshot, handle.value)) return;
  handle.value = snapshot;
};

const parseSnapshotElement = (el: Element): unknown => {
  try {
    return JSON.parse(el.textContent ?? "");
  } catch {
    console.warn(
      `zogan: store snapshot "${el.getAttribute("data-store") ?? ""}" is not valid JSON. ignored`,
    );
    return undefined;
  }
};

/**
 * snapshot を base にマージする（§5.2.3）。
 *
 * 引数が Node[] なのは、挿入範囲がマーカー間の兄弟ノード列であって
 * それを囲む単一の要素が存在しないため（§5.2.3）。
 * Record 形式は DOM を経由しない経路（BroadcastChannel・§8.2）のため。
 *
 * pending には触れない。delta の除去はアプリケーション側の責務（§5.1.3）。
 */
export const mergeSnapshots = (source: readonly Node[] | Record<string, unknown>): void => {
  if (!Array.isArray(source)) {
    for (const [name, snapshot] of Object.entries(source as Record<string, unknown>)) {
      applySnapshot(name, snapshot);
    }
    return;
  }

  for (const el of collect(source as readonly Node[], STORE_SELECTOR)) {
    const name = el.getAttribute("data-store");
    if (name === null || name === "") continue;
    const snapshot = parseSnapshotElement(el);
    if (snapshot === undefined) continue;
    applySnapshot(name, snapshot);
  }
};

/**
 * サーバ確定値（base）を保持する読み取り専用 signal を返す（付録 A.2.2）。
 *
 * 【不変条件・§5.3】この関数を import したモジュールは client-only。
 * zogan/vite がサーババンドルからの到達を検出して失敗させる。
 */
export const clientStore = <T extends Versioned>(name: string, initial: T): ReadonlySignal<T> => {
  if (!isValidIdentifier(name)) {
    throw new Error(`zogan: invalid store name ${JSON.stringify(name)} (§5.2.1)`);
  }
  if (registry.has(name)) {
    throw new Error(`zogan: store ${JSON.stringify(name)} is already registered`);
  }

  const handle = signal<Versioned>(initial);
  registry.set(name, handle);

  // 登録前に届いていた snapshot を引く。適用の可否は通常のマージと同じ version 比較
  const held = deferred.get(name);
  if (held !== undefined) {
    deferred.delete(name);
    if (isNewer(held, initial)) handle.value = held;
  }

  // 代入は computed の getter-only プロパティが弾く（§5.1 の「base を直接書かない」）
  return readonlyView(handle as Signal<T>);
};
