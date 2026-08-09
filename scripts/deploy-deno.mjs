import manifest from "../deno.json" with { type: "json" };

const inactiveBuildMessage =
  "The build for this revision is no longer active. Re-run the deploy to start a new build.";

const { app, org } = manifest.deploy;

const deployArguments = [
  "deploy",
  "--json",
  "--non-interactive",
  "--org",
  org,
  "--app",
  app,
  "--prod",
];

function isInactiveBuild(result) {
  if (result.success) return false;

  for (const line of result.stderr.trim().split(/\r?\n/).reverse()) {
    try {
      const response = JSON.parse(line);
      if (response?.error?.message === inactiveBuildMessage) return true;
    } catch {
      // The deploy plugin may write download progress before its JSON envelope.
    }
  }

  return false;
}

export async function deployWithRetry(run) {
  let result = await run();

  if (isInactiveBuild(result)) {
    result = await run();
  }

  return result;
}

async function runDeploy() {
  const output = await new Deno.Command(Deno.execPath(), { args: deployArguments }).output();
  const decoder = new TextDecoder();
  const result = {
    code: output.code,
    stderr: decoder.decode(output.stderr),
    stdout: decoder.decode(output.stdout),
    success: output.success,
  };

  if (result.stdout) await Deno.stdout.write(new TextEncoder().encode(result.stdout));
  if (result.stderr) await Deno.stderr.write(new TextEncoder().encode(result.stderr));

  return result;
}

if (import.meta.main) {
  const result = await deployWithRetry(runDeploy);
  Deno.exit(result.code);
}
