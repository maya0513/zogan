import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const childEnv = { ...process.env, NPM_CONFIG_CACHE: join(tmpdir(), "zogan-npm-cache") };
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    encoding: "utf8",
    env: childEnv,
  });
const assertExports = (entry, actual, expected) => {
  const names = Object.keys(actual).toSorted();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`${entry} exports ${names.join(", ")}; expected ${expected.join(", ")}`);
  }
};

const temporary = mkdtempSync(join(tmpdir(), "zogan-package-check-"));

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temporary], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
  });
  const filename = readdirSync(temporary).find((entry) => entry.endsWith(".tgz"));
  if (filename === undefined) throw new Error("pnpm pack did not create a tarball");
  const archive = join(temporary, filename);
  run("pnpm", ["exec", "publint", archive, "--pack", "false"]);
  run("pnpm", ["exec", "attw", archive, "--profile", "esm-only"]);
  run("tar", ["-xzf", archive, "-C", temporary]);

  const packageRoot = join(temporary, "package");
  const modules = join(temporary, "node_modules");
  mkdirSync(modules);
  for (const dependency of ["hono", "preact", "preact-render-to-string", "vite"]) {
    const target = realpathSync(join(root, "node_modules", dependency));
    const destination = join(modules, dependency);
    mkdirSync(join(destination, ".."), { recursive: true });
    symlinkSync(target, destination, "dir");
  }

  const [serverEntry, clientEntry, fragmentsEntry, viteEntry] = await Promise.all(
    [
      "dist/server/index.js",
      "dist/client/index.js",
      "dist/fragments/index.js",
      "dist/vite/index.mjs",
    ].map((entry) => import(pathToFileURL(join(packageRoot, entry)).href)),
  );
  assertExports("zogan", serverEntry, [
    "FragmentSlot",
    "Island",
    "cachePolicy",
    "createZogan",
    "defineClientIsland",
    "defineIsland",
    "privateNoStore",
    "publicCache",
  ]);
  assertExports("zogan/client", clientEntry, ["start"]);
  assertExports("zogan/fragments", fragmentsEntry, ["startFragments"]);
  assertExports("zogan/vite", viteEntry, ["default", "zoganVite"]);
  for (const entry of [
    "dist/server/index.d.ts",
    "dist/client/index.d.ts",
    "dist/fragments/index.d.ts",
    "dist/vite/index.d.mts",
  ]) {
    if (!existsSync(join(packageRoot, entry)))
      throw new Error(`missing packed type entry: ${entry}`);
  }

  symlinkSync(packageRoot, join(modules, "zogan"), "dir");
  const smoke = join(temporary, "smoke.ts");
  writeFileSync(
    smoke,
    [
      'import { cachePolicy, createZogan, defineClientIsland, defineIsland, FragmentSlot, Island, privateNoStore, publicCache, type CachePolicy, type IslandDescriptor, type ZoganOptions } from "zogan";',
      'import { start } from "zogan/client";',
      'import { startFragments } from "zogan/fragments";',
      'import { zoganVite, type ZoganPluginOptions } from "zogan/vite";',
      "type Types = [CachePolicy, IslandDescriptor, ZoganOptions, ZoganPluginOptions];",
      "void (null as unknown as Types);",
      "void [cachePolicy, createZogan, defineClientIsland, defineIsland, FragmentSlot, Island, privateNoStore, publicCache, start, startFragments, zoganVite];",
    ].join("\n"),
  );
  run("pnpm", [
    "exec",
    "tsc",
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--module",
    "esnext",
    "--moduleResolution",
    "bundler",
    smoke,
  ]);

  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (manifest.peerDependenciesMeta?.vite?.optional !== true) {
    throw new Error("packed manifest must keep Vite as an optional peer");
  }
  if (manifest.peerDependencies?.vite !== "^8.0.0") {
    throw new Error("packed manifest must support Vite 8 only");
  }
  console.log(`package smoke passed: ${filename}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
