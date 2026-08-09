import { Client } from "jsr:@deno/sandbox@^0.13.2";
import manifest from "../deno.json" with { type: "json" };
import { deployClientOptions } from "./deno-deploy-auth.mjs";

const { app: application, org: organization } = manifest.deploy;
const token = Deno.env.get("DENO_DEPLOY_TOKEN");

if (!token) {
  throw new Error("DENO_DEPLOY_TOKEN is required to inspect a failed revision");
}

const client = new Client(deployClientOptions(token, organization));
const revisions = await client.revisions.list(application, {
  limit: 1,
  status: "failed",
});
const revision = revisions.items[0];

if (!revision) {
  throw new Error(`No failed revision found for ${organization}/${application}`);
}

const details = await client.revisions.get(revision.id);
console.error(JSON.stringify({ organization, application, revision: details ?? revision }));

for await (const entry of client.revisions.buildLogs(revision.id)) {
  console.error(JSON.stringify(entry));
}
