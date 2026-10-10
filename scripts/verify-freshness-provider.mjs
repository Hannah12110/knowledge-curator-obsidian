import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const vaultPath = process.env.TEST_VAULT?.trim();
if (!vaultPath) {
  throw new Error("TEST_VAULT is required.");
}
const pluginDataPath = resolve(vaultPath, ".obsidian/plugins/knowledge-curator/data.json");
const claimStorePath = resolve(vaultPath, ".knowledge-agent/claim-store/store.json");
const maintenanceStorePath = resolve(vaultPath, ".knowledge-agent/maintenance/maintenance-store.json");
const settings = JSON.parse(await readFile(pluginDataPath, "utf8"));
if (!settings.searchApiKey || !settings.llmApiKey) {
  throw new Error("BLOCKED: Tavily 或 LLM API Key 未配置。");
}
const claimStore = JSON.parse(await readFile(claimStorePath, "utf8"));
const maintenanceStore = JSON.parse(await readFile(maintenanceStorePath, "utf8"));
const requestedClaimId = process.env.FRESHNESS_CLAIM_ID?.trim();
const records = Object.values(maintenanceStore.records);
const record = requestedClaimId
  ? maintenanceStore.records[requestedClaimId]
  : records
      .filter((item) => item.freshnessRisk === "critical" || item.freshnessRisk === "high")
      .sort((left, right) => right.riskScore - left.riskScore)[0];
if (!record) throw new Error("未找到可验证的 High/Critical Claim，请先扫描 Freshness Risk。");
const claim = claimStore.claims[record.claimId];
if (!claim) throw new Error(`Claim Store 中未找到 ${record.claimId}。`);

const bundle = await build({
  entryPoints: ["scripts/freshness-provider-e2e-runtime.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false,
  plugins: [{
    name: "obsidian-provider-e2e-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/u }, () => ({
        path: "obsidian",
        namespace: "obsidian-provider-e2e-stub"
      }));
      buildApi.onLoad({ filter: /.*/u, namespace: "obsidian-provider-e2e-stub" }, () => ({
        contents: "export async function requestUrl() { throw new Error('Injected transport expected.'); }",
        loader: "js"
      }));
    }
  }]
});
const code = bundle.outputFiles[0]?.text;
if (!code) throw new Error("Could not build Freshness Provider E2E runtime.");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const startedAt = performance.now();
const entry = await runtime.runFreshnessProviderE2E({ settings, claim, record });
const durationMs = performance.now() - startedAt;

maintenanceStore.verifications[entry.result.id] = entry.result;
maintenanceStore.verificationCache[entry.cacheKey] = entry;
record.lastVerifiedAt = entry.result.verifiedAt;
record.latestVerificationId = entry.result.id;
record.latestResolution = entry.result.resolution;
maintenanceStore.generatedAt = new Date().toISOString();
await writeFile(maintenanceStorePath, `${JSON.stringify(maintenanceStore, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  claim: claim.statement,
  claimId: claim.id,
  risk: record.freshnessRisk,
  riskScore: record.riskScore,
  queries: entry.queries,
  provider: entry.provider,
  model: entry.model,
  rankedSources: entry.rankedSources.map((source) => ({
    title: source.title,
    url: source.url,
    domain: source.domain,
    tier: source.score.tier,
    sourceType: source.score.sourceType,
    reason: source.score.reason
  })),
  resolution: entry.result.resolution,
  conclusion: entry.result.conclusion,
  reasoning: entry.result.reasoning,
  confidence: entry.result.confidence,
  evidence: entry.result.evidence.map((evidence) => ({
    title: evidence.title,
    url: evidence.url,
    tier: evidence.sourceTier,
    sourceType: evidence.sourceType,
    supports: evidence.supports
  })),
  durationMs
}, null, 2));
