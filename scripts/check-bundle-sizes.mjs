import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const budgets = [
  ["client", "dist/client/index.js", 5 * 1024],
  ["fragments", "dist/fragments/index.js", 4 * 1024],
  ["server", "dist/server/index.js", 4 * 1024],
  ["vite", "dist/vite/index.mjs", 5 * 1024],
];

const results = await Promise.all(
  budgets.map(async ([name, path, limit]) => {
    const bytes = gzipSync(await readFile(path)).byteLength;
    const kib = (bytes / 1024).toFixed(2);
    const budget = (limit / 1024).toFixed(0);
    console.log(`${name}: ${kib} KiB gzip (budget ${budget} KiB)`);
    return bytes > limit;
  }),
);

if (results.some(Boolean)) throw new Error("zogan: a bundle exceeded its gzip budget");
