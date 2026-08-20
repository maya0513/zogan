import { scanFragments } from "./fragments.ts";
import { hydrateIslands, registerIslands, type IslandLoader } from "./islands.ts";

/** Browser runtime startup options. */
export interface StartOptions {
  /** Stable Island ID to a lazy module loader. Fragment-only pages may omit this map. */
  readonly islands?: Readonly<Record<string, IslandLoader>>;
}

let started = false;

/** Start only the explicit FragmentSlot and Island enhancements present in the initial document. */
export const start = (options: StartOptions = {}): void => {
  if (started) {
    console.warn("zogan: start() was already called; ignoring the second call");
    return;
  }
  started = true;

  registerIslands(options.islands ?? {});
  const root = [document.documentElement];
  scanFragments(root);
  hydrateIslands(root);
};

/** Reset module state between isolated tests. */
// oxlint-disable-next-line no-underscore-dangle -- deliberately recognizable test-only hook
export const __resetStart = (): void => {
  started = false;
};
