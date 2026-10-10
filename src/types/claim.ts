export const CLAIM_STORE_SCHEMA_VERSION = 1;

export type ClaimType =
  | "definition"
  | "fact"
  | "causal"
  | "quantitative"
  | "method"
  | "experiential"
  | "predictive"
  | "opinion";

export type ClaimStatus = "active" | "disputed" | "superseded" | "deprecated";
export type ClaimSourceKind = "wiki" | "source" | "raw" | "external";
export type ClaimRelation = "add" | "reinforce" | "refine" | "challenge" | "supersede";
export type ClaimCoverage = "none" | "partial" | "full" | "conflicting";
export type PairwiseClaimRelation =
  | "equivalent"
  | "existing_broader"
  | "candidate_broader"
  | "overlap"
  | "conflict"
  | "unrelated";
export type ClaimComparisonVersion = "claim-comparison-v1" | "claim-comparison-v2";
export type ClaimComparisonExecutionMode = "cache" | "fast_path" | "llm";
export type ClaimStoreStatus = "not_built" | "building" | "ready" | "partial" | "corrupt";
export type ClaimRetrievalVersion = "claim-retrieval-v1" | "claim-retrieval-v2";

export interface ClaimProvenance {
  filePath: string;
  fileHash: string;
  heading?: string;
  excerpt?: string;
  sourceKind: ClaimSourceKind;
  accepted?: boolean;
}

export interface ClaimRecord {
  id: string;
  statement: string;
  normalizedStatement: string;
  type: ClaimType;
  topic?: string;
  scope?: string[];
  qualifiers?: string[];
  status: ClaimStatus;
  confidence: number;
  provenance: ClaimProvenance[];
  createdAt: string;
  updatedAt: string;
}

export interface CandidateClaim {
  id: string;
  statement: string;
  normalizedStatement: string;
  type: ClaimType;
  topic?: string;
  scope?: string[];
  qualifiers?: string[];
  confidence: number;
  sourceExcerpt?: string;
}

export interface ClaimComparison {
  candidateClaimId: string;
  candidateStatement: string;
  relation: ClaimRelation;
  existingClaimId?: string;
  existingStatement?: string;
  similarity?: number;
  reasoning: string;
  confidence: number;
  coverage?: ClaimCoverageResult;
  debug?: ClaimComparisonDebug;
}

export interface PairwiseClaimAssessment {
  claimId: string;
  relation: PairwiseClaimRelation;
  coveredAspects: string[];
  conflictingAspects: string[];
  reasoning: string;
}

export interface ClaimCoverageResult {
  candidateClaimId: string;
  coverage: ClaimCoverage;
  coreAspects: string[];
  coveredBy: string[];
  coveredAspects: string[];
  uncoveredAspects: string[];
  conflictingAspects: string[];
  pairwise: PairwiseClaimAssessment[];
  reasoning: string;
  confidence: number;
}

export interface MultiClaimCoverage {
  candidateClaimId: string;
  supportingClaimIds: string[];
  coverage: ClaimCoverage;
  coveredAspects: string[];
  uncoveredAspects: string[];
  conflicts: string[];
  reasoning: string;
  confidence: number;
}

export interface ClaimComparisonDebug {
  comparisonVersion: ClaimComparisonVersion;
  executionMode: ClaimComparisonExecutionMode;
  candidate: string;
  topClaims: Array<{
    id: string;
    statement: string;
    pairwiseRelation: PairwiseClaimRelation;
  }>;
  coverage: ClaimCoverageResult;
  finalRelation: ClaimRelation;
  confidence: number;
  guardsTriggered: string[];
}

export interface ClaimRetrievalMatch {
  claimId: string;
  score: number;
  reasons: string[];
  features?: ClaimRetrievalFeatures;
  matchedTerms?: string[];
}

export interface ClaimRetrievalFeatures {
  lexicalScore: number;
  tokenOverlap: number;
  phraseScore: number;
  topicScore: number;
  typeScore: number;
  qualifierScore: number;
  acronymScore: number;
  aliasScore: number;
  provenanceScore: number;
  negationScore: number;
  numericScore: number;
  versionScore: number;
}

export interface ClaimRetrievalDebug {
  candidateClaimId: string;
  candidateStatement: string;
  retrievalVersion: ClaimRetrievalVersion;
  candidatePoolSize: number;
  candidateTokens: string[];
  expandedTerms: string[];
  matchedClaims: Array<{
    claimId: string;
    statement: string;
    finalScore: number;
    features: ClaimRetrievalFeatures;
    matchedTerms: string[];
    reasons: string[];
  }>;
}

export interface ClaimStoreFileEntry {
  fileHash: string;
  claimIds: string[];
  indexedAt: string;
}

export interface ClaimStore {
  schemaVersion: number;
  generatedAt: string;
  claims: Record<string, ClaimRecord>;
  files: Record<string, ClaimStoreFileEntry>;
  failedFiles: Record<string, string>;
}

export interface ClaimStoreStats {
  status: ClaimStoreStatus;
  totalClaims: number;
  indexedWiki: number;
  failedFiles: number;
  lastUpdated?: string;
  progress?: { completed: number; total: number; currentPath?: string };
  message?: string;
}

export interface ClaimAnalysis {
  candidateClaims: CandidateClaim[];
  comparisons: ClaimComparison[];
  coverage: number;
}
