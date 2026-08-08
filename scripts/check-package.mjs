import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const childEnv = { ...process.env, NPM_CONFIG_CACHE: "/tmp/zogan-npm-cache" };
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    encoding: "utf8",
    env: childEnv,
  });

const temporary = mkdtempSync(join(process.cwd(), ".package-check-"));
execFileSync("pnpm", ["pack", "--pack-destination", temporary], {
  cwd: process.cwd(),
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
for (const entry of ["dist/server/index.js", "dist/client/index.js", "dist/vite/index.mjs"]) {
  await import(pathToFileURL(join(packageRoot, entry)).href);
}
for (const entry of ["dist/server/index.d.ts", "dist/client/index.d.ts", "dist/vite/index.d.mts"]) {
  if (!existsSync(join(packageRoot, entry))) throw new Error(`missing packed type entry: ${entry}`);
}

const modules = join(temporary, "node_modules");
mkdirSync(modules);
symlinkSync(packageRoot, join(modules, "zogan"), "dir");
const smoke = join(temporary, "smoke.ts");
writeFileSync(
  smoke,
  [
    'import { zogan, Partial } from "zogan";',
    'import { start, navigate } from "zogan/client";',
    'import { zoganVite } from "zogan/vite";',
    "void [zogan, Partial, start, navigate, zoganVite];",
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
rmSync(temporary, { recursive: true, force: true });
