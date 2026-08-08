/**
 * ローディング表示のための signal（§7.3.2 / 付録 A.2.4）。
 *
 * Store と同じ基盤に乗るので、Island は他と同じように読むだけで済む。
 * 専用のインジケータ機構を別に作らない。
 *
 * これらはモジュールスコープにあるが、リクエスト間で漏れる値ではない
 * （SSR 中は常に false / []）。§5.3.2 の client-only 判定の対象外。
 */
import { computed, signal, type ReadonlySignal, type Signal } from "@preact/signals";

/**
 * 書き込むのはランタイムだけ。公開する型は読み取り専用にする。
 *
 * computed は代入すると例外になる本物の signal なので、独自のラッパーを作らない。
 * JSX への埋め込みや subscribe も Preact 側の実装がそのまま効く。
 */
export const readonlyView = <T>(handle: Signal<T>): ReadonlySignal<T> =>
  computed(() => handle.value);

const navigatingHandle = signal(false);
const pendingPartialsHandle = signal<string[]>([]);

/** ソフトナビゲーションが進行中か */
export const navigating: ReadonlySignal<boolean> = readonlyView(navigatingHandle);

/** 現在取得中の領域名。進行中でなければ [] */
export const pendingPartials: ReadonlySignal<string[]> = readonlyView(pendingPartialsHandle);

export const setNavigating = (value: boolean): void => {
  navigatingHandle.value = value;
};

export const setPendingPartials = (value: string[]): void => {
  pendingPartialsHandle.value = value;
};
