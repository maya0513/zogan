/**
 * Island の lazy client entry 生成。
 *
 * islandsDir 直下の *.tsx の filename stem が、server descriptor と共有する Island ID。
 * 各モジュールは dynamic import loader として登録し、初期 entry へ静的に束ねない。
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ISLAND_ID_PATTERN, isIslandId } from "../shared/island-id.ts";

export const VIRTUAL_ISLANDS_ID = "virtual:zogan/islands";
export const RESOLVED_VIRTUAL_ISLANDS_ID = "\0virtual:zogan/islands";

const ISLAND_FILE_SUFFIX = ".tsx";
export interface IslandModule {
  readonly id: string;
  readonly file: string;
}

const validateIslandModules = (modules: readonly IslandModule[]): void => {
  const seen = new Map<string, string>();
  for (const module of modules) {
    if (!isIslandId(module.id)) {
      throw new Error(
        `zogan: invalid island ID ${JSON.stringify(module.id)} from ${module.file}; expected ${ISLAND_ID_PATTERN}`,
      );
    }

    const previous = seen.get(module.id);
    if (previous !== undefined) {
      throw new Error(
        `zogan: duplicate island ID ${JSON.stringify(module.id)}: ${previous}, ${module.file}`,
      );
    }
    seen.set(module.id, module.file);
  }
};

export const listIslandModules = (dir: string): IslandModule[] => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const modules = entries
    .filter((file) => file.endsWith(ISLAND_FILE_SUFFIX))
    .map((file) => ({
      id: file.slice(0, -ISLAND_FILE_SUFFIX.length),
      file: join(dir, file).replaceAll("\\", "/"),
    }));
  modules.sort((left, right) => left.id.localeCompare(right.id));
  validateIslandModules(modules);
  return modules;
};

/** start({ islands }) を呼ぶ loader map を生成する。 */
export const generateIslandsEntry = (modules: readonly IslandModule[]): string => {
  validateIslandModules(modules);
  const loaders = modules.map(
    (module) => `  ${module.id}: () => import(${JSON.stringify(module.file)}),`,
  );
  return [
    "import { start } from 'zogan/client'",
    "",
    "export const islands = {",
    ...loaders,
    "}",
    "",
    "start({ islands })",
    "",
  ].join("\n");
};
