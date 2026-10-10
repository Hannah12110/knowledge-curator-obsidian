import { build } from "esbuild";

const result = await build({
  entryPoints: ["scripts/claim-graph-benchmark-runtime.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false
});
const code = result.outputFiles[0]?.text;
if (!code) throw new Error("Could not build Claim Graph benchmark runtime.");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const metrics = await runtime.runClaimGraphBenchmark(1_000, 5);
console.log("Claim Graph candidate benchmark (local, no LLM/network)");
console.log(JSON.stringify(metrics, null, 2));
if (metrics.candidatePairs >= metrics.allPairs / 10) {
  console.error("Candidate generation is too close to an all-pairs comparison.");
  process.exitCode = 1;
}
