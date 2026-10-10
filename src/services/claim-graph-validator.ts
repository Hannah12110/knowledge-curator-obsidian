import {
  CLAIM_GRAPH_CANDIDATE_POLICY_VERSION,
  CLAIM_GRAPH_VERSION,
  CLAIM_GRAPH_RELATION_POLICY_VERSION,
  CLAIM_GRAPH_SCHEMA_VERSION
} from "../types/claim-graph";
import type {
  ClaimGraphClassification,
  ClaimGraphDecisionSignal,
  ClaimGraphDirection,
  ClaimGraphDuplicateBlockingSignal,
  ClaimGraphSemanticDelta,
  ClaimGraphSemanticRoles,
  ClaimGraphEdge,
  ClaimGraphNode,
  ClaimGraphRelation,
  ClaimGraphStore,
  ClaimEvolutionEvent,
  ClaimEvolutionEventType
} from "../types/claim-graph";

const RELATIONS: ClaimGraphRelation[] = [
  "duplicate", "supports", "refines", "contradicts", "depends_on"
];
const CLASSIFIER_RELATIONS = [...RELATIONS, "none", "uncertain"] as const;
const DIRECTIONS: ClaimGraphDirection[] = ["left_to_right", "right_to_left", "symmetric"];
const ROLES = ["A", "B", "uncertain"] as const;
const EVENT_TYPES: ClaimEvolutionEventType[] = ["created", "refined", "challenged", "superseded"];
const CLAIM_STATUSES = ["active", "disputed", "superseded", "deprecated"] as const;
const RELATION_EXISTENCE = ["related", "unrelated", "uncertain"] as const;
const DECISION_SIGNALS: ClaimGraphDecisionSignal[] = [
  "semantic_equivalence", "evidence_or_reason", "semantic_detail_added", "prerequisite",
  "incompatible_proposition", "parallel_fact", "same_topic_only", "insufficient_relation"
];
const DUPLICATE_BLOCKING_SIGNALS: ClaimGraphDuplicateBlockingSignal[] = [
  "qualifier_asymmetry", "scope_asymmetry", "epistemic_asymmetry", "numeric_asymmetry",
  "temporal_asymmetry", "mechanism_asymmetry", "scenario_asymmetry"
];
const RELATION_BRIDGES = ["evidence", "reason", "semantic_detail", "prerequisite", "contradiction", "none", "uncertain"] as const;

export class ClaimGraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimGraphValidationError";
  }
}

export function validateClaimGraphStore(value: unknown): ClaimGraphStore {
  const root = record(value, "claimGraph");
  const metadata = record(root.metadata, "metadata");
  if (metadata.schemaVersion !== CLAIM_GRAPH_SCHEMA_VERSION) {
    throw new ClaimGraphValidationError("Claim Graph schema 版本不兼容，需要重新构建。");
  }
  const nodesValue = record(root.nodes, "nodes");
  const nodes: Record<string, ClaimGraphNode> = {};
  for (const [claimId, value] of Object.entries(nodesValue)) {
    const item = record(value, `nodes.${claimId}`);
    const id = string(item.claimId, `nodes.${claimId}.claimId`);
    if (id !== claimId) throw new ClaimGraphValidationError("Graph Node ID 与索引 Key 不一致。");
    nodes[claimId] = {
      claimId,
      statement: string(item.statement, `nodes.${claimId}.statement`),
      sourcePath: vaultPath(item.sourcePath, `nodes.${claimId}.sourcePath`),
      createdAt: isoDate(item.createdAt, `nodes.${claimId}.createdAt`),
      claimFingerprint: fingerprint(item.claimFingerprint, `nodes.${claimId}.claimFingerprint`)
      ,status: enumValue(item.status, CLAIM_STATUSES, `nodes.${claimId}.status`)
    };
    const topic = optionalString(item.topic);
    if (topic !== undefined) nodes[claimId].topic = topic;
  }
  const edgesValue = record(root.edges, "edges");
  const edges: Record<string, ClaimGraphEdge> = {};
  for (const [edgeId, value] of Object.entries(edgesValue)) {
    const item = record(value, `edges.${edgeId}`);
    const id = string(item.id, `edges.${edgeId}.id`);
    if (id !== edgeId) throw new ClaimGraphValidationError("Graph Edge ID 与索引 Key 不一致。");
    const fromClaimId = string(item.fromClaimId, `edges.${edgeId}.fromClaimId`);
    const toClaimId = string(item.toClaimId, `edges.${edgeId}.toClaimId`);
    if (fromClaimId === toClaimId || nodes[fromClaimId] === undefined || nodes[toClaimId] === undefined) {
      throw new ClaimGraphValidationError("Graph Edge 必须引用两个存在且不同的 Claim。");
    }
    const evidence = array(item.evidence, `edges.${edgeId}.evidence`).map((entry, index) => {
      const evidenceItem = record(entry, `edges.${edgeId}.evidence[${index}]`);
      const claimId = string(evidenceItem.claimId, `edges.${edgeId}.evidence[${index}].claimId`);
      if (claimId !== fromClaimId && claimId !== toClaimId) {
        throw new ClaimGraphValidationError("Graph Evidence 只能引用当前 Edge 的端点 Claim。");
      }
      const node = nodes[claimId];
      const statement = string(evidenceItem.statement, `edges.${edgeId}.evidence[${index}].statement`);
      const sourcePath = vaultPath(evidenceItem.sourcePath, `edges.${edgeId}.evidence[${index}].sourcePath`);
      if (statement !== node.statement || sourcePath !== node.sourcePath) {
        throw new ClaimGraphValidationError("Graph Evidence 必须与 Claim Node 内容一致。");
      }
      return {
        claimId,
        statement,
        sourcePath,
        reason: string(evidenceItem.reason, `edges.${edgeId}.evidence[${index}].reason`)
      };
    });
    if (evidence.length === 0) throw new ClaimGraphValidationError("Graph Edge 必须包含 Evidence。");
    edges[edgeId] = {
      id,
      fromClaimId,
      toClaimId,
      relation: enumValue(item.relation, RELATIONS, `edges.${edgeId}.relation`),
      confidence: confidence(item.confidence, `edges.${edgeId}.confidence`),
      evidence,
      retrievalScore: confidence(item.retrievalScore, `edges.${edgeId}.retrievalScore`),
      retrievalReasons: stringArray(item.retrievalReasons, `edges.${edgeId}.retrievalReasons`),
      createdAt: isoDate(item.createdAt, `edges.${edgeId}.createdAt`),
      updatedAt: isoDate(item.updatedAt, `edges.${edgeId}.updatedAt`)
    };
  }
  const evolution = array(root.evolution, "evolution")
    .map((value, index) => validateEvolution(value, index, nodes, edges));
  const validatedMetadata: ClaimGraphStore["metadata"] = {
      schemaVersion: CLAIM_GRAPH_SCHEMA_VERSION,
      graphVersion: string(metadata.graphVersion, "metadata.graphVersion"),
      relationPolicyVersion: string(metadata.relationPolicyVersion, "metadata.relationPolicyVersion"),
      candidatePolicyVersion: string(metadata.candidatePolicyVersion, "metadata.candidatePolicyVersion"),
      claimStoreRevision: string(metadata.claimStoreRevision, "metadata.claimStoreRevision"),
      claimStoreFingerprint: fingerprint(metadata.claimStoreFingerprint, "metadata.claimStoreFingerprint"),
      generatedAt: isoDate(metadata.generatedAt, "metadata.generatedAt"),
      builtAt: isoDate(metadata.builtAt, "metadata.builtAt"),
      nodeCount: integer(metadata.nodeCount, "metadata.nodeCount"),
      edgeCount: integer(metadata.edgeCount, "metadata.edgeCount"),
      relationStats: relationStats(metadata.relationStats, "metadata.relationStats"),
      candidatePairs: integer(metadata.candidatePairs, "metadata.candidatePairs"),
      classifiedPairs: integer(metadata.classifiedPairs, "metadata.classifiedPairs"),
      failedPairs: stringArray(metadata.failedPairs, "metadata.failedPairs"),
      buildMetadata: buildMetadata(metadata.buildMetadata, "metadata.buildMetadata")
  };
  const computedRelations = emptyRelationStats();
  for (const edge of Object.values(edges)) computedRelations[edge.relation] += 1;
  const connectedClaims = new Set(Object.values(edges).flatMap((edge) => [edge.fromClaimId, edge.toClaimId]));
  const computedOrphans = Object.keys(nodes).filter((claimId) => !connectedClaims.has(claimId)).sort();
  if (validatedMetadata.graphVersion !== CLAIM_GRAPH_VERSION ||
    validatedMetadata.nodeCount !== Object.keys(nodes).length ||
    validatedMetadata.edgeCount !== Object.keys(edges).length ||
    RELATIONS.some((relation) => validatedMetadata.relationStats[relation] !== computedRelations[relation]) ||
    validatedMetadata.buildMetadata.claimCount !== validatedMetadata.nodeCount ||
    validatedMetadata.buildMetadata.persistedEdges !== validatedMetadata.edgeCount ||
    validatedMetadata.buildMetadata.candidatePairs !== validatedMetadata.candidatePairs ||
    validatedMetadata.buildMetadata.relationClassifications !== validatedMetadata.classifiedPairs ||
    validatedMetadata.buildMetadata.failedPairs.join("|") !== validatedMetadata.failedPairs.join("|") ||
    [...validatedMetadata.buildMetadata.orphanClaimIds].sort().join("|") !== computedOrphans.join("|")) {
    throw new ClaimGraphValidationError("Claim Graph metadata 与实际 Node / Edge / Build 结果不一致。");
  }
  return {
    metadata: validatedMetadata,
    nodes,
    edges,
    evolution
  };
}

export function parseClaimGraphClassifications(
  text: string,
  allowedPairs: Map<string, { leftClaimId: string; rightClaimId: string }>,
  options: { requireDecisionSignals?: boolean; requireDecisionArchitecture?: boolean; requireRelationBridge?: boolean } = {}
): ClaimGraphClassification[] {
  const root = parseJson(text);
  const values = array(root.relations, "relations");
  const seen = new Set<string>();
  const output = values.map((value, index): ClaimGraphClassification => {
    const item = record(value, `relations[${index}]`);
    const pairId = string(item.pairId, `relations[${index}].pairId`);
    const pair = allowedPairs.get(pairId);
    if (pair === undefined || seen.has(pairId)) {
      throw new ClaimGraphValidationError("关系结果包含未知或重复的 Candidate Pair。");
    }
    seen.add(pairId);
    const relation = enumValue(item.relation, CLASSIFIER_RELATIONS, `relations[${index}].relation`);
    const evidenceClaimIds = stringArray(item.evidenceClaimIds, `relations[${index}].evidenceClaimIds`);
    if (relation !== "none") {
      if (evidenceClaimIds.length === 0 || evidenceClaimIds.some((id) =>
        id !== pair.leftClaimId && id !== pair.rightClaimId
      )) {
        throw new ClaimGraphValidationError("非 none 关系必须引用当前 Pair 的 Evidence Claim。");
      }
    } else if (evidenceClaimIds.length > 0) {
      throw new ClaimGraphValidationError("none 关系不能包含 Evidence Claim。");
    }
    let semanticDelta: ClaimGraphSemanticDelta | undefined;
    let semanticRoles: ClaimGraphSemanticRoles | undefined;
    let duplicateEligible: boolean | undefined;
    let direction: ClaimGraphDirection;
    if (options.requireDecisionArchitecture) {
      semanticDelta = parseSemanticDelta(item.semanticDelta, `relations[${index}].semanticDelta`);
      duplicateEligible = isDuplicateEligible(semanticDelta);
      semanticRoles = parseSemanticRoles(item.semanticRoles, `relations[${index}].semanticRoles`);
      if (relation === "duplicate" && !duplicateEligible) {
        throw new ClaimGraphValidationError("Deterministic duplicate gate rejected a relation with semantic delta.");
      }
      direction = directionFromRoles(relation, semanticRoles);
    } else {
      direction = enumValue(item.direction, DIRECTIONS, `relations[${index}].direction`);
    }
    const symmetricRelation = relation === "duplicate" || relation === "contradicts" || relation === "none";
    if (symmetricRelation && direction !== "symmetric") {
      throw new ClaimGraphValidationError(`${relation} 关系必须使用 symmetric direction。`);
    }
    if (!symmetricRelation && direction === "symmetric") {
      throw new ClaimGraphValidationError(`${relation} 关系必须明确 left_to_right 或 right_to_left。`);
    }
    const relationExistence = item.relationExistence === undefined
      ? undefined
      : enumValue(item.relationExistence, RELATION_EXISTENCE, `relations[${index}].relationExistence`);
    const decisionSignals = item.decisionSignals === undefined
      ? undefined
      : enumArray(item.decisionSignals, DECISION_SIGNALS, `relations[${index}].decisionSignals`);
    const duplicateBlockingSignals = item.duplicateBlockingSignals === undefined
      ? undefined
      : enumArray(item.duplicateBlockingSignals, DUPLICATE_BLOCKING_SIGNALS, `relations[${index}].duplicateBlockingSignals`);
    const relationBridge = item.relationBridge === undefined
      ? undefined
      : enumValue(item.relationBridge, RELATION_BRIDGES, `relations[${index}].relationBridge`);
    if (options.requireDecisionSignals) {
      if (relationExistence === undefined || decisionSignals === undefined || decisionSignals.length === 0 || duplicateBlockingSignals === undefined) {
        throw new ClaimGraphValidationError("Prompt v4 结果必须包含 relationExistence、decisionSignals 与 duplicateBlockingSignals。");
      }
      if ((relation === "none") !== (relationExistence !== "related")) {
        throw new ClaimGraphValidationError("relationExistence 必须与最终 relation 一致。");
      }
      if (relation === "duplicate" && duplicateBlockingSignals.length > 0) {
        throw new ClaimGraphValidationError("存在 specificity asymmetry 时不得判为 duplicate。");
      }
    }
    if (options.requireDecisionArchitecture && !options.requireRelationBridge) {
      if (relationExistence === undefined) throw new ClaimGraphValidationError("Prompt v5 结果必须包含 relationExistence。");
      if ((relation === "none") !== (relationExistence !== "related")) {
        throw new ClaimGraphValidationError("Prompt v5 relationExistence 必须与最终 relation 一致。");
      }
    }
    if (options.requireRelationBridge) {
      if (relationExistence === undefined || relationBridge === undefined) {
        throw new ClaimGraphValidationError("Prompt v6 结果必须包含 relationExistence 与 relationBridge。");
      }
      const valid = relationExistence === "unrelated"
        ? relation === "none" && relationBridge === "none"
          : relationExistence === "uncertain"
          ? relation === "uncertain" && relationBridge === "uncertain"
          : relation === "duplicate"
            ? relationBridge === "none"
            : relation !== "none" && relation !== "uncertain" && relationBridge !== "none" && relationBridge !== "uncertain";
      if (!valid) throw new ClaimGraphValidationError("Prompt v6 relationExistence、relationBridge 与 relation 不一致。");
    }
    const result: ClaimGraphClassification = {
      pairId,
      relation,
      direction,
      confidence: confidence(item.confidence, `relations[${index}].confidence`),
      reasoning: string(item.reasoning, `relations[${index}].reasoning`),
      evidenceClaimIds: [...new Set(evidenceClaimIds)]
    };
    if (relationExistence !== undefined) result.relationExistence = relationExistence;
    if (decisionSignals !== undefined) result.decisionSignals = decisionSignals;
    if (duplicateBlockingSignals !== undefined) result.duplicateBlockingSignals = duplicateBlockingSignals;
    if (semanticDelta !== undefined) result.semanticDelta = semanticDelta;
    if (duplicateEligible !== undefined) result.duplicateEligible = duplicateEligible;
    if (semanticRoles !== undefined) result.semanticRoles = semanticRoles;
    if (relationBridge !== undefined) result.relationBridge = relationBridge;
    return result;
  });
  if (seen.size !== allowedPairs.size) {
    throw new ClaimGraphValidationError("每个 Candidate Pair 必须且只能有一个关系结果。");
  }
  return output;
}

export function isDuplicateEligible(delta: ClaimGraphSemanticDelta): boolean {
  return delta.sameCoreProposition === true && delta.uniqueInformationA.length === 0 &&
    delta.uniqueInformationB.length === 0 && Object.values(delta.asymmetry).every((value) => value === false);
}

export function directionFromRoles(
  relation: ClaimGraphClassification["relation"], roles: ClaimGraphSemanticRoles
): ClaimGraphDirection {
  if (relation === "duplicate" || relation === "contradicts" || relation === "none") return "symmetric";
  if (relation === "uncertain") return "uncertain";
  const pair = relation === "supports" ? [roles.supportingClaim, roles.supportedClaim] :
    relation === "refines" ? [roles.detailClaim, roles.baseClaim] :
      [roles.dependentClaim, roles.prerequisiteClaim];
  if (pair[0] === "A" && pair[1] === "B") return "left_to_right";
  if (pair[0] === "B" && pair[1] === "A") return "right_to_left";
  return "uncertain";
}

function parseSemanticDelta(value: unknown, field: string): ClaimGraphSemanticDelta {
  const item = record(value, field);
  const same = item.sameCoreProposition;
  if (same !== true && same !== false && same !== "uncertain") throw new ClaimGraphValidationError(`${field}.sameCoreProposition 非法。`);
  const asymmetry = record(item.asymmetry, `${field}.asymmetry`);
  const names = ["qualifier", "scope", "epistemicStrength", "number", "time", "mechanism", "scenario", "condition", "implementationDetail"] as const;
  const parsed = Object.fromEntries(names.map((name) => {
    if (typeof asymmetry[name] !== "boolean") throw new ClaimGraphValidationError(`${field}.asymmetry.${name} 必须是 boolean。`);
    return [name, asymmetry[name]];
  })) as ClaimGraphSemanticDelta["asymmetry"];
  return { sameCoreProposition: same, uniqueInformationA: stringArray(item.uniqueInformationA, `${field}.uniqueInformationA`), uniqueInformationB: stringArray(item.uniqueInformationB, `${field}.uniqueInformationB`), asymmetry: parsed };
}

function parseSemanticRoles(value: unknown, field: string): ClaimGraphSemanticRoles {
  const item = record(value ?? {}, field);
  const output: ClaimGraphSemanticRoles = {};
  for (const name of ["supportingClaim", "supportedClaim", "detailClaim", "baseClaim", "dependentClaim", "prerequisiteClaim"] as const) {
    if (item[name] !== undefined) output[name] = enumValue(item[name], ROLES, `${field}.${name}`);
  }
  return output;
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[], field: string): T[] {
  return [...new Set(array(value, field).map((item, index) => enumValue(item, allowed, `${field}[${index}]`)))];
}

export function createEmptyClaimGraphStore(claimStoreRevision: string): ClaimGraphStore {
  const now = new Date().toISOString();
  return {
    metadata: {
      schemaVersion: CLAIM_GRAPH_SCHEMA_VERSION,
      graphVersion: CLAIM_GRAPH_VERSION,
      relationPolicyVersion: CLAIM_GRAPH_RELATION_POLICY_VERSION,
      candidatePolicyVersion: CLAIM_GRAPH_CANDIDATE_POLICY_VERSION,
      claimStoreRevision,
      claimStoreFingerprint: "0".repeat(64),
      generatedAt: now,
      builtAt: now,
      nodeCount: 0,
      edgeCount: 0,
      relationStats: emptyRelationStats(),
      candidatePairs: 0,
      classifiedPairs: 0,
      failedPairs: [],
      buildMetadata: {
        claimCount: 0, rawScoredPairs: 0, candidatePairs: 0, candidatePairRatio: 0,
        relationClassifications: 0, persistedEdges: 0, unrelatedCount: 0,
        orphanClaimIds: [], providerCalls: 0, successfulCalls: 0, batchCount: 0,
        retryCount: 0, retryReasons: [], schemaInvalidCount: 0, recoveredPairs: 0,
        failedPairs: [], candidateGenerationMs: 0, relationClassificationMs: 0,
        totalDurationMs: 0, externalSearchCalls: 0, autoConflictResolutions: 0,
        autoCompressionWrites: 0
      }
    },
    nodes: {},
    edges: {},
    evolution: []
  };
}

function emptyRelationStats(): Record<ClaimGraphRelation, number> {
  return Object.fromEntries(RELATIONS.map((relation) => [relation, 0])) as Record<ClaimGraphRelation, number>;
}

function relationStats(value: unknown, field: string): Record<ClaimGraphRelation, number> {
  const item = record(value, field);
  return Object.fromEntries(RELATIONS.map((relation) => [
    relation,
    integer(item[relation], `${field}.${relation}`)
  ])) as Record<ClaimGraphRelation, number>;
}

function buildMetadata(value: unknown, field: string): ClaimGraphStore["metadata"]["buildMetadata"] {
  const item = record(value, field);
  const zero = (name: string) => integer(item[name], `${field}.${name}`);
  const ratio = confidence(item.candidatePairRatio, `${field}.candidatePairRatio`);
  if (item.externalSearchCalls !== 0 || item.autoConflictResolutions !== 0 || item.autoCompressionWrites !== 0) {
    throw new ClaimGraphValidationError("Graph Build 不允许搜索、自动冲突解决或 Compression 写入。");
  }
  return {
    claimCount: zero("claimCount"), rawScoredPairs: zero("rawScoredPairs"),
    candidatePairs: zero("candidatePairs"), candidatePairRatio: ratio,
    relationClassifications: zero("relationClassifications"), persistedEdges: zero("persistedEdges"),
    unrelatedCount: zero("unrelatedCount"), orphanClaimIds: stringArray(item.orphanClaimIds, `${field}.orphanClaimIds`),
    providerCalls: zero("providerCalls"), successfulCalls: zero("successfulCalls"),
    batchCount: zero("batchCount"), retryCount: zero("retryCount"),
    retryReasons: stringArray(item.retryReasons, `${field}.retryReasons`),
    schemaInvalidCount: zero("schemaInvalidCount"), recoveredPairs: zero("recoveredPairs"),
    failedPairs: stringArray(item.failedPairs, `${field}.failedPairs`),
    candidateGenerationMs: zero("candidateGenerationMs"),
    relationClassificationMs: zero("relationClassificationMs"), totalDurationMs: zero("totalDurationMs"),
    externalSearchCalls: 0, autoConflictResolutions: 0, autoCompressionWrites: 0
  };
}

function validateEvolution(
  value: unknown,
  index: number,
  nodes: Record<string, ClaimGraphNode>,
  edges: Record<string, ClaimGraphEdge>
): ClaimEvolutionEvent {
  const item = record(value, `evolution[${index}]`);
  const claimId = string(item.claimId, `evolution[${index}].claimId`);
  if (nodes[claimId] === undefined) throw new ClaimGraphValidationError("Evolution 引用了不存在的 Claim。");
  const result: ClaimEvolutionEvent = {
    id: string(item.id, `evolution[${index}].id`),
    claimId,
    type: enumValue(item.type, EVENT_TYPES, `evolution[${index}].type`),
    at: isoDate(item.at, `evolution[${index}].at`),
    reason: string(item.reason, `evolution[${index}].reason`)
  };
  const relatedClaimId = optionalString(item.relatedClaimId);
  if (relatedClaimId !== undefined) {
    if (nodes[relatedClaimId] === undefined) throw new ClaimGraphValidationError("Evolution relatedClaimId 不存在。");
    result.relatedClaimId = relatedClaimId;
  }
  const relationEdgeId = optionalString(item.relationEdgeId);
  if (relationEdgeId !== undefined) {
    if (edges[relationEdgeId] === undefined) throw new ClaimGraphValidationError("Evolution relationEdgeId 不存在。");
    result.relationEdgeId = relationEdgeId;
  }
  return result;
}

function parseJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  try {
    return record(JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as unknown, "root");
  } catch (error: unknown) {
    if (error instanceof ClaimGraphValidationError) throw error;
    throw new ClaimGraphValidationError("关系模型返回的不是有效 JSON 对象。");
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClaimGraphValidationError(`${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ClaimGraphValidationError(`${field} 必须是数组。`);
  return value;
}
function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ClaimGraphValidationError(`${field} 必须是非空字符串。`);
  }
  return value.trim();
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((item, index) => string(item, `${field}[${index}]`));
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ClaimGraphValidationError(`${field} 枚举值无效。`);
  }
  return value as T;
}
function confidence(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ClaimGraphValidationError(`${field} 必须在 0 到 1 之间。`);
  }
  return value;
}
function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ClaimGraphValidationError(`${field} 必须是非负整数。`);
  }
  return value;
}
function isoDate(value: unknown, field: string): string {
  const result = string(value, field);
  if (Number.isNaN(Date.parse(result))) throw new ClaimGraphValidationError(`${field} 必须是 ISO 日期。`);
  return result;
}
function fingerprint(value: unknown, field: string): string {
  const result = string(value, field);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new ClaimGraphValidationError(`${field} 必须是 SHA-256。`);
  return result;
}
function vaultPath(value: unknown, field: string): string {
  const result = string(value, field).replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (result.length === 0 || result.includes("..") || /^(?:[a-z]+:|[a-z]:)/iu.test(result)) {
    throw new ClaimGraphValidationError(`${field} 必须是安全的 Vault 相对路径。`);
  }
  return result;
}
