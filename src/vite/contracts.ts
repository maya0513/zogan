/** Options accepted by the zogan Vite plugin. */
export interface ZoganPluginOptions {
  /** Module globs explicitly marked client-only. No paths are implicit. */
  clientOnly?: string[];
  /** Island source directory, relative to Vite's root unless absolute. */
  islandsDir?: string;
}
