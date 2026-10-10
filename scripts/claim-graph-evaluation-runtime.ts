import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClaimStore } from "../src/types/claim";
import type { ValidationScope } from "../src/types/validation";
import { validateClaimStore } from "../src/services/claim-validator";
import { validateClaimGraphStore } from "../src/services/claim-graph-validator";
import { ClaimGraphCandidateService } from "../src/services/claim-graph-candidate-service";
import {
  assertEvaluationCurrent,
  assertEvaluationSnapshotCurrent,
  calculateGraphQualityMetrics,
  fingerprintGraph,
  generateGraphQualityDataset,
  validateAnnotations
} from "../src/services/claim-graph-evaluation-service";
import { sha256Text } from "../src/services/content-hash";
import { isPathInsideFolder } from "../src/services/path-scope";
import { runVaultValidation } from "./vault-validation-runtime";

export { calculateGraphQualityMetrics, validateAnnotations };

export interface GraphEvaluationBuildContext {
  model: string;
  promptVersion: string;
  temperature: number | null;
}

export async function generateRealGraphQualityDataset(
  vaultRoot: string,
  scope: ValidationScope,
  buildContext: GraphEvaluationBuildContext,
  now = new Date()
) {
  const before = await loadCurrentEvaluationState(vaultRoot, scope);
  if (!before.graphReady) throw new Error("Claim Graph 已 stale，请先重新构建再生成评测数据集。");
  const candidates = await new ClaimGraphCandidateService().generate(Object.values(before.claimStore.claims));
  const dataset = await generateGraphQualityDataset({
    snapshotId: before.snapshotId,
    claimStore: before.claimStore,
    graph: before.graph,
    candidatePairs: candidates.pairs,
    buildContext,
    generatedAt: now
  });
  return {
    dataset,
    candidateMetrics: candidates.metrics,
    sourceHashes: before.sourceHashes,
    graphReady: before.graphReady
  };
}

export async function generateGraphQualityDatasetFromStores(
  vaultRoot: string,
  scope: ValidationScope,
  snapshotId: string,
  buildContext: GraphEvaluationBuildContext,
  evaluationSnapshot: {
    id: string;
    graphSnapshotPath: string;
    graphSnapshotFileHash: string;
  },
  now = new Date()
) {
  const current = await loadFrozenEvaluationState(vaultRoot, scope);
  if (!current.graphReady) throw new Error("Claim Graph 已 stale，请先重新构建再生成评测数据集。");
  const candidates = await new ClaimGraphCandidateService().generate(Object.values(current.claimStore.claims));
  const dataset = await generateGraphQualityDataset({
    snapshotId,
    claimStore: current.claimStore,
    graph: current.graph,
    candidatePairs: candidates.pairs,
    buildContext,
    evaluationSnapshot,
    additionalKnownLimitations: [
      "旧 42-edge Step 3 基线在人工作业开始前因 Graph 运行间波动被 superseded；当前 43-edge 基线未通过再次调用模型重现。"
    ],
    generatedAt: now
  });
  return { dataset, candidateMetrics: candidates.metrics, sourceHashes: current.sourceHashes };
}

export async function loadCurrentEvaluationState(vaultRoot: string, scope: ValidationScope) {
  const claimStorePath = resolve(vaultRoot, ".knowledge-agent/claim-store/store.json");
  const graphStorePath = resolve(vaultRoot, ".knowledge-agent/claim-graph/store.json");
  const [claimStoreRaw, graphStoreRaw, vault] = await Promise.all([
    readFile(claimStorePath, "utf8"),
    readFile(graphStorePath, "utf8"),
    runVaultValidation(vaultRoot, scope)
  ]);
  const claimStore = validateClaimStore(JSON.parse(claimStoreRaw) as unknown);
  const graph = validateClaimGraphStore(JSON.parse(graphStoreRaw) as unknown);
  const revision = claimStoreRevision(claimStore, scope.wikiFolder);
  const claimStoreFingerprint = await sha256Text(revision);
  const graphFingerprint = await fingerprintGraph(graph);
  return {
    claimStore,
    graph,
    snapshotId: vault.snapshot.snapshotId,
    markdownCount: vault.snapshot.markdownCount,
    claimStoreFingerprint,
    graphFingerprint,
    graphReady: claimStoreFingerprint === graph.metadata.claimStoreFingerprint,
    sourceHashes: {
      claimStore: await sha256Text(claimStoreRaw),
      graphStore: await sha256Text(graphStoreRaw),
      markdownSnapshot: vault.snapshot.snapshotId
    }
  };
}

export async function assertRealEvaluationCurrent(
  vaultRoot: string,
  scope: ValidationScope,
  manifest: Parameters<typeof assertEvaluationCurrent>[0]
) {
  const current = await loadCurrentEvaluationState(vaultRoot, scope);
  assertEvaluationCurrent(manifest, current.claimStoreFingerprint, current.graphFingerprint);
  if (!current.graphReady) throw new Error("知识图谱已变化，请重新生成评测数据集。");
  return current;
}

/**
 * Review-only identity load. It intentionally reads only the two frozen
 * derived stores; it does not walk or materialize unrelated Vault Markdown.
 */
export async function loadFrozenEvaluationState(
  vaultRoot: string,
  scope: ValidationScope,
  graphSnapshotPath?: string
) {
  const claimStorePath = resolve(vaultRoot, ".knowledge-agent/claim-store/store.json");
  const liveGraphStorePath = resolve(vaultRoot, ".knowledge-agent/claim-graph/store.json");
  const graphStorePath = graphSnapshotPath === undefined ? liveGraphStorePath : resolve(graphSnapshotPath);
  const [claimStoreRaw, graphStoreRaw] = await Promise.all([
    readFile(claimStorePath, "utf8"),
    readFile(graphStorePath, "utf8")
  ]);
  const claimStore = validateClaimStore(JSON.parse(claimStoreRaw) as unknown);
  const graph = validateClaimGraphStore(JSON.parse(graphStoreRaw) as unknown);
  const claimStoreFingerprint = await sha256Text(claimStoreRevision(claimStore, scope.wikiFolder));
  const graphFingerprint = await fingerprintGraph(graph);
  let liveGraphFingerprint: string | undefined;
  if (graphSnapshotPath !== undefined) {
    try {
      const liveGraph = validateClaimGraphStore(JSON.parse(await readFile(liveGraphStorePath, "utf8")) as unknown);
      liveGraphFingerprint = await fingerprintGraph(liveGraph);
    } catch {
      // A live Graph is advisory once the immutable evaluation snapshot exists.
    }
  }
  return {
    claimStore,
    graph,
    claimStoreFingerprint,
    graphFingerprint,
    graphReady: claimStoreFingerprint === graph.metadata.claimStoreFingerprint,
    liveGraphFingerprint,
    liveGraphDiffers: liveGraphFingerprint !== undefined && liveGraphFingerprint !== graphFingerprint,
    sourceHashes: {
      claimStore: await sha256Text(claimStoreRaw),
      graphStore: await sha256Text(graphStoreRaw)
    }
  };
}

export async function assertFrozenEvaluationCurrent(
  vaultRoot: string,
  scope: ValidationScope,
  manifest: Parameters<typeof assertEvaluationCurrent>[0],
  graphSnapshotPath?: string
) {
  const current = await loadFrozenEvaluationState(vaultRoot, scope, graphSnapshotPath);
  const snapshotStatus = assertEvaluationSnapshotCurrent(
    manifest,
    current.claimStoreFingerprint,
    current.graphFingerprint,
    current.liveGraphFingerprint
  );
  if (!current.graphReady) throw new Error("Claim Store 已变化，请重新生成评测数据集。");
  return { ...current, ...snapshotStatus };
}

function claimStoreRevision(store: ClaimStore, wikiFolder: string): string {
  const entries = Object.entries(store.files)
    .filter(([path]) => isPathInsideFolder(path, wikiFolder))
    .map(([path, value]) => `${path}:${value.fileHash}`)
    .sort();
  return entries.length === 0 ? "not-built" : entries.join("|");
}
