import type {
  CachedFreshnessVerification,
  ClaimMaintenanceRecord,
  FreshnessResolution,
  FreshnessVerificationResult,
  MaintenanceStore
} from "../types/maintenance";
import type {
  EvidenceSupport,
  ExternalEvidence,
  ExternalSourceType,
  RankedSearchResult,
  SourceTier
} from "../types/verification";
import {
  FRESHNESS_RISK_POLICY_VERSION,
  MAINTENANCE_STORE_SCHEMA_VERSION
} from "../types/maintenance";
import { canonicalizeUrl, classifySource } from "./source-ranking-service";

const RISKS = new Set(["low", "medium", "high", "critical"]);
const FACTORS = new Set([
  "time_sensitive_entity", "versioned_product", "api_behavior", "pricing",
  "quantitative", "benchmark", "current_state", "policy_or_rule",
  "fast_moving_field", "old_source", "previous_conflict",
  "previous_verification", "historical_scope", "stable_definition"
]);
const RESOLUTIONS = new Set([
  "still_valid", "needs_refinement", "stale", "disputed", "insufficient_evidence"
]);
const SOURCE_TYPES = new Set(["official", "paper", "repository", "research", "engineering", "media", "community", "unknown"]);
const SUPPORTS = new Set(["existing", "new", "both", "neither"]);

export class MaintenanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaintenanceValidationError";
  }
}

export function validateMaintenanceStore(value: unknown): MaintenanceStore {
  const root = record(value, "MaintenanceStore");
  if (root.schemaVersion !== MAINTENANCE_STORE_SCHEMA_VERSION) {
    throw new MaintenanceValidationError("Maintenance Store schema 不兼容。");
  }
  const recordsRoot = record(root.records, "records");
  const verificationsRoot = record(root.verifications, "verifications");
  const cacheRoot = record(root.verificationCache, "verificationCache");
  const records: Record<string, ClaimMaintenanceRecord> = {};
  const verifications: Record<string, FreshnessVerificationResult> = {};
  const verificationCache: Record<string, CachedFreshnessVerification> = {};
  for (const [id, item] of Object.entries(recordsRoot)) records[id] = parseRecord(item, id);
  for (const [id, item] of Object.entries(verificationsRoot)) verifications[id] = parseResult(item, id);
  for (const [key, item] of Object.entries(cacheRoot)) verificationCache[key] = parseCache(item, key);
  return {
    schemaVersion: MAINTENANCE_STORE_SCHEMA_VERSION,
    riskPolicyVersion: string(root.riskPolicyVersion, "riskPolicyVersion"),
    generatedAt: iso(root.generatedAt, "generatedAt"),
    records,
    verifications,
    verificationCache
  };
}

function parseRecord(value: unknown, key: string): ClaimMaintenanceRecord {
  const item = record(value, `records.${key}`);
  const factors = array(item.riskFactors, "riskFactors").map((factor) => {
    const f = record(factor, "factor");
    const type = enumString(f.type, FACTORS, "factor.type") as ClaimMaintenanceRecord["riskFactors"][number]["type"];
    return { type, weight: finite(f.weight, "factor.weight"), reason: string(f.reason, "factor.reason") };
  });
  return {
    claimId: string(item.claimId, "claimId"),
    claimFingerprint: hash(item.claimFingerprint, "claimFingerprint"),
    freshnessRisk: enumString(item.freshnessRisk, RISKS, "freshnessRisk") as ClaimMaintenanceRecord["freshnessRisk"],
    riskScore: confidence(item.riskScore, "riskScore"),
    riskFactors: factors,
    explanation: string(item.explanation, "explanation"),
    lastAssessedAt: iso(item.lastAssessedAt, "lastAssessedAt"),
    lastVerifiedAt: optionalIso(item.lastVerifiedAt, "lastVerifiedAt"),
    latestVerificationId: optionalString(item.latestVerificationId),
    latestResolution: item.latestResolution === undefined ? undefined : enumString(item.latestResolution, RESOLUTIONS, "latestResolution") as FreshnessResolution,
    nextSuggestedReviewAt: optionalIso(item.nextSuggestedReviewAt, "nextSuggestedReviewAt")
  };
}

export function parseFreshnessVerificationResult(value: unknown): FreshnessVerificationResult {
  return parseResult(value, "result");
}

function parseResult(value: unknown, key: string): FreshnessVerificationResult {
  const item = record(value, `verifications.${key}`);
  const evidence = array(item.evidence, "evidence").map((entry, index) => parseEvidence(entry, `evidence[${index}]`));
  return {
    id: string(item.id, "id"),
    claimId: string(item.claimId, "claimId"),
    claimFingerprint: hash(item.claimFingerprint, "claimFingerprint"),
    originalStatement: string(item.originalStatement, "originalStatement"),
    resolution: enumString(item.resolution, RESOLUTIONS, "resolution") as FreshnessResolution,
    conclusion: string(item.conclusion, "conclusion"),
    reasoning: string(item.reasoning, "reasoning"),
    evidence,
    confidence: confidence(item.confidence, "confidence"),
    verifiedAt: iso(item.verifiedAt, "verifiedAt")
  };
}

function parseCache(value: unknown, key: string): CachedFreshnessVerification {
  const item = record(value, `verificationCache.${key}`);
  const provider = enumString(item.provider, new Set(["tavily"]), "provider") as CachedFreshnessVerification["provider"];
  const rankedSources = array(item.rankedSources, "rankedSources").map((entry, index) => parseRankedSource(entry, `rankedSources[${index}]`));
  const result = parseResult(item.result, "cache.result");
  const allowedUrls = new Set(rankedSources.map((source) => canonicalizeUrl(source.url)));
  if (result.evidence.some((evidence) => !allowedUrls.has(canonicalizeUrl(evidence.url)))) {
    throw new MaintenanceValidationError("缓存 Evidence URL 不在 Search Result allowlist。 ");
  }
  return {
    cacheKey: string(item.cacheKey, "cacheKey"),
    claimId: string(item.claimId, "claimId"),
    claimFingerprint: hash(item.claimFingerprint, "claimFingerprint"),
    queries: array(item.queries, "queries").map((query) => string(query, "query")),
    provider,
    model: string(item.model, "model"),
    rankedSources,
    result
  };
}

function parseEvidence(value: unknown, field: string): ExternalEvidence {
  const item = record(value, field);
  const sourceTier = integer(item.sourceTier, `${field}.sourceTier`, 0, 4) as SourceTier;
  return {
    id: string(item.id, `${field}.id`),
    title: string(item.title, `${field}.title`),
    url: httpUrl(item.url, `${field}.url`),
    sourceTier,
    sourceType: enumString(item.sourceType, SOURCE_TYPES, `${field}.sourceType`) as ExternalSourceType,
    supports: enumString(item.supports, SUPPORTS, `${field}.supports`) as EvidenceSupport,
    excerpt: optionalString(item.excerpt),
    reasoning: string(item.reasoning, `${field}.reasoning`),
    confidence: confidence(item.confidence, `${field}.confidence`)
  };
}

function parseRankedSource(value: unknown, field: string): RankedSearchResult {
  const item = record(value, field);
  const score = record(item.score, `${field}.score`);
  const result: RankedSearchResult = {
    title: string(item.title, `${field}.title`),
    url: httpUrl(item.url, `${field}.url`),
    snippet: optionalString(item.snippet),
    publishedAt: optionalIso(item.publishedAt, `${field}.publishedAt`),
    domain: optionalString(item.domain),
    score: {
      tier: integer(score.tier, `${field}.score.tier`, 0, 4) as SourceTier,
      authority: confidence(score.authority, `${field}.score.authority`),
      relevance: confidence(score.relevance, `${field}.score.relevance`),
      recency: score.recency === undefined ? undefined : confidence(score.recency, `${field}.score.recency`),
      primarySource: boolean(score.primarySource, `${field}.score.primarySource`),
      independence: score.independence === undefined ? undefined : confidence(score.independence, `${field}.score.independence`),
      reason: string(score.reason, `${field}.score.reason`)
    }
  };
  const expected = classifySource(result);
  if (result.score.tier !== expected.tier) throw new MaintenanceValidationError(`${field}.score.tier 与来源策略不一致。`);
  return result;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new MaintenanceValidationError(`${field} 必须是对象。`);
  return value as Record<string, unknown>;
}
function array(value: unknown, field: string): unknown[] { if (!Array.isArray(value)) throw new MaintenanceValidationError(`${field} 必须是数组。`); return value; }
function string(value: unknown, field: string): string { if (typeof value !== "string" || value.trim() === "") throw new MaintenanceValidationError(`${field} 必须是非空字符串。`); return value.trim(); }
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : string(value, "optional string"); }
function finite(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new MaintenanceValidationError(`${field} 必须是有限数字。`); return value; }
function integer(value: unknown, field: string, min: number, max: number): number { const result = finite(value, field); if (!Number.isInteger(result) || result < min || result > max) throw new MaintenanceValidationError(`${field} 必须是 ${min}～${max} 的整数。`); return result; }
function boolean(value: unknown, field: string): boolean { if (typeof value !== "boolean") throw new MaintenanceValidationError(`${field} 必须是布尔值。`); return value; }
function confidence(value: unknown, field: string): number { const result = finite(value, field); if (result < 0 || result > 1) throw new MaintenanceValidationError(`${field} 必须在 0～1。`); return result; }
function iso(value: unknown, field: string): string { const result = string(value, field); if (Number.isNaN(Date.parse(result))) throw new MaintenanceValidationError(`${field} 必须是 ISO 时间。`); return result; }
function optionalIso(value: unknown, field: string): string | undefined { return value === undefined ? undefined : iso(value, field); }
function hash(value: unknown, field: string): string { const result = string(value, field); if (!/^[0-9a-f]{64}$/u.test(result)) throw new MaintenanceValidationError(`${field} 必须是 SHA-256。`); return result; }
function httpUrl(value: unknown, field: string): string { const result = string(value, field); try { const url = new URL(result); if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol"); return url.toString(); } catch { throw new MaintenanceValidationError(`${field} 必须是 HTTP(S) URL。`); } }
function enumString(value: unknown, values: Set<string>, field: string): string { const result = string(value, field); if (!values.has(result)) throw new MaintenanceValidationError(`${field} 枚举无效。`); return result; }
export function isCurrentMaintenancePolicy(store: MaintenanceStore): boolean {
  return store.riskPolicyVersion === FRESHNESS_RISK_POLICY_VERSION;
}
