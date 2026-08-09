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
  fail("Deno example must resolve zogan through the pnpm workspace in Node tooling");
}
if (deno.deploy?.org !== "maya0513" || deno.deploy?.app !== "zogan-deno") {
  fail("Deno Deploy organization and application must be present in deno.json");
}
if (deno.deploy?.install !== "deno install --frozen --node-modules-dir=manual") {
  fail("Deno Deploy must install a node_modules directory for the Vite build");
}

const deployWorkflow = readFileSync(join(root, ".github/workflows/deploy-deno.yml"), "utf8");
const syncConfigAt = deployWorkflow.indexOf("scripts/sync-deno-deploy-config.mjs");
const deployAt = deployWorkflow.indexOf("scripts/deploy-deno.mjs");
if (syncConfigAt < 0 || deployAt < 0 || syncConfigAt >= deployAt) {
  fail("the deployment workflow must synchronize the app config before publishing");
}

for (const workflow of ["deploy-site.yml", "deploy-demo.yml", "deploy-deno.yml"]) {
  const source = readFileSync(join(root, ".github/workflows", workflow), "utf8");
  if (!source.includes("workflows: [ci]") || !source.includes("workflow_dispatch:")) {
    fail(`${workflow} must support CI-gated and manual deployments`);
  }
}

const expectedExports = {
  ".": "./src/server/index.ts",
  "./client": "./src/client/index.ts",
  "./vite": "./src/vite/index.ts",
};
if (JSON.stringify(deno.exports) !== JSON.stringify(expectedExports)) {
  fail("JSR exports differ from the documented npm entry points");
}

const expectedImports = {
  hono: "npm:hono@^4.13.0",
  preact: "npm:preact@^10.29.8",
  "@preact/signals": "npm:@preact/signals@^2.11.0",
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

const clientBundle = readFileSync(join(root, "examples/deno/dist/client.js"), "utf8");
const forbidden = ["node:", "process.cwd(", "require("];
for (const token of forbidden) {
  if (clientBundle.includes(token)) fail(`browser bundle contains ${JSON.stringify(token)}`);
}

console.log("Deno manifest, publish boundary, imports, and browser bundle are consistent");
