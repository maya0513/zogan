/**
 * 明示された client-only モジュールの判定と SSR entry からの到達検出。
 * 判定方法は 'use client-only' directive と、plugin option の glob だけに限定する。
 */

const WHITESPACE = /\s/;
const isLineTerminator = (character: string): boolean => {
  const codePoint = character.codePointAt(0);
  return character === "\n" || character === "\r" || codePoint === 0x2028 || codePoint === 0x2029;
};

const containsLineTerminator = (value: string): boolean => {
  for (const valueCharacter of value) {
    if (isLineTerminator(valueCharacter)) return true;
  }
  return false;
};

interface TriviaResult {
  readonly end: number;
  readonly sawLineTerminator: boolean;
}

const skipTrivia = (code: string, start: number): TriviaResult => {
  let end = start;
  let sawLineTerminator = false;
  while (end < code.length) {
    const character = code[end];
    if (character !== undefined && WHITESPACE.test(character)) {
      if (isLineTerminator(character)) sawLineTerminator = true;
      end += 1;
      continue;
    }
    if (code.startsWith("//", end)) {
      end += 2;
      while (end < code.length && !isLineTerminator(code.slice(end, end + 1))) end += 1;
      continue;
    }
    if (code.startsWith("/*", end)) {
      const close = code.indexOf("*/", end + 2);
      if (close === -1) return { end: code.length, sawLineTerminator };
      if (containsLineTerminator(code.slice(end, close + 2))) {
        sawLineTerminator = true;
      }
      end = close + 2;
      continue;
    }
    break;
  }
  return { end, sawLineTerminator };
};

interface StringLiteralResult {
  readonly content: string;
  readonly end: number;
}

const readStringLiteral = (code: string, start: number): StringLiteralResult | null => {
  const quote = code[start];
  if (quote !== "'" && quote !== '"') return null;

  let end = start + 1;
  while (end < code.length) {
    const character = code[end];
    if (character === quote) {
      return { content: code.slice(start + 1, end), end: end + 1 };
    }
    if (character === "\\") {
      end += code[end + 1] === "\r" && code[end + 2] === "\n" ? 3 : 2;
      continue;
    }
    if (character === undefined || isLineTerminator(character)) return null;
    end += 1;
  }
  return null;
};

export const hasClientOnlyDirective = (code: string): boolean => {
  let cursor = code.codePointAt(0) === 0xfeff ? 1 : 0;
  if (code.startsWith("#!", cursor)) {
    while (cursor < code.length && !isLineTerminator(code.slice(cursor, cursor + 1))) cursor += 1;
  }

  while (cursor < code.length) {
    cursor = skipTrivia(code, cursor).end;
    const literal = readStringLiteral(code, cursor);
    if (literal === null) return false;

    const trailing = skipTrivia(code, literal.end);
    const hasTerminator =
      trailing.end === code.length || code[trailing.end] === ";" || trailing.sawLineTerminator;
    if (!hasTerminator) return false;
    if (literal.content === "use client-only") return true;
    cursor = code[trailing.end] === ";" ? trailing.end + 1 : trailing.end;
  }
  return false;
};

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
  const queue: [string, ...string[]][] = [[target]];

  for (const path of queue) {
    const [head] = path;
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

/** 到達パスを全部出す。どこで import しているかが分からないと境界違反を直せない。 */
export const formatReachError = (path: readonly string[]): string => {
  const lines = path.map((id, index) => `${"  ".repeat(index + 1)}${index === 0 ? "" : "→ "}${id}`);
  const last = path.length - 1;
  const finalLine = lines[last];
  if (last > 0 && finalLine !== undefined) {
    lines[last] = `${finalLine}             ← client-only`;
  }
  return [
    "zogan: client-only module reached from server bundle",
    "",
    ...lines,
    "",
    "  client-only モジュールをサーバ entry から import しないでください。",
  ].join("\n");
};
