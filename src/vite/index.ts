/**
 * zogan/vite の明示的な client-only 境界と Island entry plugin。
 *
 * サーババンドルから明示された client-only モジュールへの到達を、
 * 到達パス付きで失敗させる。また Island の lazy client entry を生成する。
 */
import type { Plugin } from "vite";
import { isAbsolute, resolve } from "node:path";
import {
  findServerReachPath,
  formatReachError,
  hasClientOnlyDirective,
  matchesGlob,
} from "./client-only.ts";
import {
  generateIslandsEntry,
  listIslandModules,
  RESOLVED_VIRTUAL_ISLANDS_ID,
  VIRTUAL_ISLANDS_ID,
} from "./islands-entry.ts";
import type { ZoganPluginOptions } from "./contracts.ts";

const isClientOnlyModule = (id: string, code: string, globs: readonly string[]): boolean =>
  hasClientOnlyDirective(code) || globs.some((glob) => matchesGlob(id, glob));

/** Creates the Vite plugin for Island entries and client-only boundary checks. */
export const zoganVite = (options: ZoganPluginOptions = {}): Plugin => {
  const globs = options.clientOnly ?? [];
  const islandsDir = options.islandsDir ?? "src/islands";
  const clientOnlyIds = new Set<string>();
  let root = process.cwd();

  return {
    name: "zogan",

    configResolved(config) {
      root = config.root;
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
      return null;
    },

    buildEnd(error) {
      if (error !== undefined) return;
      // Vite 8 の environment consumer を正本とし、multi-environment build でも
      // 実際の server graph だけを検査する。
      if (this.environment.config.consumer !== "server") return;

      for (const id of clientOnlyIds) {
        const path = findServerReachPath(this, id);
        if (path !== null) this.error(formatReachError(path));
      }
    },
  };
};

export default zoganVite;
export type { ZoganPluginOptions } from "./contracts.ts";
