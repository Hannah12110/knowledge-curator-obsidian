import type { ClaimAnalysis } from "./claim";

export type SourceQualityGrade = "A" | "B" | "C" | "D";
export type KnowledgeGain = "high" | "medium" | "low" | "none";
export type AnalysisRecommendation =
  | "reject"
  | "extract_only"
  | "merge"
  | "review";
export type RawRecommendation =
  | "keep"
  | "extract_only"
  | "reject"
  | "replace_canonical";

export interface SourceQuality {
  grade: SourceQualityGrade;
  authority: number;
  evidence: number;
  primarySource: number;
  recency: number;
  independence: number;
  reproducibility: number;
  reason: string;
}

export interface RelatedNote {
  path: string;
  title: string;
  relevance: number;
  reason: string;
}

export type ClaimType =
  | "definition"
  | "factual"
  | "causal"
  | "quantitative"
  | "methodological"
  | "experiential"
  | "predictive"
  | "opinion";

export type ClaimNovelty = "new" | "supporting" | "refinement";

export interface Claim {
  statement: string;
  type: ClaimType;
  novelty: ClaimNovelty;
  confidence: number;
  sourceExcerpt?: string;
}

export type ConflictType =
  | "temporal"
  | "definition"
  | "scope"
  | "data"
  | "method"
  | "direct";

export interface Conflict {
  newClaim: string;
  existingClaim: string;
  existingFile: string;
  type: ConflictType;
  confidence: number;
  explanation: string;
  status: "unverified";
}

export interface SourceAnalysis {
  analysisMode?: "legacy" | "claim";
  claimAnalysis?: ClaimAnalysis;
  topic: string;
  sourceQuality: SourceQuality;
  overlap: number;
  knowledgeGain: KnowledgeGain;
  relatedNotes: RelatedNote[];
  duplicateWith: string[];
  newClaims: Claim[];
  conflicts: Conflict[];
  recommendation: AnalysisRecommendation;
  rawRecommendation: RawRecommendation;
  reason: string;
}
