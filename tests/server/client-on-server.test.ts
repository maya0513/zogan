import { describe, expect, test } from "vitest";

describe("zogan/client を DOM の無い環境で評価する", () => {
  test("import 時に browser globals へ触れず、狭い runtime API だけを公開する", async () => {
    expect(typeof globalThis.document).toBe("undefined");
    const client = await import("../../src/client/index");
    // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys() is already a fresh array
    expect(Object.keys(client).sort()).toEqual(["refreshFragment", "start"]);
  });

  test("明示的に start するまでは browser side effect を起こさない", async () => {
    const client = await import("../../src/client/index");
    expect(typeof client.start).toBe("function");
    expect(typeof client.refreshFragment).toBe("function");
  });
});
