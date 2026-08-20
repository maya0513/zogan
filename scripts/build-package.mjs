import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), "zogan-types-"));
const run = (args) =>
  execFileSync("pnpm", ["exec", "vp", "pack", ...args], {
    cwd: root,
    stdio: "inherit",
  });

rmSync(join(root, "dist"), { recursive: true, force: true });

try {
  run([
    "src/server/index.ts",
    "src/client/index.ts",
    "--platform",
    "neutral",
    "--out-dir",
    "dist",
    "--no-dts",
    "--minify",
  ]);

  for (const entry of ["server", "client"]) {
    const output = join(temporary, entry);
    run([`src/${entry}/index.ts`, "--platform", "neutral", "--out-dir", output]);
    mkdirSync(join(root, "dist", entry), { recursive: true });
    cpSync(join(output, "index.d.ts"), join(root, "dist", entry, "index.d.ts"));
  }

  run(["src/vite/index.ts", "--platform", "node", "--out-dir", "dist/vite"]);

  for (const [javascript, types] of [
    ["dist/server/index.js", "./index.d.ts"],
    ["dist/client/index.js", "./index.d.ts"],
    ["dist/vite/index.mjs", "./index.d.mts"],
  ]) {
    const path = join(root, javascript);
    writeFileSync(
      path,
      `/* @ts-self-types=${JSON.stringify(types)} */\n${readFileSync(path, "utf8")}`,
    );
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
