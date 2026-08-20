/**
 * zogan/vite の明示的な client-only 境界と Island entry plugin。
 *
 * サーババンドルから明示された client-only モジュールへの到達を、
 * 到達パス付きで失敗させる。また Island の lazy client entry を生成する。
 */
import type { Plugin } from "vite";
import { isAbsolute, resolve } from "node:path";
import {
  findEnvironmentReachPath,
  formatEnvironmentReachError,
  hasClientOnlyDirective,
  hasServerOnlyDirective,
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

const isServerOnlyModule = (id: string, code: string, globs: readonly string[]): boolean =>
  hasServerOnlyDirective(code) || globs.some((glob) => matchesGlob(id, glob));

/** Creates the Vite plugin for Island entries and client-only boundary checks. */
export const zoganVite = (options: ZoganPluginOptions = {}): Plugin => {
  const globs = options.clientOnly ?? [];
  const serverGlobs = options.serverOnly ?? [];
  const islandsDir = options.islandsDir ?? "src/islands";
  const clientOnlyIds = new Set<string>();
  const serverOnlyIds = new Set<string>();
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
      if (isServerOnlyModule(id, code, serverGlobs)) serverOnlyIds.add(id);
      return null;
    },

    buildEnd(error) {
      if (error !== undefined) return;
      const consumer = this.environment.config.consumer;
      const boundary = consumer === "server" ? "client-only" : "server-only";
      const ids = consumer === "server" ? clientOnlyIds : serverOnlyIds;
      for (const id of ids) {
        const path = findEnvironmentReachPath(this, id);
        if (path !== null) this.error(formatEnvironmentReachError(path, boundary, consumer));
      }
    },
  };
};

export default zoganVite;
export type { ZoganPluginOptions } from "./contracts.ts";
