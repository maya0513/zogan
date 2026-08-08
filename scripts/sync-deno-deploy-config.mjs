import { Client } from "jsr:@deno/sandbox@^0.13.2";
import manifest from "../deno.json" with { type: "json" };

const token = Deno.env.get("DENO_DEPLOY_TOKEN");

if (!token) {
  throw new Error("DENO_DEPLOY_TOKEN is required to synchronize the app config");
}

const { app, build, install, org, runtime } = manifest.deploy;
const client = new Client({
  apiEndpoint: "https://console.deno.com",
  org,
  token,
});

const updated = await client.apps.update(app, {
  config: { build, install, runtime },
});

console.log(JSON.stringify({ app: updated.slug, config: updated.config, org }));
