import type { Conflict } from "./source-analysis";

export type SearchProviderId = "tavily";
export type SourceTier = 0 | 1 | 2 | 3 | 4;
export type ExternalSourceType =
  | "official"
  | "paper"
  | "repository"
  | "research"
  | "engineering"
  | "media"
  | "community"
  | "unknown";
export type EvidenceSupport = "existing" | "new" | "both" | "neither";
export type ConflictResolution = "supersede" | "refine" | "unresolved";

export interface SearchOptions {
  maxResults?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  domain?: string;
  providerScore?: number;
}

export interface SourceScore {
  tier: SourceTier;
  authority: number;
  relevance: number;
  recency?: number;
  primarySource: boolean;
  independence?: number;
  reason: string;
}

export interface RankedSearchResult extends SearchResult {
  score: SourceScore;
}

export interface ExternalEvidence {
  id: string;
  title: string;
  url: string;
  sourceTier: SourceTier;
  sourceType: ExternalSourceType;
  supports: EvidenceSupport;
  excerpt?: string;
  reasoning: string;
  confidence: number;
}

export interface ConflictVerificationResult {
  conflictId: string;
  status: "verified";
  resolution: ConflictResolution;
  conclusion: string;
  reasoning: string;
  evidence: ExternalEvidence[];
  confidence: number;
  verifiedAt: string;
}

export interface CachedConflictVerification {
  cacheKey: string;
  sourcePath: string;
  conflictId: string;
  existingClaim: string;
  newClaim: string;
  queries: string[];
  provider: SearchProviderId;
  model: string;
  result: ConflictVerificationResult;
}

export type ConflictVerificationCache = Record<string, CachedConflictVerification>;

export interface ConflictVerificationDisplay {
  conflict: Conflict;
  cached: CachedConflictVerification;
}

export interface VerificationProposal {
  resolution: ConflictResolution;
  conclusion: string;
  reasoning: string;
  evidence: ExternalEvidence[];
  confidence: number;
}
