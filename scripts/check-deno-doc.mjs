import { checkDenoDocOutput } from "./deno-doc-diagnostics.mjs";

let output = "";
for await (const chunk of process.stdin) output += chunk;

try {
  console.log(checkDenoDocOutput(output));
} catch (error) {
  process.stderr.write(output);
  throw error;
}
