import { start, type ClientRuntime, type IslandLoader } from "zogan/client";
import { startFragments, type FragmentClientRuntime } from "zogan/fragments";

const islands: Readonly<Record<string, IslandLoader>> = {
  PageStatus: () => import("./islands/PageStatus.tsx"),
};

/** Start the two explicit browser runtimes and return both lifecycle handles. */
export const startSampleEnhancements = (): {
  readonly islands: ClientRuntime;
  readonly fragments: FragmentClientRuntime;
} => ({
  islands: start({ islands }),
  fragments: startFragments(),
});
