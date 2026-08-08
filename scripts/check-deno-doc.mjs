let output = "";
for await (const chunk of process.stdin) output += chunk;

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
const diagnostics = [...output.matchAll(/error\[([^\]]+)\]: ([^\n]+)/g)].map(
  ([, code, message]) => ({ code, message }),
);

if (diagnostics.length === 0) {
  if (/\bChecked \d+ files?\b/.test(output)) {
    console.log("deno doc --lint passed");
    process.exit(0);
  }
  process.stderr.write(output);
  throw new Error("deno doc --lint did not complete with a structured result");
}

for (const diagnostic of diagnostics) {
  const referenced = diagnostic.message.match(/references private type '([^']+)'/)?.[1];
  if (
    diagnostic.code !== "private-type-ref" ||
    referenced === undefined ||
    !allowedExternalTypes.has(referenced)
  ) {
    process.stderr.write(output);
    throw new Error(`unexpected deno doc diagnostic: ${diagnostic.code}: ${diagnostic.message}`);
  }
}

console.log(
  `deno doc --lint reported only ${diagnostics.length} references to named peer-dependency types`,
);
