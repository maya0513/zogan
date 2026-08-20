import * as sourceClient from "zogan/client";
import * as sourceFragments from "zogan/fragments";
import * as sourceServer from "zogan";
import * as sourceVite from "zogan/vite";
import * as builtClient from "../../dist/client/index.js";
import * as builtFragments from "../../dist/fragments/index.js";
import * as builtServer from "../../dist/server/index.js";
import * as builtVite from "../../dist/vite/index.mjs";
import { denoTest } from "./test.ts";

const assertSameExports = (
  name: string,
  source: Record<string, unknown>,
  built: Record<string, unknown>,
): void => {
  // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys creates a fresh array
  const expected = Object.keys(source).sort();
  // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys creates a fresh array
  const actual = Object.keys(built).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name} exports differ: ${JSON.stringify({ expected, actual })}`);
  }
};

denoTest("npm and JSR entrypoints expose the same runtime API", () => {
  assertSameExports("server", sourceServer, builtServer);
  assertSameExports("client", sourceClient, builtClient);
  assertSameExports("fragments", sourceFragments, builtFragments);
  assertSameExports("vite", sourceVite, builtVite);
});
