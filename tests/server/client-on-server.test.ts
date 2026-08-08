/**
 * §5.3.2 の補足：zogan/client はサーババンドルでも評価可能でなければならない。
 *
 * navigating / pendingPartials を読むだけの Island はサーババンドルに入ってよい
 * （§7.3.2）。そのためモジュールのトップレベルで document / window に触れないこと。
 * このテストは node 環境（DOM が無い）で走る。
 */
import { describe, expect, test } from "vitest";

describe("zogan/client を DOM の無い環境で評価する", () => {
  test("import しても落ちない", async () => {
    expect(typeof globalThis.document).toBe("undefined");
    const client = await import("../../src/client/index");
    expect(Object.keys(client).sort()).toEqual([
      "clientStore",
      "mergeSnapshots",
      "navigate",
      "navigating",
      "pendingPartials",
      "refreshFragment",
      "start",
    ]);
  });

  test("SSR 中の navigating / pendingPartials は false / []", async () => {
    const { navigating, pendingPartials } = await import("../../src/client/index");
    expect(navigating.value).toBe(false);
    expect(pendingPartials.value).toEqual([]);
  });

  test("clientStore はサーバ上でも登録だけはできる（値は snapshot からのみ）", async () => {
    const { clientStore } = await import("../../src/client/index");
    const store = clientStore("cart-on-server", { version: 0, count: 0 });
    expect(store.value).toEqual({ version: 0, count: 0 });
    expect(() => {
      (store as { value: unknown }).value = { version: 1, count: 9 };
    }).toThrow();
  });
});
