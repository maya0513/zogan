import { Client } from "jsr:@deno/sandbox@^0.13.2";

const organization = "maya0513";
const application = "zogan-deno";
const client = new Client({ org: organization });
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
