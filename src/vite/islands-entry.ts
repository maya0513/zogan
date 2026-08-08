/**
 * Island のクライアント側エントリ生成（付録 A.3 の 4）。
 *
 * 生成するエントリはクライアントバンドルの起点であり、Island のコンポーネントは
 * ここからのみ参照される。§5.3.2 の走査対象はサーババンドルのグラフなので、
 * このエントリは含まれない。4 が 1 を成立させている。
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isValidComponentName } from "../server/markers.ts";

export const VIRTUAL_ISLANDS_ID = "virtual:zogan/islands";
export const RESOLVED_VIRTUAL_ISLANDS_ID = "\0virtual:zogan/islands";

const ISLAND_FILE = /^([A-Za-z][A-Za-z0-9_]*)\.(tsx|jsx|ts|js)$/;

export interface IslandModule {
  readonly name: string;
  readonly file: string;
}

export const listIslandModules = (dir: string): IslandModule[] => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const modules = entries
    .map((file) => ({ file, match: ISLAND_FILE.exec(file) }))
    .filter((e) => e.match !== null && isValidComponentName(e.match[1] ?? ""))
    .map(({ file, match }) => ({ name: match![1]!, file: join(dir, file).replaceAll("\\", "/") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Map<string, string>();
  for (const module of modules) {
    const previous = seen.get(module.name);
    if (previous !== undefined) {
      throw new Error(
        `zogan: duplicate island name ${JSON.stringify(module.name)}: ${previous}, ${module.file}`,
      );
    }
    seen.set(module.name, module.file);
  }
  return modules;
};

/** start({ islands }) の呼び出しを生成する。これがクライアントバンドルの起点 */
export const generateIslandsEntry = (modules: readonly IslandModule[]): string => {
  const imports = modules.map((m) => `import ${m.name} from ${JSON.stringify(m.file)}`);
  const names = modules.map((m) => `  ${m.name},`);
  return [
    "import { start } from 'zogan/client'",
    ...imports,
    "",
    "export const islands = {",
    ...names,
    "}",
    "",
    "start({ islands })",
    "",
  ].join("\n");
};
