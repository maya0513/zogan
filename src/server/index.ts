/**
 * zogan（サーバ側）。
 *
 * Hono への app.page / app.fragment 拡張、<Partial>、マーカー付き SSR。
 * クライアントランタイムは 'zogan/client'、ビルドプラグインは 'zogan/vite'。
 */
export { zogan } from "./middleware.ts";
export type { FragmentHandler, PageHandler, ZoganApp, ZoganOptions } from "./contracts.ts";
export { Partial, type PartialMode, type PartialProps } from "./partial.ts";
export { Island, type IslandProps, type IslandTrigger } from "./island.ts";
export { StoreSnapshot, type StoreSnapshotProps } from "./store-snapshot.ts";
