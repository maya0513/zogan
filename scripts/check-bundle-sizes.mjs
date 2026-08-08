import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const budgets = [
  ["client", "dist/client/index.js", 12 * 1024],
  ["server", "dist/server/index.js", 7 * 1024],
  ["vite", "dist/vite/index.mjs", 5 * 1024],
];

let failed = false;
for (const [name, path, limit] of budgets) {
  const bytes = gzipSync(await readFile(path)).byteLength;
  const kib = (bytes / 1024).toFixed(2);
  const budget = (limit / 1024).toFixed(0);
  console.log(`${name}: ${kib} KiB gzip (budget ${budget} KiB)`);
  if (bytes > limit) failed = true;
}
if (failed) throw new Error("zogan: a bundle exceeded its gzip budget");
