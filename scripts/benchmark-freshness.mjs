import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

const result = await build({ entryPoints: ["scripts/freshness-benchmark-runtime.ts"], bundle: true, platform: "node", format: "esm", target: "node20", write: false });
const code = result.outputFiles[0]?.text;
if (!code) throw new Error("Could not build Freshness benchmark runtime.");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const report = { generatedAt: new Date().toISOString(), mode: "fixed-local-risk-scan", result: await runtime.benchmarkFreshness(184) };
await writeFile("freshness-benchmark.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("Freshness risk benchmark (local deterministic; no network)");
console.log(JSON.stringify(report.result, null, 2));
