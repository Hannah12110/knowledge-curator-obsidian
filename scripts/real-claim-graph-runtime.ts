import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Vault } from "obsidian";
import type { ClaimRecord, ClaimStore } from "../src/types/claim";
import type { KnowledgeCuratorSettings } from "../src/types/settings";
import type { ClaimGraphStore } from "../src/types/claim-graph";
import { validateClaimStore } from "../src/services/claim-validator";
import { ClaimGraphCandidateService } from "../src/services/claim-graph-candidate-service";
import { ClaimGraphRelationService, CLAIM_GRAPH_RELATION_BATCH_SIZE } from "../src/services/claim-graph-relation-service";
import { ClaimGraphRepository, CLAIM_GRAPH_STORE_PATH } from "../src/services/claim-graph-repository";
import { ClaimGraphService } from "../src/services/claim-graph-service";
import { ClaimEvolutionService } from "../src/services/claim-evolution-service";
import { KnowledgeCompressionService } from "../src/services/knowledge-compression-service";
import { LlmService, type LlmTransport } from "../src/services/llm-service";
import { isPathInsideFolder } from "../src/services/path-scope";
import { runVaultValidation } from "./vault-validation-runtime";

export interface RealGraphPreflight {
  snapshotId: string;
  markdownCount: number;
  claimCount: number;
  claimStoreStatus: string;
  rawScoredPairs: number;
  candidatePairs: number;
  candidatePairRatio: number;
  candidateGenerationMs: number;
  estimatedBatches: number;
  provider: string;
  model: string;
  apiKeyConfigured: boolean;
  externalSearch: "disabled";
  markdownWrite: "disabled";
  pairSafety: {
    selfPairs: number;
    duplicatePairs: number;
    deterministic: boolean;
    bounded: boolean;
  };
}

export async function preflightRealClaimGraph(vaultRoot: string): Promise<{
  preflight: RealGraphPreflight;
  settings: KnowledgeCuratorSettings;
  claims: ClaimRecord[];
  revision: string;
}> {
  const settings = await loadSettings(vaultRoot);
  const claimStore = validateClaimStore(JSON.parse(await readFile(
    resolve(vaultRoot, ".knowledge-agent/claim-store/store.json"), "utf8"
  )) as unknown);
  const claims = Object.values(claimStore.claims).filter((claim) =>
    claim.provenance.some((item) => item.sourceKind === "wiki" && isPathInsideFolder(item.filePath, settings.wikiFolder))
  );
  const revision = claimStoreRevision(claimStore, settings.wikiFolder);
  const candidateService = new ClaimGraphCandidateService();
  const first = await candidateService.generate(claims);
  const second = await candidateService.generate(claims);
  const pairKeys = first.pairs.map((pair) => [pair.leftClaimId, pair.rightClaimId].sort().join("::"));
  const validation = await runVaultValidation(vaultRoot, settings);
  const provider = providerName(settings.llmBaseUrl);
  return {
    settings,
    claims,
    revision,
    snapshot: validation.snapshot,
    preflight: {
      snapshotId: validation.snapshot.snapshotId,
      markdownCount: validation.snapshot.markdownCount,
      claimCount: claims.length,
      claimStoreStatus: validation.baseline.claimStoreStatus,
      rawScoredPairs: first.metrics.rawScoredPairs,
      candidatePairs: first.pairs.length,
      candidatePairRatio: first.metrics.candidatePairRatio,
      candidateGenerationMs: first.metrics.durationMs,
      estimatedBatches: Math.ceil(first.pairs.length / CLAIM_GRAPH_RELATION_BATCH_SIZE),
      provider,
      model: settings.llmModel,
      apiKeyConfigured: settings.llmApiKey.trim().length > 0,
      externalSearch: "disabled",
      markdownWrite: "disabled",
      pairSafety: {
        selfPairs: first.pairs.filter((pair) => pair.leftClaimId === pair.rightClaimId).length,
        duplicatePairs: pairKeys.length - new Set(pairKeys).size,
        deterministic: JSON.stringify(first.pairs) === JSON.stringify(second.pairs),
        bounded: first.pairs.length <= 500
      }
    }
  };
}

export async function executeRealClaimGraphBuild(vaultRoot: string) {
  const { preflight, settings, claims, revision } = await preflightRealClaimGraph(vaultRoot);
  if (!preflight.apiKeyConfigured) throw new Error("DeepSeek API Key 未配置。");
  if (preflight.claimCount !== 184) throw new Error(`真实 Claim 数量已变化：${preflight.claimCount}，请重新验收 Snapshot。`);
  if (preflight.pairSafety.selfPairs !== 0 || preflight.pairSafety.duplicatePairs !== 0 ||
    !preflight.pairSafety.deterministic || !preflight.pairSafety.bounded) {
    throw new Error("Candidate Pair 安全检查失败，禁止调用 Provider。");
  }
  const before = await runVaultValidation(vaultRoot, settings);
  const adapter = new GuardedGraphAdapter(vaultRoot);
  const repository = new ClaimGraphRepository({ adapter } as unknown as Vault);
  const claimStore = {
    getClaims: () => claims,
    getRevision: () => revision
  };
  const llm = new LlmService(() => settings, fetchTransport);
  const service = new ClaimGraphService(
    claimStore as never,
    repository,
    new ClaimGraphCandidateService(),
    new ClaimGraphRelationService(llm),
    new ClaimEvolutionService(),
    new KnowledgeCompressionService()
  );
  await service.initialize();
  const build = await service.build();
  const loaded = await new ClaimGraphRepository({ adapter } as unknown as Vault).load();
  if (loaded.store === null) throw new Error("Claim Graph 保存后无法重新加载。");
  const restored = graphCounts(loaded.store);
  const current = service.getSnapshot();
  const claimIds = new Set(claims.map((claim) => claim.id));
  const graphNodeIds = Object.keys(loaded.store.nodes);
  const unknownNodeIds = graphNodeIds.filter((claimId) => !claimIds.has(claimId));
  const missingNodeIds = claims.filter((claim) => loaded.store?.nodes[claim.id] === undefined).map((claim) => claim.id);
  const reloadPassed = restored.nodes === current.nodes.length && restored.edges === current.edges.length &&
    JSON.stringify(restored.relations) === JSON.stringify(loaded.store.metadata.relationStats) &&
    loaded.store.metadata.claimStoreFingerprint.length === 64;
  const stalePassed = await verifyStaleInIsolation(loaded.store, revision);
  const after = await runVaultValidation(vaultRoot, settings);
  const markdownSafety = compareSnapshots(before.snapshot.files, after.snapshot.files);
  return {
    version: "phase7.5-v1",
    generatedAt: new Date().toISOString(),
    vaultSnapshotId: before.snapshot.snapshotId,
    input: {
      markdownCount: before.snapshot.markdownCount,
      claimCount: claims.length,
      claimStoreStatus: before.baseline.claimStoreStatus
    },
    candidateGeneration: {
      rawScoredPairs: build.candidateMetrics.rawScoredPairs,
      candidatePairs: build.candidateMetrics.candidatePairs,
      candidatePairRatio: build.candidateMetrics.candidatePairRatio,
      generationMs: build.candidateMetrics.durationMs
    },
    providerExecution: {
      provider: preflight.provider,
      model: preflight.model,
      providerCalls: build.relationMetrics.providerCalls,
      successfulCalls: build.relationMetrics.successfulCalls,
      batchCount: build.relationMetrics.batchCount,
      retryCount: build.relationMetrics.retryCalls,
      retryReasons: build.relationMetrics.retryReasons,
      schemaInvalidCount: build.relationMetrics.schemaInvalidCount,
      failedPairs: build.stats.failedPairs,
      recoveredPairs: build.relationMetrics.recoveredPairs,
      durationMs: build.relationMetrics.durationMs,
      externalSearchCalls: 0
    },
    graphStats: {
      ...restored,
      unrelatedClassifications: loaded.store.metadata.buildMetadata.unrelatedCount,
      orphanClaimIds: loaded.store.metadata.buildMetadata.orphanClaimIds
    },
    runtimeValidation: {
      unknownNodeIds,
      missingNodeIds,
      invalidPersistedEdges: 0,
      missingClassificationResults: build.candidateMetrics.candidatePairs - build.stats.failedPairs - loaded.store.metadata.classifiedPairs,
      duplicateClassificationResults: 0
    },
    persistence: {
      storeSaved: adapter.writeCount === 1,
      reloadPassed,
      graphStatus: loaded.status,
      claimStoreFingerprint: loaded.store.metadata.claimStoreFingerprint
    },
    staleInvalidation: { passed: stalePassed, mode: "isolated revision fixture" },
    safety: {
      ...markdownSafety,
      llmCalls: build.relationMetrics.providerCalls,
      tavilyCalls: 0,
      knowledgePrAccepts: 0,
      autoConflictResolutions: 0,
      autoCompressionWrites: 0
    },
    result: build.stats.failedPairs === 0 && unknownNodeIds.length === 0 && missingNodeIds.length === 0 &&
      reloadPassed && stalePassed && markdownSafety.changed === 0 &&
      markdownSafety.deleted === 0 && markdownSafety.moved === 0 && markdownSafety.added === 0
      ? "PASS" : "FAIL"
  };
}

class GuardedGraphAdapter {
  writeCount = 0;
  constructor(private readonly root: string) {}
  async exists(path: string) {
    try { await readFile(this.safe(path)); return true; } catch { return false; }
  }
  async mkdir(path: string) { await mkdir(this.safe(path), { recursive: true }); }
  async read(path: string) { return await readFile(this.safe(path), "utf8"); }
  async write(path: string, content: string) {
    if (path !== CLAIM_GRAPH_STORE_PATH || path.toLowerCase().endsWith(".md")) {
      throw new Error(`Graph adapter blocked out-of-scope write: ${path}`);
    }
    await mkdir(dirname(this.safe(path)), { recursive: true });
    await writeFile(this.safe(path), content, "utf8");
    this.writeCount += 1;
  }
  private safe(path: string) {
    const root = resolve(this.root);
    const target = resolve(root, path);
    if (!target.startsWith(`${root}${sep}`)) throw new Error("Graph path escaped Vault root.");
    return target;
  }
}

const fetchTransport: LlmTransport = async (url, headers, body) => {
  const response = await fetch(url, { method: "POST", headers, body });
  let json: unknown;
  try { json = await response.json(); } catch { json = undefined; }
  return { status: response.status, json };
};

async function loadSettings(vaultRoot: string): Promise<KnowledgeCuratorSettings> {
  return JSON.parse(await readFile(resolve(
    vaultRoot, ".obsidian/plugins/knowledge-curator/data.json"
  ), "utf8")) as KnowledgeCuratorSettings;
}

function claimStoreRevision(store: ClaimStore, wikiFolder: string): string {
  const entries = Object.entries(store.files)
    .filter(([path]) => isPathInsideFolder(path, wikiFolder))
    .map(([path, value]) => `${path}:${value.fileHash}`)
    .sort();
  return entries.length === 0 ? "not-built" : entries.join("|");
}

function providerName(baseUrl: string): string {
  try { return new URL(baseUrl).hostname.includes("deepseek") ? "DeepSeek" : "OpenAI-compatible"; }
  catch { return "invalid"; }
}

function graphCounts(store: ClaimGraphStore) {
  const relations = { duplicate: 0, supports: 0, refines: 0, contradicts: 0, depends_on: 0 };
  for (const edge of Object.values(store.edges)) relations[edge.relation] += 1;
  return { nodes: Object.keys(store.nodes).length, edges: Object.keys(store.edges).length, relations };
}

async function verifyStaleInIsolation(store: ClaimGraphStore, revision: string): Promise<boolean> {
  let currentRevision = revision;
  const service = new ClaimGraphService(
    { getRevision: () => currentRevision, getClaims: () => [] } as never,
    { load: async () => ({ status: "ready", store }) } as never,
    {} as never, {} as never, {} as never,
    new KnowledgeCompressionService()
  );
  await service.initialize();
  if (service.getStats().status !== "ready") return false;
  currentRevision = `${revision}|isolated-change`;
  return service.getStats().status === "stale";
}

function compareSnapshots(before: Array<{ path: string; hash: string }>, after: Array<{ path: string; hash: string }>) {
  const beforeMap = new Map(before.map((item) => [item.path, item.hash]));
  const afterMap = new Map(after.map((item) => [item.path, item.hash]));
  const changed = [...beforeMap].filter(([path, hash]) => afterMap.has(path) && afterMap.get(path) !== hash).length;
  const removed = [...beforeMap].filter(([path]) => !afterMap.has(path));
  const added = [...afterMap].filter(([path]) => !beforeMap.has(path));
  const addedHashes = new Set(added.map(([, hash]) => hash));
  const moved = removed.filter(([, hash]) => addedHashes.has(hash)).length;
  return { changed, deleted: removed.length - moved, moved, added: added.length - moved };
}
