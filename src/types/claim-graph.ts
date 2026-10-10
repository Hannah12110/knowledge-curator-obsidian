export const CLAIM_GRAPH_SCHEMA_VERSION = 2;
export const CLAIM_GRAPH_VERSION = "claim-graph-v1";
export const CLAIM_GRAPH_RELATION_POLICY_VERSION = "claim-graph-relations-v2";
export const CLAIM_GRAPH_CANDIDATE_POLICY_VERSION = "claim-graph-candidates-v1";

export type ClaimGraphRelation =
  | "duplicate"
  | "supports"
  | "refines"
  | "contradicts"
  | "depends_on";

export type ClaimGraphStatus =
  | "not_built"
  | "building"
  | "ready"
  | "stale"
  | "partial"
  | "corrupt";

export interface ClaimGraphNode {
  claimId: string;
  statement: string;
  sourcePath: string;
  topic?: string;
  createdAt: string;
  claimFingerprint: string;
  status: "active" | "disputed" | "superseded" | "deprecated";
}

export interface ClaimGraphEvidence {
  claimId: string;
  statement: string;
  sourcePath: string;
  reason: string;
}

export interface ClaimGraphEdge {
  id: string;
  fromClaimId: string;
  toClaimId: string;
  relation: ClaimGraphRelation;
  confidence: number;
  evidence: ClaimGraphEvidence[];
  retrievalScore: number;
  retrievalReasons: string[];
  createdAt: string;
  updatedAt: string;
}

export type ClaimEvolutionEventType =
  | "created"
  | "refined"
  | "challenged"
  | "superseded";

export interface ClaimEvolutionEvent {
  id: string;
  claimId: string;
  type: ClaimEvolutionEventType;
  at: string;
  relatedClaimId?: string;
  relationEdgeId?: string;
  reason: string;
}

export interface ClaimGraphMetadata {
  schemaVersion: number;
  graphVersion: string;
  relationPolicyVersion: string;
  candidatePolicyVersion: string;
  claimStoreRevision: string;
  claimStoreFingerprint: string;
  generatedAt: string;
  builtAt: string;
  nodeCount: number;
  edgeCount: number;
  relationStats: Record<ClaimGraphRelation, number>;
  candidatePairs: number;
  classifiedPairs: number;
  failedPairs: string[];
  buildMetadata: ClaimGraphBuildMetadata;
}

export interface ClaimGraphBuildMetadata {
  claimCount: number;
  rawScoredPairs: number;
  candidatePairs: number;
  candidatePairRatio: number;
  relationClassifications: number;
  persistedEdges: number;
  unrelatedCount: number;
  orphanClaimIds: string[];
  providerCalls: number;
  successfulCalls: number;
  batchCount: number;
  retryCount: number;
  retryReasons: string[];
  schemaInvalidCount: number;
  recoveredPairs: number;
  failedPairs: string[];
  candidateGenerationMs: number;
  relationClassificationMs: number;
  totalDurationMs: number;
  externalSearchCalls: 0;
  autoConflictResolutions: 0;
  autoCompressionWrites: 0;
}

export interface ClaimGraphStore {
  metadata: ClaimGraphMetadata;
  nodes: Record<string, ClaimGraphNode>;
  edges: Record<string, ClaimGraphEdge>;
  evolution: ClaimEvolutionEvent[];
}

export interface ClaimGraphCandidatePair {
  pairId: string;
  leftClaimId: string;
  rightClaimId: string;
  score: number;
  reasons: string[];
}

export type ClaimGraphClassifierRelation = ClaimGraphRelation | "none" | "uncertain";
export type ClaimGraphDirection = "left_to_right" | "right_to_left" | "symmetric" | "uncertain";

export interface ClaimGraphSemanticDelta {
  sameCoreProposition: boolean | "uncertain";
  uniqueInformationA: string[];
  uniqueInformationB: string[];
  asymmetry: {
    qualifier: boolean; scope: boolean; epistemicStrength: boolean; number: boolean;
    time: boolean; mechanism: boolean; scenario: boolean; condition: boolean;
    implementationDetail: boolean;
  };
}

export type ClaimGraphRole = "A" | "B" | "uncertain";
export interface ClaimGraphSemanticRoles {
  supportingClaim?: ClaimGraphRole; supportedClaim?: ClaimGraphRole;
  detailClaim?: ClaimGraphRole; baseClaim?: ClaimGraphRole;
  dependentClaim?: ClaimGraphRole; prerequisiteClaim?: ClaimGraphRole;
}

export interface ClaimGraphClassification {
  pairId: string;
  relation: ClaimGraphClassifierRelation;
  direction: ClaimGraphDirection;
  confidence: number;
  reasoning: string;
  evidenceClaimIds: string[];
  relationExistence?: ClaimGraphRelationExistence;
  decisionSignals?: ClaimGraphDecisionSignal[];
  duplicateBlockingSignals?: ClaimGraphDuplicateBlockingSignal[];
  semanticDelta?: ClaimGraphSemanticDelta;
  duplicateEligible?: boolean;
  semanticRoles?: ClaimGraphSemanticRoles;
  relationBridge?: ClaimGraphRelationBridge;
}

export type ClaimGraphRelationBridge =
  | "evidence" | "reason" | "semantic_detail" | "prerequisite"
  | "contradiction" | "none" | "uncertain";

export type ClaimGraphRelationExistence = "related" | "unrelated" | "uncertain";
export type ClaimGraphDecisionSignal =
  | "semantic_equivalence"
  | "evidence_or_reason"
  | "semantic_detail_added"
  | "prerequisite"
  | "incompatible_proposition"
  | "parallel_fact"
  | "same_topic_only"
  | "insufficient_relation";
export type ClaimGraphDuplicateBlockingSignal =
  | "qualifier_asymmetry"
  | "scope_asymmetry"
  | "epistemic_asymmetry"
  | "numeric_asymmetry"
  | "temporal_asymmetry"
  | "mechanism_asymmetry"
  | "scenario_asymmetry";

export interface ClaimGraphStats {
  status: ClaimGraphStatus;
  totalClaims: number;
  totalRelations: number;
  conflicts: number;
  duplicates: number;
  orphanClaims: number;
  failedPairs: number;
  lastUpdated?: string;
  message?: string;
  progress?: { completed: number; total: number };
}

export interface ClaimGraphNeighbor {
  edge: ClaimGraphEdge;
  claim: ClaimGraphNode;
  direction: "incoming" | "outgoing";
}

export interface ClaimGraphSnapshot {
  stats: ClaimGraphStats;
  nodes: ClaimGraphNode[];
  edges: ClaimGraphEdge[];
}

export type CompressionProposalType = "merge" | "keep_canonical";

export interface KnowledgeCompressionProposal {
  id: string;
  type: CompressionProposalType;
  claimIds: string[];
  canonicalClaimId: string;
  evidenceEdgeIds: string[];
  reasoning: string;
  confidence: number;
  status: "preview";
}

export interface KnowledgeHealthSummary {
  claims: number;
  relations: number;
  conflicts: number;
  duplicates: number;
  orphanClaims: number;
  compressionProposals: number;
}
