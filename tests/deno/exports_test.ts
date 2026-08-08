import * as sourceClient from "zogan/client";
import * as sourceServer from "zogan";
import * as sourceVite from "zogan/vite";
import * as builtClient from "../../dist/client/index.js";
import * as builtServer from "../../dist/server/index.js";
import * as builtVite from "../../dist/vite/index.mjs";
import { denoTest } from "./test.ts";

const assertSameExports = (
  name: string,
  source: Record<string, unknown>,
  built: Record<string, unknown>,
): void => {
  const expected = Object.keys(source).sort();
  const actual = Object.keys(built).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name} exports differ: ${JSON.stringify({ expected, actual })}`);
  }
};

denoTest("npm and JSR entrypoints expose the same runtime API", () => {
  assertSameExports("server", sourceServer, builtServer);
  assertSameExports("client", sourceClient, builtClient);
  assertSameExports("vite", sourceVite, builtVite);
});
