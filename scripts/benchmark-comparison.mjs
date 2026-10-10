import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const runtimeBuild = await build({
  entryPoints: ["scripts/comparison-benchmark-runtime.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false,
  plugins: [{
    name: "obsidian-benchmark-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/u }, () => ({
        path: "obsidian",
        namespace: "obsidian-benchmark-stub"
      }));
      buildApi.onLoad({ filter: /.*/u, namespace: "obsidian-benchmark-stub" }, () => ({
        contents: "export async function requestUrl() { throw new Error('Unexpected provider request in local benchmark.'); }",
        loader: "js"
      }));
    }
  }]
});
const runtimeCode = runtimeBuild.outputFiles[0]?.text;
if (!runtimeCode) throw new Error("Could not build Comparison benchmark runtime.");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(runtimeCode).toString("base64")}`);

const readCases = async (name) => JSON.parse(
  await readFile(`KnowledgeCuratorRegression/claim-comparison/${name}`, "utf8")
).cases;
const harness = await readCases("harness-fixed.json");
const agentMemory = await readCases("agent-memory-fixed.json");
const allComparisonCases = await readCases("cases.json");
const conflict = allComparisonCases.filter((item) =>
  item.coverageV2?.coverage === "conflicting" || item.expected?.allowedRelations?.includes("challenge")
);
if (harness.length === 0 || agentMemory.length === 0 || conflict.length === 0) {
  throw new Error("Fixed Comparison benchmark fixtures are incomplete.");
}

const rows = await runtime.runComparisonBenchmark({ harness, agentMemory, conflict });
const baseline = {
  harness: { candidates: 30, llmCalls: 5, latencyMs: 46_200 },
  agentMemory: { candidates: 30, llmCalls: 5, latencyMs: 41_200 },
  conflict: { candidates: 8, llmCalls: 3, retries: 1, latencyMs: 23_700 }
};
const report = {
  generatedAt: new Date().toISOString(),
  mode: "fixed-fixture-local-execution-benchmark",
  note: "Provider baseline is historical and network-dependent. Current rows measure cache, Fast Path, packing and scheduler overhead with a deterministic delayed provider stub.",
  baseline,
  rows
};
await writeFile("comparison-benchmark.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log("Comparison execution benchmark (fixed candidates; local provider stub)");
console.log("Source | Mode | Candidates | Cache | Fast | LLM Candidates | Calls | Retry | Latency ms | Avg batch ms | P95 batch ms | Fast Precision");
for (const entry of rows) {
  const metric = entry.metrics;
  const batchDurations = metric.batchDurationsMs;
  const averageBatch = batchDurations.length === 0
    ? 0
    : batchDurations.reduce((sum, value) => sum + value, 0) / batchDurations.length;
  const p95Batch = percentile(batchDurations, 0.95);
  console.log([
    entry.source,
    entry.mode,
    metric.totalCandidates,
    metric.cacheHits,
    metric.fastPathCount,
    metric.llmCandidates,
    metric.llmCalls,
    metric.retries,
    metric.durationMs.toFixed(1),
    averageBatch.toFixed(1),
    p95Batch.toFixed(1),
    entry.fastPathPrecision === null ? "n/a" : `${(entry.fastPathPrecision * 100).toFixed(1)}%`
  ].join(" | "));
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}
