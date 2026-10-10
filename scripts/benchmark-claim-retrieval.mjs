import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

const result = await build({
  entryPoints: ["scripts/claim-retrieval-benchmark-runtime.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false
});
const code = result.outputFiles[0]?.text;
if (!code) throw new Error("Could not build Claim Retrieval benchmark runtime.");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const plan = [
  [184, 40],
  [1_000, 30],
  [5_000, 15],
  [10_000, 10]
];
const rows = plan.map(([size, iterations]) => runtime.runRetrievalBenchmark(size, iterations));
const batch30Ms = runtime.runThirtyClaimBatch(184);
const report = {
  generatedAt: new Date().toISOString(),
  retrievalVersion: "claim-retrieval-v2",
  rows,
  currentStoreThirtyClaimBatchMs: batch30Ms,
  notes: "Warm-cache deterministic CPU benchmark; excludes LLM calls and file I/O."
};
await writeFile("claim-retrieval-benchmark.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdown = [
  "# Claim Retrieval Benchmark",
  "",
  `Generated: ${report.generatedAt}`,
  `Version: ${report.retrievalVersion}`,
  "",
  "| Claims | Iterations | Avg ms | P95 ms |",
  "|---:|---:|---:|---:|",
  ...rows.map((row) => `| ${row.claims} | ${row.iterations} | ${row.averageMs} | ${row.p95Ms} |`),
  "",
  `30 Candidate Claims against 184 Existing Claims: ${batch30Ms} ms`,
  "",
  report.notes,
  ""
].join("\n");
await writeFile("claim-retrieval-benchmark.md", markdown, "utf8");
console.log(markdown);
