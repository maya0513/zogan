import { stripVTControlCharacters } from "node:util";

const allowedExternalTypes = new Set([
  "ComponentChildren",
  "ComponentType",
  "Context",
  "Env",
  "Hono",
  "ReadonlySignal",
  "Schema",
  "VNode",
]);

export function checkDenoDocOutput(rawOutput) {
  // Deno emits ANSI styling when GitHub Actions advertises color support, even
  // though stdout is piped. Normalize the stream before parsing diagnostics.
  const output = stripVTControlCharacters(rawOutput);
  const diagnostics = [...output.matchAll(/error\[([^\]]+)\]: ([^\n]+)/g)].map(
    ([, code, message]) => ({ code, message }),
  );

  if (diagnostics.length === 0) {
    if (/\bChecked \d+ files?\b/.test(output)) {
      return "deno doc --lint passed";
    }
    throw new Error("deno doc --lint did not complete with a structured result");
  }

  for (const diagnostic of diagnostics) {
    const referenced = diagnostic.message.match(/references private type '([^']+)'/)?.[1];
    if (
      diagnostic.code !== "private-type-ref" ||
      referenced === undefined ||
      !allowedExternalTypes.has(referenced)
    ) {
      throw new Error(`unexpected deno doc diagnostic: ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  return `deno doc --lint reported only ${diagnostics.length} references to named peer-dependency types`;
}
