/**
 * zogan/vite（付録 A.3）。
 *
 * 1 が本体：サーババンドルから client-only モジュールへの到達を、到達パス付きで失敗させる。
 * 2〜4 は利便性であり、1 だけは安全性の担保として外せない。
 */
import type { Plugin } from "vite";
import { isAbsolute, resolve } from "node:path";
import {
  findServerReachPath,
  formatReachError,
  hasClientOnlyDirective,
  importsClientStore,
  matchesGlob,
  type ModuleGraphLike,
} from "./client-only.ts";
import {
  generateIslandsEntry,
  listIslandModules,
  RESOLVED_VIRTUAL_ISLANDS_ID,
  VIRTUAL_ISLANDS_ID,
} from "./islands-entry.ts";
import { validateSource } from "./validate.ts";
import type { ZoganPluginOptions } from "./contracts.ts";

const DEFAULT_CLIENT_ONLY = ["**/stores/**"];

const isClientOnlyModule = (id: string, code: string, globs: readonly string[]): boolean =>
  importsClientStore(code) ||
  hasClientOnlyDirective(code) ||
  globs.some((glob) => matchesGlob(id, glob));

/** Creates the Vite plugin for Island entries and client-only boundary checks. */
export const zoganVite = (options: ZoganPluginOptions = {}): Plugin => {
  const globs = options.clientOnly ?? DEFAULT_CLIENT_ONLY;
  const islandsDir = options.islandsDir ?? "src/islands";
  const clientOnlyIds = new Set<string>();
  let isSsrBuild = false;
  let root = process.cwd();

  return {
    name: "zogan",

    configResolved(config) {
      isSsrBuild = Boolean(config.build?.ssr);
      root = config.root ?? root;
    },

    resolveId(id) {
      if (id === VIRTUAL_ISLANDS_ID) return RESOLVED_VIRTUAL_ISLANDS_ID;
      return null;
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_ISLANDS_ID) return null;
      const directory = isAbsolute(islandsDir) ? islandsDir : resolve(root, islandsDir);
      return generateIslandsEntry(listIslandModules(directory));
    },

    transform(code, id) {
      if (isClientOnlyModule(id, code, globs)) clientOnlyIds.add(id);

      // Compiled JavaScript can contain diagnostic strings that look like JSX.
      if (/\.[jt]sx(?:\?|$)/.test(id)) {
        for (const issue of validateSource(code, id)) {
          if (issue.level === "error") this.error(issue.message);
          else this.warn(issue.message);
        }
      }
      return null;
    },

    buildEnd(error) {
      if (error !== undefined && error !== null) return;
      // 1：走査対象はサーババンドルのグラフだけ
      if (!isSsrBuild) return;

      const graph = this as unknown as ModuleGraphLike;
      for (const id of clientOnlyIds) {
        const path = findServerReachPath(graph, id);
        if (path !== null) this.error(formatReachError(path));
      }
    },
  };
};

export default zoganVite;
export type { ZoganPluginOptions } from "./contracts.ts";
