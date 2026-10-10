import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await loadLocalEnvironment();
const configuredVault = argument("--vault") ?? process.env.TEST_VAULT?.trim();
if (!configuredVault) throw new Error("TEST_VAULT 未配置，请使用 --vault <path>。");
const vaultRoot = resolvePath(configuredVault);
const runtime = await loadRuntime();
const { preflight, snapshot } = await runtime.preflightRealClaimGraph(vaultRoot);
const reports = path.join(projectRoot, "KnowledgeCuratorValidation", "reports");
await mkdir(reports, { recursive: true });
const { apiKeyConfigured: _credentialPresent, ...publicPreflight } = preflight;
await writeFile(path.join(reports, "real-claim-graph-build-preflight.json"), `${JSON.stringify({
  version: "phase7.5-v1", generatedAt: new Date().toISOString(), ...publicPreflight
}, null, 2)}\n`, "utf8");
await writeFile(path.join(reports, "real-claim-graph-before-manifest.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

console.log("Phase 7.5 Step 2 Real Claim Graph preflight");
console.log(JSON.stringify(preflight, null, 2));

if (!process.argv.includes("--execute") || !process.argv.includes("--confirm-real-provider")) {
  console.log("PREPARED: 未调用 Provider。收到用户明确确认后，使用 --execute --confirm-real-provider 执行。");
  process.exit(0);
}
if (preflight.provider !== "DeepSeek") throw new Error(`Provider 不是 DeepSeek：${preflight.provider}`);
console.log(`Claims: ${preflight.claimCount}`);
console.log(`Candidate Pairs: ${preflight.candidatePairs}`);
console.log(`Estimated Batches: ${preflight.estimatedBatches}`);
console.log(`Provider: ${preflight.provider} / ${preflight.model}`);
console.log("External Search: Disabled");
console.log("Markdown Write: Disabled");

const report = await runtime.executeRealClaimGraphBuild(vaultRoot);
await writeFile(path.join(reports, "real-claim-graph-build.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(reports, "real-claim-graph-build.md"), renderMarkdown(report), "utf8");
console.log(JSON.stringify(report, null, 2));
if (report.result !== "PASS") process.exitCode = 1;

async function loadRuntime() {
  const result = await build({
    entryPoints: ["scripts/real-claim-graph-runtime.ts"], bundle: true,
    platform: "node", format: "esm", target: "node20", write: false,
    plugins: [{
      name: "obsidian-headless-stub",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^obsidian$/u }, () => ({ path: "obsidian", namespace: "obsidian-headless-stub" }));
        buildApi.onLoad({ filter: /.*/u, namespace: "obsidian-headless-stub" }, () => ({
          contents: "export async function requestUrl() { throw new Error('Headless build must use the injected fetch transport.'); }",
          loader: "js"
        }));
      }
    }]
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("无法构建 Real Claim Graph runtime。");
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function resolvePath(value) { return path.resolve(projectRoot, value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value); }
async function loadLocalEnvironment() {
  try {
    const contents = await readFile(path.join(projectRoot, ".env.local"), "utf8");
    for (const raw of contents.split(/\r?\n/u)) {
      const line = raw.trim(); if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
      if (!match) throw new Error(`Invalid .env.local line: ${raw}`);
      if (process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
function renderMarkdown(report) {
  const p = report.providerExecution; const c = report.candidateGeneration; const g = report.graphStats; const s = report.safety;
  return `# Phase 7.5 Step 2 — Real Claim Graph Build\n\n## Input\n\n- Snapshot ID: \`${report.vaultSnapshotId}\`\n- Markdown: ${report.input.markdownCount}\n- Claims: ${report.input.claimCount}\n- Claim Store: ${report.input.claimStoreStatus}\n\n## Candidate Generation\n\n- Raw Scored Pairs: ${c.rawScoredPairs}\n- Final Candidate Pairs: ${c.candidatePairs}\n- Candidate Ratio: ${c.candidatePairRatio}\n- Generation: ${c.generationMs} ms\n\n## Provider Execution\n\n- Provider / Model: ${p.provider} / ${p.model}\n- Calls: ${p.providerCalls}\n- Batches: ${p.batchCount}\n- Retries: ${p.retryCount}\n- Schema Invalid: ${p.schemaInvalidCount}\n- Failed Pairs: ${p.failedPairs}\n- Recovered Pairs: ${p.recoveredPairs}\n- Duration: ${p.durationMs} ms\n\n## Graph Stats\n\n- Nodes: ${g.nodes}\n- Edges: ${g.edges}\n- Relations: ${JSON.stringify(g.relations)}\n- Unrelated classifications: ${g.unrelatedClassifications}\n- Orphan Claims: ${g.orphanClaimIds.length}\n\n## Persistence\n\n- Store saved: ${report.persistence.storeSaved}\n- Reload: ${report.persistence.reloadPassed}\n- Status: ${report.persistence.graphStatus}\n\n## Stale Invalidation\n\n- ${report.staleInvalidation.passed ? "PASS" : "FAIL"}\n\n## Safety\n\n- Markdown changed: ${s.changed}\n- Deleted: ${s.deleted}\n- Moved: ${s.moved}\n- Added: ${s.added}\n- LLM calls: ${s.llmCalls}\n- Tavily calls: ${s.tavilyCalls}\n- Knowledge PR Accept: ${s.knowledgePrAccepts}\n\n## Result\n\n${report.result}\n`;
}
