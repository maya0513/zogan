/**
 * ランタイムの起動（付録 A.2.1）。呼び出しは 1 回だけ。
 */
import { refreshFragment } from "./fragments.ts";
import { hydrateIslands, registerIslands, type IslandComponent } from "./islands.ts";
import { navigateFromHistory, onDocumentClick } from "./nav.ts";
import { onDocumentSubmit } from "./forms.ts";
import { setFragmentPrefix } from "./config.ts";
import { mergeSnapshots } from "./store.ts";

/** Options used to initialize the browser runtime once. */
export interface StartOptions {
  /** data-island の名前 → コンポーネント の対応表 */
  islands: Record<string, IslandComponent>;
  /** Fragment のエンドポイント接頭辞。サーバ側 zogan() の設定と揃える。既定 '/_f/' */
  fragmentPrefix?: string;
  /**
   * BFCache から復帰したときに取り直す Fragment（§8.3.2）。
   * 既定は空。どの Fragment を取り直すかは TTL で決まるのでアプリケーションが指定する。
   */
  refreshOnRestore?: string[];
}

let started = false;

/** Starts navigation, form handling, Store merging, and Island hydration. */
export const start = (options: StartOptions): void => {
  if (started) {
    console.warn("zogan: start() was already called. ignoring");
    return;
  }
  started = true;

  registerIslands(options.islands);
  if (options.fragmentPrefix !== undefined) setFragmentPrefix(options.fragmentPrefix);

  const root = [document.documentElement];
  // 1 が 2 より先。初回ロードでも必須（§7.2.2）
  mergeSnapshots(root);
  hydrateIslands(root);

  document.addEventListener("click", onDocumentClick as EventListener);
  document.addEventListener("submit", onDocumentSubmit);

  window.addEventListener("popstate", () => {
    // 戻る/進む。履歴は既に動いているので触らない
    void navigateFromHistory(location.href);
  });

  window.addEventListener("pageshow", (event) => {
    // BFCache は JS のメモリごと復元する。凍結中にサーバ側が変わっている可能性がある
    if (!(event as PageTransitionEvent).persisted) return;
    for (const url of options.refreshOnRestore ?? []) void refreshFragment(url);
  });
};

/** テスト用 */
export const __resetStart = (): void => {
  started = false;
};
