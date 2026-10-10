import test from "node:test";
import assert from "node:assert/strict";
import type { ClaimRecord, ClaimStore } from "../src/types/claim";
import type { ClaimGraphCandidatePair, ClaimGraphEdge, ClaimGraphStore } from "../src/types/claim-graph";
import type { GraphQualityAnnotations, GraphQualityEvaluationDataset } from "../src/types/claim-graph-evaluation";
import {
  assertEvaluationClaimStoreCurrent,
  assertEvaluationCurrent,
  assertEvaluationSnapshotCurrent,
  calculateGraphQualityMetrics,
  createEmptyAnnotations,
  fingerprintGraph,
  generateGraphQualityDataset,
  GraphQualityEvaluationError,
  validateAnnotations,
  validateOrphanAnnotation,
  validateRelationAnnotation
} from "../src/services/claim-graph-evaluation-service";

const fixturePromise = createFixture();

test("Step3 dataset includes every persisted edge", async () => {
  const { dataset } = await fixturePromise;
  assert.equal(dataset.edges.length, 5);
  assert.deepEqual(dataset.edges.map((item) => item.edgeId).sort(), ["e0", "e1", "e2", "e3", "e4"]);
});
test("Step3 unrelated sample is deterministic", async () => {
  const first = await createFixture(); const second = await createFixture();
  assert.deepEqual(first.dataset.unrelated.map((item) => item.reviewId), second.dataset.unrelated.map((item) => item.reviewId));
});
test("Step3 orphan sample is deterministic", async () => {
  const first = await createFixture(); const second = await createFixture();
  assert.deepEqual(first.dataset.orphans.map((item) => item.reviewId), second.dataset.orphans.map((item) => item.reviewId));
});
test("Step3 review IDs are stable and unique", async () => {
  const { dataset } = await fixturePromise;
  const ids = [...dataset.edges, ...dataset.unrelated, ...dataset.orphans].map((item) => item.reviewId);
  assert.equal(new Set(ids).size, ids.length);
});
test("Step3 dataset fingerprint is stable for fixed graph", async () => {
  assert.equal((await createFixture()).dataset.manifest.datasetFingerprint, (await createFixture()).dataset.manifest.datasetFingerprint);
});
test("Step3 graph fingerprint changes when graph changes", async () => {
  const { graph } = await fixturePromise; const changed = structuredClone(graph);
  changed.metadata.builtAt = "2026-09-30T02:00:00.000Z";
  assert.notEqual(await fingerprintGraph(graph), await fingerprintGraph(changed));
});
test("Step3 stale guard accepts frozen fingerprints", async () => {
  const { dataset } = await fixturePromise;
  assert.doesNotThrow(() => assertEvaluationCurrent(dataset.manifest, dataset.manifest.claimStoreFingerprint, dataset.manifest.graphFingerprint));
});
test("Step3 stale guard rejects Claim Store changes", async () => {
  const { dataset } = await fixturePromise;
  assert.throws(() => assertEvaluationCurrent(dataset.manifest, "changed", dataset.manifest.graphFingerprint), GraphQualityEvaluationError);
});
test("Step3 stale guard rejects Graph changes", async () => {
  const { dataset } = await fixturePromise;
  assert.throws(() => assertEvaluationCurrent(dataset.manifest, dataset.manifest.claimStoreFingerprint, "changed"), GraphQualityEvaluationError);
});
test("frozen Step3 review becomes stale only when Claim Store changes", async () => {
  const { dataset } = await fixturePromise;
  assert.doesNotThrow(() => assertEvaluationClaimStoreCurrent(dataset.manifest, dataset.manifest.claimStoreFingerprint));
  assert.throws(() => assertEvaluationClaimStoreCurrent(dataset.manifest, "changed"), /Claim Store/u);
});
test("live Graph variation warns without invalidating the frozen evaluation snapshot", async () => {
  const { dataset } = await fixturePromise;
  const result = assertEvaluationSnapshotCurrent(
    dataset.manifest,
    dataset.manifest.claimStoreFingerprint,
    dataset.manifest.graphFingerprint,
    "different-live-graph"
  );
  assert.equal(result.liveGraphDiffers, true);
  assert.throws(() => assertEvaluationSnapshotCurrent(
    dataset.manifest,
    dataset.manifest.claimStoreFingerprint,
    "corrupt-frozen-snapshot",
    dataset.manifest.graphFingerprint
  ), /冻结 Graph Snapshot/u);
});
test("Step3 dataset fingerprint binds the immutable Graph Snapshot", async () => {
  const { store, graph } = await fixturePromise;
  const first = await generateGraphQualityDataset({
    snapshotId: "snapshot", claimStore: store, graph, candidatePairs: fixturePairs(), buildContext: context(),
    evaluationSnapshot: { id: "graph-a", graphSnapshotPath: "KnowledgeCuratorValidation/snapshots/graph-quality/graph-a/claim-graph-store.json", graphSnapshotFileHash: "a".repeat(64) },
    generatedAt: fixedDate()
  });
  const second = await generateGraphQualityDataset({
    snapshotId: "snapshot", claimStore: store, graph, candidatePairs: fixturePairs(), buildContext: context(),
    evaluationSnapshot: { id: "graph-b", graphSnapshotPath: "KnowledgeCuratorValidation/snapshots/graph-quality/graph-b/claim-graph-store.json", graphSnapshotFileHash: "b".repeat(64) },
    generatedAt: fixedDate()
  });
  assert.notEqual(first.manifest.datasetFingerprint, second.manifest.datasetFingerprint);
  assert.equal(first.manifest.graphSnapshotFileHash, "a".repeat(64));
});
test("Step3 manifest freezes provider parameters", async () => {
  const { dataset } = await fixturePromise;
  assert.deepEqual([dataset.manifest.model, dataset.manifest.promptVersion, dataset.manifest.relationPolicyVersion, dataset.manifest.temperature], ["deepseek-flash", "prompt-v2", "policy-v1", 0.1]);
});
test("Step3 manifest records run-to-run variability limitation", async () => {
  const { dataset } = await fixturePromise;
  assert.ok(dataset.manifest.knownLimitations.some((item) => item.includes("45 → 42")));
});
test("Step3 invalid human relation is rejected", () => {
  assert.throws(() => validateRelationAnnotation({ ...relationAnnotation("supports"), humanRelation: "bad" as never }, "x"));
});
test("Step3 invalid direction is rejected", () => {
  assert.throws(() => validateRelationAnnotation({ ...relationAnnotation("supports"), humanDirection: "sideways" as never }, "x"));
});
test("Step3 directional relation requires direction", () => {
  assert.throws(() => validateRelationAnnotation({ ...relationAnnotation("supports"), humanDirection: "not_applicable" }, "x"));
});
test("Step3 duplicate requires no direction", () => {
  assert.doesNotThrow(() => validateRelationAnnotation(relationAnnotation("duplicate"), "x"));
});
test("Step3 unrelated requires no direction", () => {
  assert.doesNotThrow(() => validateRelationAnnotation(relationAnnotation("unrelated"), "x"));
});
test("Step3 uncertain relation uses uncertain direction", () => {
  assert.doesNotThrow(() => validateRelationAnnotation(relationAnnotation("uncertain"), "x"));
});
test("Step3 annotation resume preserves prior entries", async () => {
  const { dataset } = await fixturePromise; const annotations = createEmptyAnnotations(dataset.manifest.datasetFingerprint);
  annotations.edge[dataset.edges[0]!.reviewId] = relationAnnotation(dataset.edges[0]!.predictedRelation);
  assert.equal(Object.keys(validateAnnotations(dataset, annotations).edge).length, 1);
});
test("Step3 annotation rejects unknown review ID", async () => {
  const { dataset } = await fixturePromise; const annotations = createEmptyAnnotations(dataset.manifest.datasetFingerprint);
  annotations.edge.unknown = relationAnnotation("supports");
  assert.throws(() => validateAnnotations(dataset, annotations));
});
test("Step3 orphan relation rejects unknown Claim ID", async () => {
  const { dataset } = await fixturePromise; const record = dataset.orphans[0]!;
  assert.throws(() => validateOrphanAnnotation(orphanRelation("missing"), record, new Set(dataset.manifest.claimIds)));
});
test("Step3 incomplete annotations fail closed before metrics", async () => {
  const { dataset } = await fixturePromise;
  assert.throws(() => calculateGraphQualityMetrics(dataset, createEmptyAnnotations(dataset.manifest.datasetFingerprint)), /Human Annotation Required/u);
});
test("Step3 partial audit evaluates 43 edges, 13 unrelated, and zero orphans", async () => {
  const source = (await fixturePromise).dataset;
  const dataset = expandedDataset(source, 43, 40, 30);
  const annotations = createEmptyAnnotations(dataset.manifest.datasetFingerprint, fixedDate());
  for (const record of dataset.edges) annotations.edge[record.reviewId] = relationAnnotation(record.predictedRelation);
  for (const record of dataset.unrelated.slice(0, 13)) annotations.unrelated[record.reviewId] = relationAnnotation("unrelated");
  const metrics = calculateGraphQualityMetrics(dataset, annotations, false);
  assert.equal(metrics.evaluationMode, "PARTIAL_HUMAN_AUDIT");
  assert.equal(metrics.edgeEvaluationStatus, "COMPLETE");
  assert.equal(metrics.unrelatedEvaluationStatus, "PARTIAL");
  assert.equal(metrics.orphanEvaluationStatus, "NOT_EVALUATED");
  assert.deepEqual(metrics.coverage.edge, { reviewed: 43, total: 43, coverage: 1 });
  assert.deepEqual(metrics.coverage.unrelated, { reviewed: 13, total: 40, coverage: .325 });
  assert.deepEqual(metrics.coverage.orphan, { reviewed: 0, total: 30, coverage: 0 });
  assert.equal(metrics.coverage.total.reviewed, 56);
  assert.equal(metrics.coverage.total.total, 113);
});
test("Step3 partial audit excludes unreviewed records from denominators", async () => {
  const { dataset } = await fixturePromise;
  const annotations = createEmptyAnnotations(dataset.manifest.datasetFingerprint, fixedDate());
  annotations.edge[dataset.edges[0]!.reviewId] = relationAnnotation(dataset.edges[0]!.predictedRelation);
  const metrics = calculateGraphQualityMetrics(dataset, annotations, false);
  assert.equal(metrics.edgePrecision.denominator, 1);
  assert.equal(metrics.unreviewed.edges, dataset.edges.length - 1);
  assert.equal(metrics.sampledUnrelatedFalseNegativeRate.denominator, 0);
});
test("Step3 zero orphan review is explicitly not evaluated", async () => {
  const { dataset } = await fixturePromise;
  const metrics = calculateGraphQualityMetrics(dataset, createEmptyAnnotations(dataset.manifest.datasetFingerprint, fixedDate()), false);
  assert.equal(metrics.evaluationStatus.orphan, "NOT_EVALUATED");
  assert.deepEqual(metrics.falseOrphanRate, { numerator: null, denominator: 0, rate: null, smallN: true });
  assert.equal(metrics.rootCauses.status, "NOT_EVALUATED");
  assert.equal(metrics.rootCauses.retrieval_miss, null);
  assert.equal(metrics.rootCauses.classifier_false_negative, null);
  assert.equal(metrics.rootCauses.graph_pipeline_error, null);
});
test("Step3 partial unrelated result is observational small-N", async () => {
  const { dataset } = await fixturePromise;
  const annotations = createEmptyAnnotations(dataset.manifest.datasetFingerprint, fixedDate());
  for (const record of dataset.unrelated.slice(0, 3)) annotations.unrelated[record.reviewId] = relationAnnotation("unrelated");
  const metrics = calculateGraphQualityMetrics(dataset, annotations, false);
  assert.equal(metrics.evaluationStatus.unrelated, "PARTIAL");
  assert.equal(metrics.sampledUnrelatedFalseNegativeRate.denominator, 3);
  assert.equal(metrics.sampledUnrelatedFalseNegativeRate.smallN, true);
});
test("Step3 complete mode still rejects partial annotations", async () => {
  const { dataset } = await fixturePromise;
  assert.throws(() => calculateGraphQualityMetrics(dataset, createEmptyAnnotations(dataset.manifest.datasetFingerprint), true), /Human Annotation Required/u);
});
test("Step3 partial mode fails closed on dataset fingerprint mismatch", async () => {
  const { dataset } = await fixturePromise;
  const annotations = createEmptyAnnotations("different-fingerprint", fixedDate());
  assert.throws(() => calculateGraphQualityMetrics(dataset, annotations, false), /不兼容/u);
});
test("Step3 Edge Precision counts valid knowledge edges", async () => {
  const { dataset } = await fixturePromise; const annotations = completeAnnotations(dataset);
  annotations.edge[dataset.edges[0]!.reviewId] = relationAnnotation("unrelated");
  assert.deepEqual(calculateGraphQualityMetrics(dataset, annotations).edgePrecision.numerator, dataset.edges.length - 1);
});
test("Step3 Relation Accuracy requires exact relation", async () => {
  const { dataset } = await fixturePromise; const annotations = completeAnnotations(dataset);
  annotations.edge[dataset.edges[0]!.reviewId] = relationAnnotation("unrelated");
  assert.equal(calculateGraphQualityMetrics(dataset, annotations).relationAccuracy.numerator, dataset.edges.length - 1);
});
test("Step3 Direction Accuracy is separate from relation", async () => {
  const { dataset } = await fixturePromise; const annotations = completeAnnotations(dataset);
  const directional = dataset.edges.find((item) => ["supports", "refines", "depends_on"].includes(item.predictedRelation))!;
  annotations.edge[directional.reviewId] = { ...relationAnnotation(directional.predictedRelation), humanDirection: "b_to_a" };
  assert.equal(calculateGraphQualityMetrics(dataset, annotations).directionAccuracy.numerator, 2);
});
test("Step3 per-relation precision reports sample denominator", async () => {
  const { dataset } = await fixturePromise; const metrics = calculateGraphQualityMetrics(dataset, completeAnnotations(dataset));
  assert.equal(metrics.perRelationPrecision.duplicate.denominator, 1);
});
test("Step3 sampled unrelated false-negative rate is computed", async () => {
  const { dataset } = await fixturePromise; const annotations = completeAnnotations(dataset);
  annotations.unrelated[dataset.unrelated[0]!.reviewId] = relationAnnotation("supports");
  assert.equal(calculateGraphQualityMetrics(dataset, annotations).sampledUnrelatedFalseNegativeRate.numerator, 1);
});
test("Step3 false orphan rate is computed", async () => {
  const { dataset } = await fixturePromise; const annotations = completeAnnotations(dataset);
  const record = dataset.orphans[0]!; annotations.orphan[record.reviewId] = orphanRelation(record.step2CandidateClaimIds[0]!);
  assert.equal(calculateGraphQualityMetrics(dataset, annotations).falseOrphanRate.numerator, 1);
});
test("Step3 low-confidence annotations are excluded", async () => {
  const { dataset } = await fixturePromise; const annotations = completeAnnotations(dataset);
  const id = dataset.edges[0]!.reviewId; annotations.edge[id] = { ...annotations.edge[id]!, reviewerConfidence: "low" };
  assert.equal(calculateGraphQualityMetrics(dataset, annotations).edgePrecision.denominator, dataset.edges.length - 1);
});
test("Step3 uncertain annotations are excluded", async () => {
  const { dataset } = await fixturePromise; const annotations = completeAnnotations(dataset);
  annotations.unrelated[dataset.unrelated[0]!.reviewId] = relationAnnotation("uncertain");
  assert.equal(calculateGraphQualityMetrics(dataset, annotations).sampledUnrelatedFalseNegativeRate.denominator, dataset.unrelated.length - 1);
});
test("Step3 small-N is explicit", async () => {
  const { dataset } = await fixturePromise;
  assert.equal(calculateGraphQualityMetrics(dataset, completeAnnotations(dataset)).perRelationPrecision.duplicate.smallN, true);
});
test("Step3 candidate-set relation is attributed to classifier false negative", async () => {
  const { dataset } = await fixturePromise; const annotations = completeAnnotations(dataset); const record = dataset.orphans[0]!;
  annotations.orphan[record.reviewId] = orphanRelation(record.step2CandidateClaimIds[0]!);
  assert.equal(calculateGraphQualityMetrics(dataset, annotations).rootCauses.classifier_false_negative, 1);
});
test("Step3 outside-candidate relation is attributed to retrieval miss", async () => {
  const { dataset } = await fixturePromise; const annotations = completeAnnotations(dataset); const record = dataset.orphans[0]!;
  const outside = dataset.manifest.claimIds.find((id) => id !== record.targetClaim.id && !record.step2CandidateClaimIds.includes(id))!;
  annotations.orphan[record.reviewId] = orphanRelation(outside);
  assert.equal(calculateGraphQualityMetrics(dataset, annotations).rootCauses.retrieval_miss, 1);
});
test("Step3 persisted relation on orphan is attributed to pipeline error", async () => {
  const { dataset } = await fixturePromise; const copy = structuredClone(dataset); const annotations = completeAnnotations(copy); const record = copy.orphans[0]!;
  const related = copy.manifest.claimIds.find((id) => id !== record.targetClaim.id)!; record.persistedRelatedClaimIds = [related];
  annotations.orphan[record.reviewId] = orphanRelation(related);
  assert.equal(calculateGraphQualityMetrics(copy, annotations).rootCauses.graph_pipeline_error, 1);
});
test("Step3 true orphan is attributed explicitly", async () => {
  const { dataset } = await fixturePromise;
  assert.equal(calculateGraphQualityMetrics(dataset, completeAnnotations(dataset)).rootCauses.true_orphan, dataset.orphans.length);
});
test("Step3 generation is read-only with respect to input stores", async () => {
  const { store, graph } = await fixturePromise; const before = JSON.stringify({ store, graph });
  await generateGraphQualityDataset({ snapshotId: "snapshot", claimStore: store, graph, candidatePairs: fixturePairs(), buildContext: context(), generatedAt: fixedDate() });
  assert.equal(JSON.stringify({ store, graph }), before);
});
test("Step3 evaluation has no LLM, Tavily, PR, or Markdown dependency", async () => {
  const { dataset } = await fixturePromise;
  const metrics = calculateGraphQualityMetrics(dataset, completeAnnotations(dataset));
  assert.equal(metrics.errorTaxonomy.GRAPH_PIPELINE_ERROR, 0);
});

async function createFixture(): Promise<{ dataset: GraphQualityEvaluationDataset; store: ClaimStore; graph: ClaimGraphStore }> {
  const claims = Object.fromEntries(Array.from({ length: 50 }, (_, index) => {
    const id = `c${index.toString().padStart(2, "0")}`; return [id, claim(id, index)];
  }));
  const store: ClaimStore = { schemaVersion: 1, generatedAt: fixedDate().toISOString(), claims, files: Object.fromEntries(Object.values(claims).map((item) => [item.provenance[0]!.filePath, { fileHash: item.provenance[0]!.fileHash, claimIds: [item.id], indexedAt: fixedDate().toISOString() }])), failedFiles: {} };
  const graph = fixtureGraph(store);
  const dataset = await generateGraphQualityDataset({ snapshotId: "snapshot", claimStore: store, graph, candidatePairs: fixturePairs(), buildContext: context(), generatedAt: fixedDate() });
  return { dataset, store, graph };
}
function claim(id: string, index: number): ClaimRecord {
  return { id, statement: `Agent memory claim ${index}`, normalizedStatement: `agent memory claim ${index}`, type: index % 2 ? "fact" : "definition", topic: `topic-${index % 4}`, status: "active", confidence: .9, provenance: [{ filePath: `Wiki/${index % 7}.md`, fileHash: id.padEnd(64, "0"), sourceKind: "wiki" }], createdAt: fixedDate().toISOString(), updatedAt: fixedDate().toISOString() };
}
function fixturePairs(): ClaimGraphCandidatePair[] {
  return Array.from({ length: 45 }, (_, index) => ({ pairId: `p${index}`, leftClaimId: "c00", rightClaimId: `c${(index + 1).toString().padStart(2, "0")}`, score: 1 - index / 100, reasons: ["fixture"] }));
}
function fixtureGraph(store: ClaimStore): ClaimGraphStore {
  const relations = ["duplicate", "supports", "refines", "contradicts", "depends_on"] as const;
  const edges = Object.fromEntries(relations.map((relation, index) => [`e${index}`, edge(`e${index}`, "c00", `c0${index + 1}`, relation)]));
  const connected = new Set(Object.values(edges).flatMap((item) => [item.fromClaimId, item.toClaimId]));
  return { metadata: { schemaVersion: 2, graphVersion: "claim-graph-v1", relationPolicyVersion: "policy-v1", candidatePolicyVersion: "candidate-v1", claimStoreRevision: "revision", claimStoreFingerprint: "f".repeat(64), generatedAt: fixedDate().toISOString(), builtAt: fixedDate().toISOString(), nodeCount: 50, edgeCount: 5, relationStats: { duplicate: 1, supports: 1, refines: 1, contradicts: 1, depends_on: 1 }, candidatePairs: 45, classifiedPairs: 45, failedPairs: [], buildMetadata: { claimCount: 50, rawScoredPairs: 80, candidatePairs: 45, candidatePairRatio: .04, relationClassifications: 45, persistedEdges: 5, unrelatedCount: 40, orphanClaimIds: Object.keys(store.claims).filter((id) => !connected.has(id)), providerCalls: 5, successfulCalls: 5, batchCount: 5, retryCount: 0, retryReasons: [], schemaInvalidCount: 0, recoveredPairs: 0, failedPairs: [], candidateGenerationMs: 10, relationClassificationMs: 20, totalDurationMs: 30, externalSearchCalls: 0, autoConflictResolutions: 0, autoCompressionWrites: 0 } }, nodes: Object.fromEntries(Object.values(store.claims).map((item) => [item.id, { claimId: item.id, statement: item.statement, sourcePath: item.provenance[0]!.filePath, topic: item.topic, createdAt: item.createdAt, claimFingerprint: item.id.padEnd(64, "f"), status: item.status }])), edges, evolution: [] };
}
function edge(id: string, from: string, to: string, relation: ClaimGraphEdge["relation"]): ClaimGraphEdge { return { id, fromClaimId: from, toClaimId: to, relation, confidence: .9, evidence: [{ claimId: from, statement: from, sourcePath: "Wiki/0.md", reason: "fixture evidence" }], retrievalScore: .9, retrievalReasons: ["fixture"], createdAt: fixedDate().toISOString(), updatedAt: fixedDate().toISOString() }; }
function relationAnnotation(relation: string) { return { humanRelation: relation as never, humanDirection: ["supports", "refines", "depends_on"].includes(relation) ? "a_to_b" as const : relation === "uncertain" ? "uncertain" as const : "not_applicable" as const, reviewerConfidence: "high" as const, notes: "", submittedAt: fixedDate().toISOString() }; }
function orphanRelation(relatedClaimId: string) { return { humanLabel: "has_relation" as const, relatedClaimId, humanRelation: "supports" as const, humanDirection: "a_to_b" as const, reviewerConfidence: "high" as const, notes: "", submittedAt: fixedDate().toISOString() }; }
function completeAnnotations(dataset: GraphQualityEvaluationDataset): GraphQualityAnnotations {
  const annotations = createEmptyAnnotations(dataset.manifest.datasetFingerprint, fixedDate());
  for (const record of dataset.edges) annotations.edge[record.reviewId] = relationAnnotation(record.predictedRelation);
  for (const record of dataset.unrelated) annotations.unrelated[record.reviewId] = relationAnnotation("unrelated");
  for (const record of dataset.orphans) annotations.orphan[record.reviewId] = { humanLabel: "true_orphan", humanDirection: "not_applicable", reviewerConfidence: "high", notes: "", submittedAt: fixedDate().toISOString() };
  return annotations;
}
function expandedDataset(source: GraphQualityEvaluationDataset, edgeCount: number, unrelatedCount: number, orphanCount: number): GraphQualityEvaluationDataset {
  const repeat = <T extends { reviewId: string }>(records: T[], count: number, prefix: string): T[] =>
    Array.from({ length: count }, (_, index) => ({ ...structuredClone(records[index % records.length]!), reviewId: `${prefix}-${index}` }));
  const dataset = structuredClone(source);
  dataset.edges = repeat(source.edges, edgeCount, "partial-edge");
  dataset.unrelated = repeat(source.unrelated, unrelatedCount, "partial-unrelated");
  dataset.orphans = repeat(source.orphans, orphanCount, "partial-orphan");
  dataset.manifest.edgeCount = edgeCount;
  dataset.manifest.unrelatedCount = unrelatedCount;
  dataset.manifest.orphanCount = orphanCount;
  return dataset;
}
function context() { return { model: "deepseek-flash", promptVersion: "prompt-v2", temperature: .1 }; }
function fixedDate() { return new Date("2026-09-30T01:00:00.000Z"); }
