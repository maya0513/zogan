/**
 * ソース上の <Partial> / <Island> の静的検証（付録 A.3 の 2・3）。
 *
 * 本体は §5.3.2 の到達検出であり、ここは利便性のための早期検出。
 * SSR 時にも同じ規則で検証されるので、ここを抜けても事故にはならない。
 */
import { isValidComponentName, isValidIdentifier } from "../server/markers.ts";

export interface SourceIssue {
  readonly level: "error" | "warn";
  readonly message: string;
}

const PARTIAL_TAG = /<Partial\s([^>]*?)\/?>/g;
const ISLAND_TAG = /<Island\s([^>]*?)\/?>/g;

const attr = (attrs: string, name: string): string | null => {
  const quoted = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`).exec(attrs);
  if (quoted !== null) return quoted[1] ?? null;
  // key={page} のような式は値を静的に読めない。存在だけ分かればよい
  const expression = new RegExp(`${name}\\s*=\\s*\\{`).exec(attrs);
  return expression !== null ? "{expr}" : null;
};

export const validateSource = (code: string, id: string): SourceIssue[] => {
  const issues: SourceIssue[] = [];
  const seen = new Set<string>();

  PARTIAL_TAG.lastIndex = 0;
  for (let m = PARTIAL_TAG.exec(code); m !== null; m = PARTIAL_TAG.exec(code)) {
    const attrs = m[1] ?? "";
    const name = attr(attrs, "name");
    if (name === null || name === "{expr}") continue;

    if (!isValidIdentifier(name)) {
      issues.push({
        level: "error",
        message: `zogan: ${id}: invalid <Partial name="${name}"> (§3.1.1)`,
      });
    }
    if (seen.has(name)) {
      issues.push({
        level: "error",
        message: `zogan: ${id}: duplicate <Partial name="${name}"> in one file (§3.1.1)`,
      });
    }
    seen.add(name);

    const mode = attr(attrs, "mode");
    if ((mode === "append" || mode === "prepend") && attr(attrs, "key") === null) {
      issues.push({
        level: "warn",
        message: `zogan: ${id}: <Partial name="${name}" mode="${mode}"> needs a stable key (§3.4.1)`,
      });
    }
  }

  ISLAND_TAG.lastIndex = 0;
  for (let m = ISLAND_TAG.exec(code); m !== null; m = ISLAND_TAG.exec(code)) {
    const name = attr(m[1] ?? "", "name");
    if (name === null || name === "{expr}") continue;
    if (!isValidComponentName(name)) {
      issues.push({
        level: "error",
        message: `zogan: ${id}: invalid <Island name="${name}"> (§6.1.1)`,
      });
    }
  }

  return issues;
};
