import type { ClaimGraphDirection, ClaimGraphRelation } from "./claim-graph";

export const GRAPH_QUALITY_EVALUATION_VERSION = "phase7.5-step3-v1" as const;

export type HumanGraphRelation = ClaimGraphRelation | "unrelated" | "uncertain";
export type HumanDirection = "a_to_b" | "b_to_a" | "not_applicable" | "uncertain";
export type ReviewerConfidence = "high" | "medium" | "low";
export type OrphanHumanLabel = "true_orphan" | "has_relation" | "uncertain";
export type GraphEvaluationStatus = "ready" | "stale" | "complete" | "superseded";

export interface ReviewClaimRef {
  id: string;
  statement: string;
  sourcePath: string;
  topic?: string;
  claimType?: string;
}

export interface GraphQualityEvaluationManifest {
  version: typeof GRAPH_QUALITY_EVALUATION_VERSION;
  generatedAt: string;
  snapshotId: string;
  claimStoreFingerprint: string;
  graphFingerprint: string;
  builtAt: string;
  model: string;
  promptVersion: string;
  relationPolicyVersion: string;
  temperature: number | null;
  datasetFingerprint: string;
  evaluationSnapshotId?: string;
  graphSnapshotPath?: string;
  graphSnapshotFileHash?: string;
  claimCount: number;
  claimIds: string[];
  edgeCount: number;
  unrelatedCount: number;
  orphanCount: number;
  edgeReviewCount: number;
  unrelatedReviewCount: number;
  orphanReviewCount: number;
  unrelatedSamplingMethod: string;
  orphanSamplingMethod: string;
  knownLimitations: string[];
  status: GraphEvaluationStatus;
  supersededAt?: string;
  supersededReason?: "graph_runtime_variation_before_human_annotation";
  supersededByGraphFingerprint?: string;
}

export interface EdgeReviewRecord {
  reviewId: string;
  edgeId: string;
  claimA: ReviewClaimRef;
  claimB: ReviewClaimRef;
  predictedRelation: ClaimGraphRelation;
  predictedDirection: HumanDirection;
  modelConfidence: number;
  modelEvidence: string[];
  humanRelation: null;
  humanDirection: null;
  reviewerConfidence: null;
  notes: "";
}

export interface UnrelatedReviewRecord {
  reviewId: string;
  pairId: string;
  claimA: ReviewClaimRef;
  claimB: ReviewClaimRef;
  retrievalScore: number;
  retrievalRank: number;
  stratum: "high" | "medium" | "low";
  humanRelation: null;
  humanDirection: null;
  reviewerConfidence: null;
  notes: "";
}

export interface OrphanReviewRecord {
  reviewId: string;
  targetClaim: ReviewClaimRef;
  topCandidates: Array<ReviewClaimRef & { score: number; reasons: string[] }>;
  step2CandidateClaimIds: string[];
  persistedRelatedClaimIds: string[];
  humanLabel: null;
  relatedClaimId: null;
  humanRelation: null;
  humanDirection: null;
  reviewerConfidence: null;
  notes: "";
}

export interface GraphQualityEvaluationDataset {
  manifest: GraphQualityEvaluationManifest;
  edges: EdgeReviewRecord[];
  unrelated: UnrelatedReviewRecord[];
  orphans: OrphanReviewRecord[];
}

export interface RelationAnnotation {
  humanRelation: HumanGraphRelation;
  humanDirection: HumanDirection;
  reviewerConfidence: ReviewerConfidence;
  notes: string;
  submittedAt: string;
}

export interface OrphanAnnotation {
  humanLabel: OrphanHumanLabel;
  relatedClaimId?: string;
  humanRelation?: HumanGraphRelation;
  humanDirection: HumanDirection;
  reviewerConfidence: ReviewerConfidence;
  notes: string;
  submittedAt: string;
}

export interface GraphQualityAnnotations {
  version: typeof GRAPH_QUALITY_EVALUATION_VERSION;
  datasetFingerprint: string;
  updatedAt: string;
  edge: Record<string, RelationAnnotation>;
  unrelated: Record<string, RelationAnnotation>;
  orphan: Record<string, OrphanAnnotation>;
}

export interface MetricResult {
  numerator: number | null;
  denominator: number;
  rate: number | null;
  smallN: boolean;
}

export type HumanAuditStatus = "COMPLETE" | "PARTIAL" | "NOT_EVALUATED";

export interface HumanReviewCoverage {
  reviewed: number;
  total: number;
  coverage: number;
}

export interface OrphanRootCauseMetrics {
  status: HumanAuditStatus;
  retrieval_miss: number | null;
  classifier_false_negative: number | null;
  graph_pipeline_error: number | null;
  true_orphan: number | null;
  uncertain: number;
}

export type GraphEvaluationErrorType =
  | "FALSE_POSITIVE_EDGE"
  | "WRONG_RELATION"
  | "WRONG_DIRECTION"
  | "CLASSIFIER_FALSE_NEGATIVE"
  | "RETRIEVAL_MISS"
  | "GRAPH_PIPELINE_ERROR"
  | "AMBIGUOUS_CLAIM"
  | "INSUFFICIENT_CONTEXT";

export interface GraphQualityMetrics {
  evaluationMode: "COMPLETE_HUMAN_AUDIT" | "PARTIAL_HUMAN_AUDIT";
  coverage: {
    edge: HumanReviewCoverage;
    unrelated: HumanReviewCoverage;
    orphan: HumanReviewCoverage;
    total: HumanReviewCoverage;
  };
  evaluationStatus: {
    edge: HumanAuditStatus;
    unrelated: HumanAuditStatus;
    orphan: HumanAuditStatus;
  };
  edgeEvaluationStatus: HumanAuditStatus;
  unrelatedEvaluationStatus: HumanAuditStatus;
  orphanEvaluationStatus: HumanAuditStatus;
  edgePrecision: MetricResult;
  relationAccuracy: MetricResult;
  directionAccuracy: MetricResult;
  perRelationPrecision: Record<ClaimGraphRelation, MetricResult>;
  sampledUnrelatedFalseNegativeRate: MetricResult;
  falseOrphanRate: MetricResult;
  rootCauses: OrphanRootCauseMetrics;
  errorTaxonomy: Record<GraphEvaluationErrorType, number | null>;
  reviewed: { edges: number; unrelated: number; orphans: number };
  uncertain: { edges: number; unrelated: number; orphans: number };
  unreviewed: { edges: number; unrelated: number; orphans: number };
}

export interface GraphQualityEvaluationReport {
  version: typeof GRAPH_QUALITY_EVALUATION_VERSION;
  generatedAt: string;
  evaluationSnapshot: GraphQualityEvaluationManifest;
  metrics: GraphQualityMetrics;
  safety: {
    llmCalls: 0;
    tavilyCalls: 0;
    knowledgePrAccepts: 0;
    compressionWrites: 0;
    markdownChanged: number;
    claimStoreChanged: boolean;
    graphStoreChanged: boolean;
  };
  limitations: string[];
  recommendation: string;
  pipelineResult: "PASS" | "FAIL";
  graphQuality: "QUALIFIED" | "NEEDS_OPTIMIZATION";
  evaluationStatus: "COMPLETE_HUMAN_AUDIT" | "PARTIAL_HUMAN_AUDIT";
  humanAuditCoverage: "COMPLETE" | "PARTIAL";
  edgeQuality: "PASS" | "NEEDS_OPTIMIZATION" | "NOT_EVALUATED";
  unrelatedRecallQuality: "OBSERVATIONAL" | "NOT_EVALUATED";
  orphanQuality: "OBSERVATIONAL" | "NOT_EVALUATED";
}

export function classifierDirectionToHuman(
  relation: ClaimGraphRelation,
  direction: ClaimGraphDirection
): HumanDirection {
  if (relation === "duplicate" || relation === "contradicts" || direction === "symmetric") {
    return "not_applicable";
  }
  return direction === "left_to_right" ? "a_to_b" : "b_to_a";
}
