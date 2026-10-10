import type { ClaimComparison } from "./claim";

export const COMPARISON_CACHE_SCHEMA_VERSION = 1;

export interface ComparisonCacheContext {
  candidateHash: string;
  existingClaimHashes: string[];
  retrievalVersion: string;
  comparisonVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
}

export interface ComparisonCacheEntry {
  schemaVersion: number;
  key: string;
  context: ComparisonCacheContext;
  comparison: ClaimComparison;
  createdAt: string;
}

export type ComparisonCache = Record<string, ComparisonCacheEntry>;
