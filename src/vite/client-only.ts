/**
 * client-only モジュールの判定と到達検出（§5.3.2）。
 *
 * 判定は「zogan/client から clientStore を named import しているモジュール」を主とする。
 * clientStore は zogan/client からしか export されないので、Store モジュールは必ず
 * この import を持つ。規約ではなく型の帰結なので抜けようがない。
 *
 * zogan/client の import 全般を対象にしてはならない。navigating / pendingPartials は
 * Island が正当に読むもので、SSR 中は常に false / [] になる（§7.3.2）。
 */

import { ImportType, initSync, parse } from "es-module-lexer";

initSync();

export const importsClientStore = (code: string): boolean => {
  let imports: ReturnType<typeof parse>[0];
  try {
    [imports] = parse(code);
  } catch {
    return false;
  }
  for (const imported of imports) {
    if (imported.n !== "zogan/client") continue;
    if (imported.t === ImportType.Dynamic || imported.t === ImportType.DynamicSourcePhase) {
      return true;
    }

    const statement = code.slice(imported.ss, imported.se).trim();
    if (/^(?:import|export)\s+type\b/.test(statement)) continue;
    if (/^(?:import|export)\s+(?:defer\s+)?\*/.test(statement)) return true;

    const named = /\{([\s\S]*?)\}/.exec(statement)?.[1];
    if (named !== undefined) {
      const specifiers = named.split(",").map((specifier) => specifier.trim());
      if (
        specifiers.some(
          (specifier) =>
            !specifier.startsWith("type ") &&
            (specifier === "clientStore" || /^clientStore\s+as\s+/.test(specifier)),
        )
      ) {
        return true;
      }
      continue;
    }

    // zogan/client has no default export. Treat an attempted default import as unsafe.
    if (/^import\s+[A-Za-z_$]/.test(statement)) return true;
  }
  return false;
};

export const hasClientOnlyDirective = (code: string): boolean =>
  /^\s*(['"])use client-only\1/.test(code);

/** ** と * だけを解釈する最小の glob。依存を増やさないため自前で持つ */
export const matchesGlob = (path: string, glob: string): boolean => {
  const pattern = glob
    .split("**")
    .map((part) =>
      part
        .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", "[^/]*")
        .replaceAll("?", "[^/]"),
    )
    .join(".*");
  return new RegExp(`^${pattern}$`).test(path);
};

export interface ModuleInfoLike {
  readonly id: string;
  readonly isEntry: boolean;
  readonly importers: readonly string[];
  readonly dynamicImporters?: readonly string[];
}

export interface ModuleGraphLike {
  getModuleInfo(id: string): ModuleInfoLike | null;
}

/**
 * client-only モジュールから importers を遡り、エントリまでの経路を返す。
 * 見つからなければ null（サーババンドルから到達していない）。
 */
export const findServerReachPath = (graph: ModuleGraphLike, target: string): string[] | null => {
  const seen = new Set<string>([target]);
  const queue: string[][] = [[target]];

  while (queue.length > 0) {
    const path = queue.shift()!;
    const head = path[0]!;
    const info = graph.getModuleInfo(head);
    if (info === null) continue;
    if (info.isEntry) return path;

    for (const importer of [...info.importers, ...(info.dynamicImporters ?? [])]) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      queue.push([importer, ...path]);
    }
  }
  return null;
};

/** 到達パスを全部出す。どこで import しているかが分からないと直せない（§5.3.2） */
export const formatReachError = (path: readonly string[]): string => {
  const lines = path.map((id, index) => `${"  ".repeat(index + 1)}${index === 0 ? "" : "→ "}${id}`);
  const last = path.length - 1;
  if (last > 0) lines[last] = `${lines[last]!}             ← client-only`;
  return [
    "zogan: client-only module reached from server bundle",
    "",
    ...lines,
    "",
    "  Store を読むコンポーネントをサーバ経路に置かないでください（§5.3.2）。",
    "    - <Island> の children  → プレースホルダに留める",
    "    - app.fragment の応答   → props で受ける表示専用コンポーネントを使う",
  ].join("\n");
};
