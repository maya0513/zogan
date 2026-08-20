import { createIslandRuntime, type IslandLoader } from "./islands.ts";

/** Browser runtime startup options. */
export interface StartOptions {
  /** Stable Island ID to a lazy module loader. */
  readonly islands?: Readonly<Record<string, IslandLoader>>;
  /** Non-overlapping DOM root owned by this runtime. Defaults to the document element. */
  readonly root?: Element;
}

/** Handle for cancelling pending work and restoring server fallbacks. */
export interface ClientRuntime {
  dispose(): void;
}

/** Start typed Islands below one explicit root. Fragment loading is a separate opt-in runtime. */
export const start = (options: StartOptions = {}): ClientRuntime => {
  const root = options.root ?? document.documentElement;
  const runtime = createIslandRuntime(options.islands);
  runtime.scan([root]);
  let active = true;
  return Object.freeze({
    dispose(): void {
      if (!active) return;
      active = false;
      runtime.destroy([root]);
    },
  });
};
