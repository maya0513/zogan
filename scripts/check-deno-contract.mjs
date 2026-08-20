import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const npm = readJson("package.json");
const deno = readJson("deno.json");
const denoExample = readJson("examples/deno/package.json");

const fail = (message) => {
  throw new Error(`Deno contract: ${message}`);
};

if (deno.name !== "@maya0513/zogan") fail("unexpected JSR package name");
if (deno.version !== npm.version) fail("npm and JSR versions differ");
if (denoExample.dependencies?.zogan !== "workspace:*") {
  fail("Deno code sample must resolve zogan through the pnpm workspace in Node tooling");
}

const expectedExports = {
  ".": "./src/server/index.ts",
  "./client": "./src/client/index.ts",
  "./fragments": "./src/fragments/index.ts",
  "./vite": "./src/vite/index.ts",
};
if (JSON.stringify(deno.exports) !== JSON.stringify(expectedExports)) {
  fail("JSR exports differ from the documented npm entry points");
}

const expectedImports = {
  hono: "npm:hono@^4.13.0",
  preact: "npm:preact@^10.29.8",
  "preact-render-to-string": "npm:preact-render-to-string@^6.7.0",
  vite: "npm:vite@^8.2.1",
};
for (const [name, specifier] of Object.entries(expectedImports)) {
  if (deno.imports?.[name] !== specifier) fail(`unexpected import mapping for ${name}`);
}

const allowedPublishPatterns = new Set(["LICENSE", "README.md", "README.ja.md", "src/**/*.ts"]);
for (const pattern of deno.publish?.include ?? []) {
  if (!allowedPublishPatterns.has(pattern)) fail(`unexpected publish include: ${pattern}`);
}
if ((deno.publish?.include ?? []).length !== allowedPublishPatterns.size) {
  fail("publish include set is incomplete");
}

const walk = (directory) =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

for (const path of walk(join(root, "src"))) {
  if (!/\.tsx?$/.test(path)) continue;
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/(?:from\s+|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/g)) {
    if (!/\.tsx?$/.test(match[2])) {
      fail(`${relative(root, path)} has an extensionless relative import: ${match[2]}`);
    }
  }
}

console.log("Deno manifest, publish boundary, and imports are consistent");
