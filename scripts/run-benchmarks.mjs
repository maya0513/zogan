import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [baselinePath] = process.argv.slice(2);
if (!baselinePath) throw new Error("usage: run-benchmarks.mjs <baseline.json>");

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const major = Number(process.versions.node.split(".")[0]);
if (major !== baseline.nodeMajor) {
  throw new Error(
    `benchmark baseline requires Node ${baseline.nodeMajor}; current Node is ${major}`,
  );
}

const reports = [];
const outputs = [];

try {
  for (let run = 1; run <= 3; run += 1) {
    const output = join(tmpdir(), `zogan-benchmark-${process.pid}-${run}.json`);
    outputs.push(output);
    const result = spawnSync(
      "vp",
      ["test", "bench", "--config", "vite.bench.config.ts", "--outputJson", output],
      { cwd: process.cwd(), env: process.env, stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`benchmark run ${run} failed with exit code ${result.status ?? "unknown"}`);
    }
    reports.push(JSON.parse(readFileSync(output, "utf8")));
  }
} finally {
  for (const output of outputs) rmSync(output, { force: true });
}

const medians = new Map();
for (const report of reports) {
  for (const file of report.files) {
    for (const group of file.groups) {
      for (const benchmark of group.benchmarks) {
        const values = medians.get(benchmark.name) ?? [];
        values.push(benchmark.median);
        medians.set(benchmark.name, values);
      }
    }
  }
}

const aggregate = structuredClone(reports.at(-1));
for (const file of aggregate.files) {
  for (const group of file.groups) {
    for (const benchmark of group.benchmarks) {
      const values = medians.get(benchmark.name)?.toSorted((left, right) => left - right);
      if (values?.length !== 3) throw new Error(`missing benchmark run: ${benchmark.name}`);
      benchmark.median = values[1];
      benchmark.runMedians = values;
    }
  }
}
aggregate.aggregation = "median of three run medians";
writeFileSync("benchmarks/current.json", `${JSON.stringify(aggregate, null, 2)}\n`);
