import { readFile } from "node:fs/promises";

const [baselinePath, currentPath] = process.argv.slice(2);
if (!baselinePath || !currentPath) {
  throw new Error("usage: compare-benchmarks.mjs <baseline.json> <current.json>");
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const current = JSON.parse(await readFile(currentPath, "utf8"));
const major = Number(process.versions.node.split(".")[0]);
if (major !== baseline.nodeMajor) {
  throw new Error(
    `benchmark baseline requires Node ${baseline.nodeMajor}; current Node is ${major}`,
  );
}

const measurements = new Map();
for (const file of current.files) {
  for (const group of file.groups) {
    for (const benchmark of group.benchmarks) measurements.set(benchmark.name, benchmark.median);
  }
}

const failures = [];
for (const [name, expected] of Object.entries(baseline.medianMilliseconds)) {
  const actual = measurements.get(name);
  if (actual === undefined) {
    failures.push(`${name}: missing`);
    continue;
  }
  const change = actual / expected - 1;
  console.log(`${name}: ${actual.toFixed(6)} ms (${(change * 100).toFixed(1)}%)`);
  if (change > baseline.maxRegression)
    failures.push(`${name}: ${(change * 100).toFixed(1)}% slower`);
}
if (failures.length > 0) {
  throw new Error(
    `benchmark regression exceeded ${baseline.maxRegression * 100}%:\n${failures.join("\n")}`,
  );
}
