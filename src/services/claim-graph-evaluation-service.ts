import type { CandidateClaim, ClaimRecord, ClaimStore } from "../types/claim";
import type { ClaimGraphCandidatePair, ClaimGraphRelation, ClaimGraphStore } from "../types/claim-graph";
import {
  GRAPH_QUALITY_EVALUATION_VERSION,
  type EdgeReviewRecord,
  type GraphQualityAnnotations,
  type GraphQualityEvaluationDataset,
  type GraphQualityEvaluationManifest,
  type GraphQualityMetrics,
  type HumanDirection,
  type HumanGraphRelation,
  type MetricResult,
  type OrphanAnnotation,
  type OrphanReviewRecord,
  type RelationAnnotation,
  type ReviewClaimRef,
  type UnrelatedReviewRecord
} from "../types/claim-graph-evaluation";
import { ClaimRetrievalService, CLAIM_RETRIEVAL_VERSION } from "./claim-retrieval-service";
import { canonicalClaimPairKey } from "./claim-graph-candidate-service";
import { sha256Text } from "./content-hash";

const GRAPH_RELATIONS: ClaimGraphRelation[] = [
  "duplicate", "supports", "refines", "contradicts", "depends_on"
];
const HUMAN_RELATIONS: HumanGraphRelation[] = [...GRAPH_RELATIONS, "unrelated", "uncertain"];
const HUMAN_DIRECTIONS: HumanDirection[] = ["a_to_b", "b_to_a", "not_applicable", "uncertain"];
const DIRECTIONAL = new Set<HumanGraphRelation>(["supports", "refines", "depends_on"]);

export class GraphQualityEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphQualityEvaluationError";
  }
}

export async function generateGraphQualityDataset(input: {
  snapshotId: string;
  claimStore: ClaimStore;
  graph: ClaimGraphStore;
  candidatePairs: ClaimGraphCandidatePair[];
  buildContext: {
    model: string;
    promptVersion: string;
    temperature: number | null;
  };
  evaluationSnapshot?: {
    id: string;
    graphSnapshotPath: string;
    graphSnapshotFileHash: string;
  };
  additionalKnownLimitations?: string[];
  generatedAt?: Date;
}): Promise<GraphQualityEvaluationDataset> {
  const { snapshotId, claimStore, graph, candidatePairs, buildContext } = input;
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  assertGraphMatchesClaimStore(claimStore, graph);
  const graphFingerprint = await fingerprintGraph(graph);
  const edgePairKeys = new Set(Object.values(graph.edges).map((edge) =>
    canonicalClaimPairKey(edge.fromClaimId, edge.toClaimId)
  ));
  const unrelatedPairs = candidatePairs.filter((pair) =>
    !edgePairKeys.has(canonicalClaimPairKey(pair.leftClaimId, pair.rightClaimId))
  );
  if (unrelatedPairs.length !== graph.metadata.buildMetadata.unrelatedCount) {
    throw new GraphQualityEvaluationError(
      "无法从 Candidate Set 精确重建 unrelated classifications；请重新构建 Claim Graph。"
    );
  }
  const edges = createEdgeReviews(claimStore, graph);
  const unrelated = createUnrelatedReviews(claimStore, unrelatedPairs);
  const orphans = createOrphanReviews(claimStore, graph, candidatePairs);
  const identity = {
    version: GRAPH_QUALITY_EVALUATION_VERSION,
    snapshotId,
    claimStoreFingerprint: graph.metadata.claimStoreFingerprint,
    graphFingerprint,
    builtAt: graph.metadata.builtAt,
    model: buildContext.model,
    promptVersion: buildContext.promptVersion,
    relationPolicyVersion: graph.metadata.relationPolicyVersion,
    temperature: buildContext.temperature,
    evaluationSnapshot: input.evaluationSnapshot,
    claimIds: Object.keys(claimStore.claims).sort(),
    edgeReviewIds: edges.map((item) => item.reviewId),
    unrelatedReviewIds: unrelated.map((item) => item.reviewId),
    orphanReviewIds: orphans.map((item) => item.reviewId)
  };
  const manifest: GraphQualityEvaluationManifest = {
    version: GRAPH_QUALITY_EVALUATION_VERSION,
    generatedAt,
    snapshotId,
    claimStoreFingerprint: graph.metadata.claimStoreFingerprint,
    graphFingerprint,
    builtAt: graph.metadata.builtAt,
    model: buildContext.model,
    promptVersion: buildContext.promptVersion,
    relationPolicyVersion: graph.metadata.relationPolicyVersion,
    temperature: buildContext.temperature,
    datasetFingerprint: await sha256Text(stableStringify(identity)),
    ...(input.evaluationSnapshot === undefined ? {} : {
      evaluationSnapshotId: input.evaluationSnapshot.id,
      graphSnapshotPath: input.evaluationSnapshot.graphSnapshotPath,
      graphSnapshotFileHash: input.evaluationSnapshot.graphSnapshotFileHash
    }),
    claimCount: Object.keys(claimStore.claims).length,
    claimIds: Object.keys(claimStore.claims).sort(),
    edgeCount: Object.keys(graph.edges).length,
    unrelatedCount: unrelatedPairs.length,
    orphanCount: graph.metadata.buildMetadata.orphanClaimIds.length,
    edgeReviewCount: edges.length,
    unrelatedReviewCount: unrelated.length,
    orphanReviewCount: orphans.length,
    unrelatedSamplingMethod: "retrieval-score terciles: high 20, medium 10, low 10; deterministic even sampling",
    orphanSamplingMethod: "deterministic round-robin stratification by sourcePath, topic, and claimType",
    knownLimitations: [
      "同一 Claim Store 经 LLM 重新分类后，Claim Graph 可能出现运行间波动；本基线由 graphFingerprint、冻结 Graph Snapshot 与构建参数锁定（此前观测到 45 → 42 → 43 Relations）。",
      ...(input.additionalKnownLimitations ?? [])
    ],
    status: "ready"
  };
  return { manifest, edges, unrelated, orphans };
}

export function assertEvaluationClaimStoreCurrent(
  manifest: GraphQualityEvaluationManifest,
  claimStoreFingerprint: string
): void {
  if (manifest.claimStoreFingerprint !== claimStoreFingerprint) {
    throw new GraphQualityEvaluationError("Claim Store 已变化，请重新生成评测数据集。");
  }
}

export function assertEvaluationSnapshotCurrent(
  manifest: GraphQualityEvaluationManifest,
  claimStoreFingerprint: string,
  frozenGraphFingerprint: string,
  liveGraphFingerprint?: string
): { liveGraphDiffers: boolean } {
  assertEvaluationClaimStoreCurrent(manifest, claimStoreFingerprint);
  if (manifest.graphFingerprint !== frozenGraphFingerprint) {
    throw new GraphQualityEvaluationError("冻结 Graph Snapshot 与 Evaluation Manifest 不一致。");
  }
  return {
    liveGraphDiffers: liveGraphFingerprint !== undefined && liveGraphFingerprint !== frozenGraphFingerprint
  };
}

export async function fingerprintGraph(graph: ClaimGraphStore): Promise<string> {
  return sha256Text(stableStringify({
    metadata: graph.metadata,
    nodes: graph.nodes,
    edges: graph.edges,
    evolution: graph.evolution
  }));
}

export function assertEvaluationCurrent(
  manifest: GraphQualityEvaluationManifest,
  claimStoreFingerprint: string,
  graphFingerprint: string
): void {
  if (manifest.claimStoreFingerprint !== claimStoreFingerprint || manifest.graphFingerprint !== graphFingerprint) {
    throw new GraphQualityEvaluationError("知识图谱已变化，请重新生成评测数据集。");
  }
}

export function createEmptyAnnotations(
  datasetFingerprint: string,
  now = new Date()
): GraphQualityAnnotations {
  return {
    version: GRAPH_QUALITY_EVALUATION_VERSION,
    datasetFingerprint,
    updatedAt: now.toISOString(),
    edge: {}, unrelated: {}, orphan: {}
  };
}

export function validateRelationAnnotation(
  value: RelationAnnotation,
  expectedReviewId: string
): RelationAnnotation {
  if (!HUMAN_RELATIONS.includes(value.humanRelation)) {
    throw new GraphQualityEvaluationError(`${expectedReviewId}: invalid human relation.`);
  }
  if (!HUMAN_DIRECTIONS.includes(value.humanDirection)) {
    throw new GraphQualityEvaluationError(`${expectedReviewId}: invalid human direction.`);
  }
  validateDirection(value.humanRelation, value.humanDirection, expectedReviewId);
  if (!(["high", "medium", "low"] as const).includes(value.reviewerConfidence)) {
    throw new GraphQualityEvaluationError(`${expectedReviewId}: invalid reviewer confidence.`);
  }
  if (typeof value.notes !== "string" || !validIso(value.submittedAt)) {
    throw new GraphQualityEvaluationError(`${expectedReviewId}: invalid annotation metadata.`);
  }
  return { ...value };
}

export function validateOrphanAnnotation(
  value: OrphanAnnotation,
  record: OrphanReviewRecord,
  allowedClaimIds?: Set<string>
): OrphanAnnotation {
  if (!(["true_orphan", "has_relation", "uncertain"] as const).includes(value.humanLabel)) {
    throw new GraphQualityEvaluationError(`${record.reviewId}: invalid orphan label.`);
  }
  if (!HUMAN_DIRECTIONS.includes(value.humanDirection) ||
    !(["high", "medium", "low"] as const).includes(value.reviewerConfidence) ||
    typeof value.notes !== "string" || !validIso(value.submittedAt)) {
    throw new GraphQualityEvaluationError(`${record.reviewId}: invalid orphan annotation.`);
  }
  if (value.humanLabel === "has_relation") {
    if (value.relatedClaimId === undefined || value.relatedClaimId === record.targetClaim.id ||
      value.humanRelation === undefined || !GRAPH_RELATIONS.includes(value.humanRelation as ClaimGraphRelation)) {
      throw new GraphQualityEvaluationError(`${record.reviewId}: has_relation requires another Claim and a graph relation.`);
    }
    if (allowedClaimIds !== undefined && !allowedClaimIds.has(value.relatedClaimId)) {
      throw new GraphQualityEvaluationError(`${record.reviewId}: related Claim is not in the frozen Claim Store.`);
    }
    validateDirection(value.humanRelation, value.humanDirection, record.reviewId);
  } else if (value.relatedClaimId !== undefined || value.humanRelation !== undefined) {
    throw new GraphQualityEvaluationError(`${record.reviewId}: non-related orphan label cannot include a relation.`);
  } else if (value.humanDirection !== (value.humanLabel === "uncertain" ? "uncertain" : "not_applicable")) {
    throw new GraphQualityEvaluationError(`${record.reviewId}: orphan direction is inconsistent.`);
  }
  return { ...value };
}

export function validateAnnotations(
  dataset: GraphQualityEvaluationDataset,
  annotations: GraphQualityAnnotations,
  requireComplete = false
): GraphQualityAnnotations {
  if (annotations.version !== GRAPH_QUALITY_EVALUATION_VERSION ||
    annotations.datasetFingerprint !== dataset.manifest.datasetFingerprint || !validIso(annotations.updatedAt)) {
    throw new GraphQualityEvaluationError("Annotations 与当前 Evaluation Dataset 不兼容。");
  }
  const edgeIds = new Set(dataset.edges.map((item) => item.reviewId));
  const unrelatedIds = new Set(dataset.unrelated.map((item) => item.reviewId));
  const orphanById = new Map(dataset.orphans.map((item) => [item.reviewId, item]));
  const allowedClaimIds = new Set(dataset.manifest.claimIds);
  for (const [id, value] of Object.entries(annotations.edge)) {
    if (!edgeIds.has(id)) throw new GraphQualityEvaluationError(`Unknown edge review annotation: ${id}`);
    validateRelationAnnotation(value, id);
  }
  for (const [id, value] of Object.entries(annotations.unrelated)) {
    if (!unrelatedIds.has(id)) throw new GraphQualityEvaluationError(`Unknown unrelated review annotation: ${id}`);
    validateRelationAnnotation(value, id);
  }
  for (const [id, value] of Object.entries(annotations.orphan)) {
    const record = orphanById.get(id);
    if (record === undefined) throw new GraphQualityEvaluationError(`Unknown orphan review annotation: ${id}`);
    validateOrphanAnnotation(value, record, allowedClaimIds);
  }
  if (requireComplete) {
    const missing = dataset.edges.length - Object.keys(annotations.edge).length +
      dataset.unrelated.length - Object.keys(annotations.unrelated).length +
      dataset.orphans.length - Object.keys(annotations.orphan).length;
    if (missing > 0) throw new GraphQualityEvaluationError(`Human Annotation Required: ${missing} reviews remaining.`);
  }
  return annotations;
}

export function calculateGraphQualityMetrics(
  dataset: GraphQualityEvaluationDataset,
  annotations: GraphQualityAnnotations,
  requireComplete = true
): GraphQualityMetrics {
  validateAnnotations(dataset, annotations, requireComplete);
  const reviewed = {
    edges: Object.keys(annotations.edge).length,
    unrelated: Object.keys(annotations.unrelated).length,
    orphans: Object.keys(annotations.orphan).length
  };
  const totals = {
    edges: dataset.edges.length,
    unrelated: dataset.unrelated.length,
    orphans: dataset.orphans.length
  };
  const statuses = {
    edge: auditStatus(reviewed.edges, totals.edges),
    unrelated: auditStatus(reviewed.unrelated, totals.unrelated),
    orphan: auditStatus(reviewed.orphans, totals.orphans)
  };
  const validEdges = dataset.edges.flatMap((record) => {
    const annotation = annotations.edge[record.reviewId];
    if (annotation === undefined) return [];
    return annotation.humanRelation === "uncertain" || annotation.reviewerConfidence === "low"
      ? [] : [{ record, annotation }];
  });
  const validUnrelated = dataset.unrelated.flatMap((record) => {
    const annotation = annotations.unrelated[record.reviewId];
    if (annotation === undefined) return [];
    return annotation.humanRelation === "uncertain" || annotation.reviewerConfidence === "low"
      ? [] : [{ record, annotation }];
  });
  const validOrphans = dataset.orphans.flatMap((record) => {
    const annotation = annotations.orphan[record.reviewId];
    if (annotation === undefined) return [];
    return annotation.humanLabel === "uncertain" || annotation.reviewerConfidence === "low"
      ? [] : [{ record, annotation }];
  });
  const relationExact = validEdges.filter(({ record, annotation }) =>
    record.predictedRelation === annotation.humanRelation
  );
  const directionCases = relationExact.filter(({ record }) => DIRECTIONAL.has(record.predictedRelation));
  const perRelationPrecision = Object.fromEntries(GRAPH_RELATIONS.map((relation) => {
    const cases = validEdges.filter(({ record }) => record.predictedRelation === relation);
    return [relation, metric(cases.filter(({ annotation }) => annotation.humanRelation === relation).length, cases.length)];
  })) as Record<ClaimGraphRelation, MetricResult>;
  const orphanEvaluated = statuses.orphan !== "NOT_EVALUATED";
  const rootCauses = {
    status: statuses.orphan,
    retrieval_miss: orphanEvaluated ? 0 : null,
    classifier_false_negative: orphanEvaluated ? 0 : null,
    graph_pipeline_error: orphanEvaluated ? 0 : null,
    true_orphan: orphanEvaluated ? 0 : null,
    uncertain: reviewed.orphans - validOrphans.length
  };
  for (const { record, annotation } of validOrphans) {
    if (annotation.humanLabel === "true_orphan") {
      rootCauses.true_orphan! += 1;
      continue;
    }
    const related = annotation.relatedClaimId!;
    if (record.persistedRelatedClaimIds.includes(related)) rootCauses.graph_pipeline_error! += 1;
    else if (record.step2CandidateClaimIds.includes(related)) rootCauses.classifier_false_negative! += 1;
    else rootCauses.retrieval_miss! += 1;
  }
  const errorTaxonomy = {
    FALSE_POSITIVE_EDGE: validEdges.filter(({ annotation }) => annotation.humanRelation === "unrelated").length,
    WRONG_RELATION: validEdges.filter(({ record, annotation }) =>
      annotation.humanRelation !== "unrelated" && annotation.humanRelation !== record.predictedRelation
    ).length,
    WRONG_DIRECTION: directionCases.filter(({ record, annotation }) =>
      annotation.humanDirection !== record.predictedDirection
    ).length,
    CLASSIFIER_FALSE_NEGATIVE: validUnrelated.filter(({ annotation }) =>
      GRAPH_RELATIONS.includes(annotation.humanRelation as ClaimGraphRelation)
    ).length + (rootCauses.classifier_false_negative ?? 0),
    RETRIEVAL_MISS: rootCauses.retrieval_miss,
    GRAPH_PIPELINE_ERROR: rootCauses.graph_pipeline_error,
    AMBIGUOUS_CLAIM: Object.values(annotations.edge).filter((a) => a.humanRelation === "uncertain").length +
      Object.values(annotations.unrelated).filter((a) => a.humanRelation === "uncertain").length +
      Object.values(annotations.orphan).filter((a) => a.humanLabel === "uncertain").length,
    INSUFFICIENT_CONTEXT: [...Object.values(annotations.edge), ...Object.values(annotations.unrelated), ...Object.values(annotations.orphan)]
      .filter((a) => a.reviewerConfidence === "low").length
  };
  const totalReviewed = reviewed.edges + reviewed.unrelated + reviewed.orphans;
  const totalRecords = totals.edges + totals.unrelated + totals.orphans;
  return {
    evaluationMode: totalReviewed === totalRecords ? "COMPLETE_HUMAN_AUDIT" : "PARTIAL_HUMAN_AUDIT",
    coverage: {
      edge: coverage(reviewed.edges, totals.edges),
      unrelated: coverage(reviewed.unrelated, totals.unrelated),
      orphan: coverage(reviewed.orphans, totals.orphans),
      total: coverage(totalReviewed, totalRecords)
    },
    evaluationStatus: statuses,
    edgeEvaluationStatus: statuses.edge,
    unrelatedEvaluationStatus: statuses.unrelated,
    orphanEvaluationStatus: statuses.orphan,
    edgePrecision: metric(validEdges.filter(({ annotation }) => annotation.humanRelation !== "unrelated").length, validEdges.length),
    relationAccuracy: metric(relationExact.length, validEdges.length),
    directionAccuracy: metric(directionCases.filter(({ record, annotation }) =>
      annotation.humanDirection === record.predictedDirection
    ).length, directionCases.length),
    perRelationPrecision,
    sampledUnrelatedFalseNegativeRate: metric(validUnrelated.filter(({ annotation }) =>
      GRAPH_RELATIONS.includes(annotation.humanRelation as ClaimGraphRelation)
    ).length, validUnrelated.length),
    falseOrphanRate: statuses.orphan === "NOT_EVALUATED"
      ? notEvaluatedMetric()
      : metric(validOrphans.filter(({ annotation }) => annotation.humanLabel === "has_relation").length, validOrphans.length),
    rootCauses,
    errorTaxonomy,
    reviewed,
    uncertain: {
      edges: reviewed.edges - validEdges.length,
      unrelated: reviewed.unrelated - validUnrelated.length,
      orphans: reviewed.orphans - validOrphans.length
    },
    unreviewed: {
      edges: totals.edges - reviewed.edges,
      unrelated: totals.unrelated - reviewed.unrelated,
      orphans: totals.orphans - reviewed.orphans
    }
  };
}

function createEdgeReviews(claimStore: ClaimStore, graph: ClaimGraphStore): EdgeReviewRecord[] {
  return Object.values(graph.edges).sort((a, b) => a.id.localeCompare(b.id)).map((edge) => ({
    reviewId: `edge-review:${edge.id}`,
    edgeId: edge.id,
    claimA: claimRef(claimStore, edge.fromClaimId),
    claimB: claimRef(claimStore, edge.toClaimId),
    predictedRelation: edge.relation,
    predictedDirection: DIRECTIONAL.has(edge.relation) ? "a_to_b" : "not_applicable",
    modelConfidence: edge.confidence,
    modelEvidence: [...new Set(edge.evidence.map((item) => item.reason))],
    humanRelation: null, humanDirection: null, reviewerConfidence: null, notes: ""
  }));
}

function createUnrelatedReviews(claimStore: ClaimStore, pairs: ClaimGraphCandidatePair[]): UnrelatedReviewRecord[] {
  const ordered = [...pairs].sort((a, b) => b.score - a.score || a.pairId.localeCompare(b.pairId));
  const first = Math.ceil(ordered.length / 3);
  const second = Math.ceil(ordered.length * 2 / 3);
  const samples = [
    ...evenSample(ordered.slice(0, first), 20).map((pair) => ({ pair, stratum: "high" as const })),
    ...evenSample(ordered.slice(first, second), 10).map((pair) => ({ pair, stratum: "medium" as const })),
    ...evenSample(ordered.slice(second), 10).map((pair) => ({ pair, stratum: "low" as const }))
  ];
  return samples.map(({ pair, stratum }) => ({
    reviewId: `unrelated-review:${pair.pairId}`,
    pairId: pair.pairId,
    claimA: claimRef(claimStore, pair.leftClaimId),
    claimB: claimRef(claimStore, pair.rightClaimId),
    retrievalScore: pair.score,
    retrievalRank: ordered.findIndex((item) => item.pairId === pair.pairId) + 1,
    stratum,
    humanRelation: null, humanDirection: null, reviewerConfidence: null, notes: ""
  }));
}

function createOrphanReviews(
  claimStore: ClaimStore,
  graph: ClaimGraphStore,
  pairs: ClaimGraphCandidatePair[]
): OrphanReviewRecord[] {
  const orphans = graph.metadata.buildMetadata.orphanClaimIds.map((id) => claimStore.claims[id]!)
    .filter((claim): claim is ClaimRecord => claim !== undefined);
  const sampled = stratifiedOrphanSample(orphans, 30);
  const pairClaims = new Map<string, Set<string>>();
  for (const pair of pairs) {
    addPairClaim(pairClaims, pair.leftClaimId, pair.rightClaimId);
    addPairClaim(pairClaims, pair.rightClaimId, pair.leftClaimId);
  }
  const persisted = new Map<string, Set<string>>();
  for (const edge of Object.values(graph.edges)) {
    addPairClaim(persisted, edge.fromClaimId, edge.toClaimId);
    addPairClaim(persisted, edge.toClaimId, edge.fromClaimId);
  }
  return sampled.map((claim) => {
    const retrieval = new ClaimRetrievalService(() => Object.values(claimStore.claims)
      .filter((item) => item.id !== claim.id));
    const matches = retrieval.retrieve(asCandidate(claim), 5, CLAIM_RETRIEVAL_VERSION);
    return {
      reviewId: `orphan-review:${claim.id}`,
      targetClaim: claimRef(claimStore, claim.id),
      topCandidates: matches.map((match) => ({
        ...claimRef(claimStore, match.claimId), score: match.score, reasons: match.reasons
      })),
      step2CandidateClaimIds: [...(pairClaims.get(claim.id) ?? [])].sort(),
      persistedRelatedClaimIds: [...(persisted.get(claim.id) ?? [])].sort(),
      humanLabel: null, relatedClaimId: null, humanRelation: null,
      humanDirection: null, reviewerConfidence: null, notes: ""
    };
  });
}

function assertGraphMatchesClaimStore(claimStore: ClaimStore, graph: ClaimGraphStore): void {
  const claimIds = new Set(Object.keys(claimStore.claims));
  const nodeIds = Object.keys(graph.nodes);
  if (nodeIds.length !== claimIds.size || nodeIds.some((id) => !claimIds.has(id))) {
    throw new GraphQualityEvaluationError("Claim Graph Nodes 与当前 Claim Store 不一致。");
  }
  if (graph.metadata.failedPairs.length > 0 || graph.metadata.nodeCount !== nodeIds.length) {
    throw new GraphQualityEvaluationError("Claim Graph 不是可评测的完整 ready 状态。");
  }
}

function claimRef(store: ClaimStore, claimId: string): ReviewClaimRef {
  const claim = store.claims[claimId];
  if (claim === undefined) throw new GraphQualityEvaluationError(`Unknown Claim: ${claimId}`);
  const provenance = claim.provenance.find((item) => item.sourceKind === "wiki") ?? claim.provenance[0];
  if (provenance === undefined) throw new GraphQualityEvaluationError(`Claim has no provenance: ${claimId}`);
  const value: ReviewClaimRef = {
    id: claim.id,
    statement: claim.statement,
    sourcePath: provenance.filePath,
    claimType: claim.type
  };
  if (claim.topic !== undefined) value.topic = claim.topic;
  return value;
}

function stratifiedOrphanSample(claims: ClaimRecord[], count: number): ClaimRecord[] {
  const groups = new Map<string, ClaimRecord[]>();
  for (const claim of [...claims].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = claim.provenance.find((item) => item.sourceKind === "wiki")?.filePath ?? "unknown";
    const group = groups.get(source);
    if (group === undefined) groups.set(source, [claim]);
    else group.push(claim);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([source, group]) => [
    source,
    group.sort((a, b) => `${a.topic ?? ""}\u0000${a.type}\u0000${a.id}`.localeCompare(`${b.topic ?? ""}\u0000${b.type}\u0000${b.id}`))
  ] as const);
  const selected: ClaimRecord[] = [];
  let round = 0;
  while (selected.length < Math.min(count, claims.length)) {
    let added = false;
    for (const [, group] of ordered) {
      const claim = group[round];
      if (claim !== undefined) {
        selected.push(claim);
        added = true;
        if (selected.length >= count) break;
      }
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

function evenSample<T>(values: T[], count: number): T[] {
  if (values.length <= count) return [...values];
  if (count <= 1) return values.slice(0, count);
  const indices = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    indices.add(Math.round(index * (values.length - 1) / (count - 1)));
  }
  return [...indices].map((index) => values[index]!);
}

function asCandidate(claim: ClaimRecord): CandidateClaim {
  return {
    id: `evaluation_${claim.id}`,
    statement: claim.statement,
    normalizedStatement: claim.normalizedStatement,
    type: claim.type,
    topic: claim.topic,
    scope: claim.scope,
    qualifiers: claim.qualifiers,
    confidence: claim.confidence
  };
}

function addPairClaim(map: Map<string, Set<string>>, from: string, to: string): void {
  const values = map.get(from);
  if (values === undefined) map.set(from, new Set([to]));
  else values.add(to);
}

function validateDirection(relation: HumanGraphRelation, direction: HumanDirection, id: string): void {
  if (DIRECTIONAL.has(relation)) {
    if (direction !== "a_to_b" && direction !== "b_to_a" && direction !== "uncertain") {
      throw new GraphQualityEvaluationError(`${id}: directional relation requires A→B, B→A, or uncertain.`);
    }
    return;
  }
  const expected = relation === "uncertain" ? "uncertain" : "not_applicable";
  if (direction !== expected) {
    throw new GraphQualityEvaluationError(`${id}: direction must be ${expected}.`);
  }
}

function metric(numerator: number, denominator: number): MetricResult {
  return {
    numerator, denominator,
    rate: denominator === 0 ? null : numerator / denominator,
    smallN: denominator < 30
  };
}

function notEvaluatedMetric(): MetricResult {
  return { numerator: null, denominator: 0, rate: null, smallN: true };
}

function auditStatus(reviewed: number, total: number): "COMPLETE" | "PARTIAL" | "NOT_EVALUATED" {
  if (reviewed === 0) return "NOT_EVALUATED";
  return reviewed === total ? "COMPLETE" : "PARTIAL";
}

function coverage(reviewed: number, total: number) {
  return { reviewed, total, coverage: total === 0 ? 0 : reviewed / total };
}

function validIso(value: string): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
