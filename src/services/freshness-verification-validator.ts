import type {
  FreshnessResolution,
  FreshnessVerificationResult
} from "../types/maintenance";
import type {
  EvidenceSupport,
  ExternalEvidence,
  ExternalSourceType,
  RankedSearchResult,
  SourceTier
} from "../types/verification";
import { hasHistoricalScope } from "./freshness-risk-service";
import { canonicalizeUrl, classifySource } from "./source-ranking-service";

const RESOLUTIONS = new Set(["still_valid", "needs_refinement", "stale", "disputed", "insufficient_evidence"]);
const SOURCE_TYPES = new Set(["official", "paper", "repository", "research", "engineering", "media", "community", "unknown"]);
const SUPPORTS = new Set(["existing", "new", "both", "neither"]);

export class FreshnessVerificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreshnessVerificationValidationError";
  }
}

export function parseFreshnessVerificationProposal(input: {
  response: string;
  claimId: string;
  claimFingerprint: string;
  statement: string;
  allowedSources: RankedSearchResult[];
  verifiedAt?: string;
}): FreshnessVerificationResult {
  const root = record(parseJson(input.response), "FreshnessVerification");
  const resolution = enumString(root.resolution, RESOLUTIONS, "resolution") as FreshnessResolution;
  const evidence = array(root.evidence, "evidence").map((item, index) => parseEvidence(item, index, input.allowedSources));
  if (resolution !== "insufficient_evidence" && evidence.length === 0) {
    throw new FreshnessVerificationValidationError("非 insufficient_evidence 结果必须包含证据。");
  }
  if (evidence.length > 5) throw new FreshnessVerificationValidationError("evidence 最多 5 条。");
  if (resolution === "stale") {
    if (!evidence.some((item) => item.sourceTier <= 1)) {
      throw new FreshnessVerificationValidationError("STALE 至少需要 Tier 0/1 证据。");
    }
    if (hasHistoricalScope(input.statement)) {
      throw new FreshnessVerificationValidationError("明确历史范围 Claim 不能直接判为 STALE。");
    }
  }
  const verifiedAt = input.verifiedAt ?? new Date().toISOString();
  return {
    id: `fresh-${verifiedAt.replace(/[^0-9]/gu, "").slice(0, 17)}-${input.claimId.slice(-8)}`,
    claimId: input.claimId,
    claimFingerprint: input.claimFingerprint,
    originalStatement: input.statement,
    resolution,
    conclusion: nonEmpty(root.conclusion, "conclusion"),
    reasoning: nonEmpty(root.reasoning, "reasoning"),
    evidence,
    confidence: confidence(root.confidence, "confidence"),
    verifiedAt
  };
}

export function buildInsufficientEvidenceResult(input: {
  claimId: string;
  claimFingerprint: string;
  statement: string;
  reason: string;
  verifiedAt?: string;
}): FreshnessVerificationResult {
  const verifiedAt = input.verifiedAt ?? new Date().toISOString();
  return {
    id: `fresh-${verifiedAt.replace(/[^0-9]/gu, "").slice(0, 17)}-${input.claimId.slice(-8)}`,
    claimId: input.claimId,
    claimFingerprint: input.claimFingerprint,
    originalStatement: input.statement,
    resolution: "insufficient_evidence",
    conclusion: "未找到足够可靠的当前外部证据。",
    reasoning: input.reason,
    evidence: [],
    confidence: 0.3,
    verifiedAt
  };
}

function parseEvidence(value: unknown, index: number, allowedSources: RankedSearchResult[]): ExternalEvidence {
  const item = record(value, `evidence[${index}]`);
  const rawUrl = nonEmpty(item.url, `evidence[${index}].url`);
  const url = canonicalizeUrl(rawUrl);
  const allowed = url === null ? undefined : allowedSources.find((source) => canonicalizeUrl(source.url) === url);
  if (url === null || allowed === undefined) throw new FreshnessVerificationValidationError(`evidence[${index}].url 不在本次搜索 allowlist。`);
  const expected = classifySource(allowed);
  const tier = integer(item.sourceTier, `evidence[${index}].sourceTier`);
  const sourceType = enumString(item.sourceType, SOURCE_TYPES, `evidence[${index}].sourceType`) as ExternalSourceType;
  if (tier !== expected.tier || sourceType !== expected.sourceType) throw new FreshnessVerificationValidationError("Evidence Tier/Type 与来源策略不一致。");
  if (normalize(nonEmpty(item.title, "evidence.title")) !== normalize(allowed.title)) throw new FreshnessVerificationValidationError("Evidence title 与搜索结果不一致。");
  return {
    id: nonEmpty(item.id, "evidence.id"),
    title: allowed.title,
    url,
    sourceTier: tier as SourceTier,
    sourceType,
    supports: enumString(item.supports, SUPPORTS, "evidence.supports") as EvidenceSupport,
    excerpt: optionalString(item.excerpt),
    reasoning: nonEmpty(item.reasoning, "evidence.reasoning"),
    confidence: confidence(item.confidence, "evidence.confidence")
  };
}

function parseJson(value: string): unknown {
  const trimmed = value.trim();
  for (const candidate of [trimmed, trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)]) {
    try { return JSON.parse(candidate) as unknown; } catch { /* bounded retry */ }
  }
  throw new FreshnessVerificationValidationError("模型没有返回合法 JSON。");
}
function record(value: unknown, field: string): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new FreshnessVerificationValidationError(`${field} 必须是对象。`); return value as Record<string, unknown>; }
function array(value: unknown, field: string): unknown[] { if (!Array.isArray(value)) throw new FreshnessVerificationValidationError(`${field} 必须是数组。`); return value; }
function nonEmpty(value: unknown, field: string): string { if (typeof value !== "string" || value.trim() === "") throw new FreshnessVerificationValidationError(`${field} 必须非空。`); return value.trim(); }
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : nonEmpty(value, "optional string").slice(0, 2_000); }
function confidence(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new FreshnessVerificationValidationError(`${field} 必须在 0～1。`); return value; }
function integer(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4) throw new FreshnessVerificationValidationError(`${field} 必须是 0～4 整数。`); return value; }
function enumString(value: unknown, allowed: Set<string>, field: string): string { const result = nonEmpty(value, field); if (!allowed.has(result)) throw new FreshnessVerificationValidationError(`${field} 枚举无效。`); return result; }
function normalize(value: string): string { return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase(); }

