import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version } from "vite";
import { zoganVite } from "../dist/vite/index.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientEntry = join(repositoryRoot, "dist/client/index.js");

if (!existsSync(clientEntry)) {
  throw new Error("Build zogan before checking its Vite peer compatibility.");
}

const fixtureRoot = mkdtempSync(join(tmpdir(), "zogan-vite-peer-"));
const sourceRoot = join(fixtureRoot, "src");
const islandsRoot = join(sourceRoot, "islands");

try {
  mkdirSync(islandsRoot, { recursive: true });

  writeFileSync(join(islandsRoot, "Greeting.js"), "export default () => null;\n");
  writeFileSync(join(sourceRoot, "client.js"), 'import "virtual:zogan/islands";\n');
  writeFileSync(join(sourceRoot, "server.js"), 'export const runtime = "server";\n');

  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: "silent",
    resolve: { alias: { "zogan/client": clientEntry } },
    plugins: [zoganVite({ islandsDir: "src/islands" })],
    build: {
      emptyOutDir: true,
      outDir: "dist/client",
      rollupOptions: { input: join(sourceRoot, "client.js") },
    },
  });

  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: "silent",
    plugins: [zoganVite({ islandsDir: "src/islands" })],
    build: {
      emptyOutDir: true,
      outDir: "dist/server",
      ssr: join(sourceRoot, "server.js"),
    },
  });

  console.log(`Vite ${version} peer smoke passed.`);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
