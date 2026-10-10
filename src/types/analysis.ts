import type { SourceAnalysis } from "./source-analysis";
import type { ClaimComparisonVersion, ClaimRetrievalVersion } from "./claim";

export type KnowledgeSourceKind = "wiki" | "raw";

export interface RetrievalCandidate {
  path: string;
  title: string;
  kind: KnowledgeSourceKind;
  relevance: number;
  reason: string;
  content: string;
  truncated: boolean;
}

export interface RetrievalScopeSnapshot {
  inboxFolder: string;
  wikiFolder: string;
  rawFolders: string[];
}

export interface AnalysisContextMetadata {
  sourceTruncated: boolean;
  relatedNotesTruncated: boolean;
  totalContextTruncated: boolean;
  candidatePaths: string[];
  retrievalScope: RetrievalScopeSnapshot;
  claimContext: ClaimAnalysisContextSnapshot;
}

export interface ClaimAnalysisContextSnapshot {
  mode: "legacy" | "claim";
  topK: number;
  claimStoreRevision: string;
  retrievalVersion: ClaimRetrievalVersion | "legacy-document";
  comparisonVersion: ClaimComparisonVersion | "legacy-document";
}

export interface CachedSourceAnalysis {
  schemaVersion: number;
  sourcePath: string;
  sourceModified: number;
  analyzedAt: string;
  analysis: SourceAnalysis;
  context: AnalysisContextMetadata;
}

export type AnalysisCache = Record<string, CachedSourceAnalysis>;

export interface AnalysisResult {
  analysis: SourceAnalysis;
  context: AnalysisContextMetadata;
  candidates: RetrievalCandidate[];
}
