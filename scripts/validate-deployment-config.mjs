import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../examples/shop/wrangler.jsonc", import.meta.url), "utf8");
const databaseId = config.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (
  databaseId === undefined ||
  !uuid.test(databaseId) ||
  databaseId === "00000000-0000-0000-0000-000000000000"
) {
  throw new Error(
    "Set the production D1 database_id in examples/shop/wrangler.jsonc before deploying.",
  );
}

console.log(`Deployment config is ready for D1 database ${databaseId}.`);
