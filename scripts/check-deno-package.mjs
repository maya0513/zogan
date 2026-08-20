import { execFileSync } from "node:child_process";
import {
  cpSync,
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

const root = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), "zogan-deno-package-"));
const childEnv = { ...process.env, NPM_CONFIG_CACHE: join(tmpdir(), "zogan-npm-cache") };
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, env: childEnv, stdio: "inherit" });

try {
  run("pnpm", ["pack", "--pack-destination", temporary]);
  const archive = readdirSync(temporary).find((entry) => entry.endsWith(".tgz"));
  if (archive === undefined) throw new Error("pnpm pack did not create a tarball");
  run("tar", ["-xzf", join(temporary, archive), "-C", temporary]);

  const consumer = join(temporary, "consumer");
  const modules = join(consumer, "node_modules");
  mkdirSync(modules, { recursive: true });
  cpSync(join(temporary, "package"), join(modules, "zogan"), { recursive: true });

  for (const dependency of ["@types/node", "hono", "preact", "preact-render-to-string", "vite"]) {
    const target = realpathSync(join(root, "node_modules", dependency));
    const destination = join(modules, dependency);
    mkdirSync(join(destination, ".."), { recursive: true });
    symlinkSync(target, destination, "dir");
  }

  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          hono: "4.13.1",
          preact: "10.29.8",
          zogan: "0.0.0",
        },
        devDependencies: { vite: "8.2.1" },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(consumer, "deno.json"),
    JSON.stringify({
      nodeModulesDir: "manual",
      compilerOptions: { lib: ["deno.window", "dom", "dom.iterable"], strict: true },
    }),
  );
  writeFileSync(
    join(consumer, "smoke_test.ts"),
    [
      'import { Hono } from "hono";',
      'import { h } from "preact";',
      'import { cachePolicy, createZogan, defineClientIsland, defineIsland, FragmentSlot, Island, privateNoStore, publicCache, type CachePolicy, type IslandDescriptor, type ZoganOptions } from "zogan";',
      'import { start, type StartOptions } from "zogan/client";',
      'import { startFragments, type StartFragmentsOptions } from "zogan/fragments";',
      'import { zoganVite, type ZoganPluginOptions } from "zogan/vite";',
      'const layout: NonNullable<ZoganOptions["layout"]> = ({ children }) => h("html", null, children);',
      "type Types = [CachePolicy, IslandDescriptor];",
      "void (null as unknown as Types);",
      "const app = new Hono();",
      "const z = createZogan({ layout });",
      'app.get("/", (c) => z.page(c, h("main", null, h(FragmentSlot, { src: "/fragments/status" }, "Deno")), { cache: publicCache() }));',
      'Deno.test("packed npm artifact", async () => {',
      '  const response = await app.request("http://localhost/");',
      '  if (response.status !== 200 || !(await response.text()).includes("Deno")) throw new Error("SSR failed");',
      "});",
      "const startOptions: StartOptions = { islands: {} };",
      "const fragmentOptions: StartFragmentsOptions = {};",
      "const viteOptions: ZoganPluginOptions = {};",
      "void [cachePolicy, defineClientIsland, defineIsland, Island, privateNoStore, start, startFragments, startOptions, fragmentOptions, zoganVite(viteOptions)];",
    ].join("\n"),
  );

  run("deno", ["test", "--config", "deno.json", "smoke_test.ts"], consumer);

  const manifest = JSON.parse(readFileSync(join(temporary, "package", "package.json"), "utf8"));
  for (const entry of [".", "./client", "./fragments", "./vite"]) {
    if (typeof manifest.exports?.[entry]?.types !== "string") {
      throw new TypeError(`packed manifest is missing Deno-readable types for ${entry}`);
    }
  }
  console.log(`Deno package smoke passed: ${archive}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
