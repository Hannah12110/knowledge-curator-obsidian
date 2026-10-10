import type { ClaimRecord } from "./claim";
import type { ExternalEvidence, RankedSearchResult, SearchProviderId } from "./verification";

export const MAINTENANCE_STORE_SCHEMA_VERSION = 1;
export const FRESHNESS_RISK_POLICY_VERSION = "freshness-risk-v1";
export const FRESHNESS_VERIFICATION_VERSION = "freshness-verification-v1";
export const FRESHNESS_RANKING_POLICY_VERSION = "freshness-ranking-v1";

export type FreshnessRisk = "low" | "medium" | "high" | "critical";
export type FreshnessResolution =
  | "still_valid"
  | "needs_refinement"
  | "stale"
  | "disputed"
  | "insufficient_evidence";

export type FreshnessRiskFactorType =
  | "time_sensitive_entity"
  | "versioned_product"
  | "api_behavior"
  | "pricing"
  | "quantitative"
  | "benchmark"
  | "current_state"
  | "policy_or_rule"
  | "fast_moving_field"
  | "old_source"
  | "previous_conflict"
  | "previous_verification"
  | "historical_scope"
  | "stable_definition";

export interface FreshnessRiskFactor {
  type: FreshnessRiskFactorType;
  weight: number;
  reason: string;
}

export interface ClaimMaintenanceRecord {
  claimId: string;
  claimFingerprint: string;
  freshnessRisk: FreshnessRisk;
  riskScore: number;
  riskFactors: FreshnessRiskFactor[];
  explanation: string;
  lastAssessedAt: string;
  lastVerifiedAt?: string;
  latestVerificationId?: string;
  latestResolution?: FreshnessResolution;
  nextSuggestedReviewAt?: string;
}

export interface FreshnessVerificationResult {
  id: string;
  claimId: string;
  claimFingerprint: string;
  originalStatement: string;
  resolution: FreshnessResolution;
  conclusion: string;
  reasoning: string;
  evidence: ExternalEvidence[];
  confidence: number;
  verifiedAt: string;
}

export interface CachedFreshnessVerification {
  cacheKey: string;
  claimId: string;
  claimFingerprint: string;
  queries: string[];
  provider: SearchProviderId;
  model: string;
  rankedSources: RankedSearchResult[];
  result: FreshnessVerificationResult;
}

export interface MaintenanceStore {
  schemaVersion: number;
  riskPolicyVersion: string;
  generatedAt: string;
  records: Record<string, ClaimMaintenanceRecord>;
  verifications: Record<string, FreshnessVerificationResult>;
  verificationCache: Record<string, CachedFreshnessVerification>;
}

export type MaintenanceStoreStatus = "not_scanned" | "ready" | "corrupt";
export type MaintenanceFilter = "all" | "critical" | "high" | "medium" | "verified" | "unverified";
export type MaintenanceState =
  | "unassessed"
  | "assessed"
  | "verification_pending"
  | "verifying"
  | "verified"
  | "pr_draft"
  | "pr_stale"
  | "accepted"
  | "rejected"
  | "failed";

export interface MaintenanceQueueItem {
  claim: ClaimRecord;
  record: ClaimMaintenanceRecord;
  sourcePath: string;
  verification?: FreshnessVerificationResult;
}

export interface MaintenanceQueueStats {
  status: MaintenanceStoreStatus;
  totalClaims: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  neverVerified: number;
  lastScannedAt?: string;
  scanDurationMs?: number;
  message?: string;
}

export interface MaintenanceSnapshot {
  stats: MaintenanceQueueStats;
  items: MaintenanceQueueItem[];
}

