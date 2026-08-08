import { describe, expect, it } from "vitest";
import { checkDenoDocOutput } from "../../scripts/deno-doc-diagnostics.mjs";

describe("Deno documentation diagnostics", () => {
  it("accepts ANSI-colored references to named peer-dependency types", () => {
    const result = checkDenoDocOutput(
      "\u001b[0m\u001b[1m\u001b[31merror[private-type-ref]\u001b[0m: " +
        "\u001b[1mpublic type 'Partial' references private type 'VNode'\u001b[0m\n",
    );

    expect(result).toContain("reported only 1 reference");
  });

  it("still rejects unexpected documentation diagnostics", () => {
    expect(() =>
      checkDenoDocOutput("\u001b[31merror[missing-js-doc]\u001b[0m: public symbol has no docs\n"),
    ).toThrow("unexpected deno doc diagnostic");
  });
});
