import { stripVTControlCharacters } from "node:util";

// Deno cannot currently follow named peer types or the private symbols used to
// keep public descriptors nominal through a re-exporting entrypoint. Keep this
// list exact instead of disabling slow-type/documentation analysis globally.
const allowedPrivateTypes = new Set([
  "cachePolicyBrand",
  "ComponentChildren",
  "ComponentType",
  "Context",
  "descriptorComponent",
  "descriptorProps",
  "Env",
  "FRAGMENT_ELEMENTS",
  "Hono",
  "JSXInternal",
  "JSXInternal.IntrinsicElements",
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
      !allowedPrivateTypes.has(referenced)
    ) {
      throw new Error(`unexpected deno doc diagnostic: ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  return `deno doc --lint reported only ${diagnostics.length} references to named peer or opaque types`;
}
