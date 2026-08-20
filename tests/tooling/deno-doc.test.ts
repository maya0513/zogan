import { describe, expect, it } from "vitest";
import { checkDenoDocOutput } from "../../scripts/deno-doc-diagnostics.mjs";

describe("Deno documentation diagnostics", () => {
  it("accepts ANSI-colored references to named peer or opaque types", () => {
    const result = checkDenoDocOutput(
      "\u001B[0m\u001B[1m\u001B[31merror[private-type-ref]\u001B[0m: " +
        "\u001B[1mpublic type 'Partial' references private type 'VNode'\u001B[0m\n",
    );

    expect(result).toContain("reported only 1 reference");
  });

  it("still rejects unexpected documentation diagnostics", () => {
    expect(() =>
      checkDenoDocOutput("\u001B[31merror[missing-js-doc]\u001B[0m: public symbol has no docs\n"),
    ).toThrow("unexpected deno doc diagnostic");
  });
});
