/** Options accepted by the zogan Vite plugin. */
export interface ZoganPluginOptions {
  /** Additional client-only module globs. Defaults to files below a `stores` directory. */
  clientOnly?: string[];
  /** Island source directory, relative to Vite's root unless absolute. */
  islandsDir?: string;
}
