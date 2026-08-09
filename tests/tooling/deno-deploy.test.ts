import { describe, expect, it, vi } from "vitest";
import { deployClientOptions } from "../../scripts/deno-deploy-auth.mjs";
import { deployWithRetry } from "../../scripts/deploy-deno.mjs";

const inactiveBuild = {
  code: 1,
  stderr: [
    "Download https://jsr.io/@deno/deploy/meta.json",
    JSON.stringify({
      error: {
        code: "GENERIC",
        message:
          "The build for this revision is no longer active. Re-run the deploy to start a new build.",
      },
    }),
  ].join("\n"),
  stdout: "",
  success: false,
};

describe("Deno Deploy retry", () => {
  it("retries once when a stale revision build is no longer active", async () => {
    const success = { code: 0, stderr: "", stdout: '{"revision":"fresh"}', success: true };
    const run = vi.fn().mockResolvedValueOnce(inactiveBuild).mockResolvedValueOnce(success);

    await expect(deployWithRetry(run)).resolves.toEqual(success);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated deployment failures", async () => {
    const failure = {
      code: 3,
      stderr: JSON.stringify({ error: { code: "AUTH", message: "Invalid token" } }),
      stdout: "",
      success: false,
    };
    const run = vi.fn().mockResolvedValue(failure);

    await expect(deployWithRetry(run)).resolves.toEqual(failure);
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not retry the inactive-build error more than once", async () => {
    const run = vi.fn().mockResolvedValue(inactiveBuild);

    await expect(deployWithRetry(run)).resolves.toEqual(inactiveBuild);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("Deno Deploy authentication", () => {
  it("lets an organization token select its own organization", () => {
    expect(deployClientOptions("ddo_example", "maya0513")).toEqual({
      apiEndpoint: "https://console.deno.com",
      token: "ddo_example",
    });
  });

  it("supplies the organization for a personal token", () => {
    expect(deployClientOptions("ddp_example", "maya0513")).toEqual({
      apiEndpoint: "https://console.deno.com",
      org: "maya0513",
      token: "ddp_example",
    });
  });
});
