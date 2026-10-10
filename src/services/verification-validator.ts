import type {
  ConflictVerificationResult,
  EvidenceSupport,
  ExternalEvidence,
  ExternalSourceType,
  RankedSearchResult,
  SourceTier,
  VerificationProposal
} from "../types/verification";
import { canonicalizeUrl, classifySource } from "./source-ranking-service";

const RESOLUTIONS = new Set(["supersede", "refine", "unresolved"]);
const SOURCE_TYPES = new Set([
  "official",
  "paper",
  "repository",
  "research",
  "engineering",
  "media",
  "community",
  "unknown"
]);
const SUPPORT_VALUES = new Set(["existing", "new", "both", "neither"]);

export class VerificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationValidationError";
  }
}

export function parseVerificationProposal(
  response: string,
  allowedSources: RankedSearchResult[]
): VerificationProposal {
  const parsed = parseJsonObject(response);
  const root = requireRecord(parsed, "VerificationResult");
  const evidence = requireArray(root.evidence, "evidence")
    .map((item, index) => parseEvidence(item, index, allowedSources));
  if (evidence.length === 0 || evidence.length > 5) {
    throw new VerificationValidationError("evidence 数量必须为 1～5。");
  }
  const ids = new Set<string>();
  for (const item of evidence) {
    if (ids.has(item.id)) {
      throw new VerificationValidationError(`evidence id 重复：${item.id}`);
    }
    ids.add(item.id);
  }
  return {
    resolution: requireEnum(root.resolution, RESOLUTIONS, "resolution") as VerificationProposal["resolution"],
    conclusion: requireNonEmptyString(root.conclusion, "conclusion"),
    reasoning: requireNonEmptyString(root.reasoning, "reasoning"),
    evidence,
    confidence: requireConfidence(root.confidence, "confidence")
  };
}

export function buildVerificationResult(
  conflictId: string,
  proposal: VerificationProposal,
  verifiedAt = new Date().toISOString()
): ConflictVerificationResult {
  if (conflictId.trim().length === 0) {
    throw new VerificationValidationError("conflictId 不能为空。");
  }
  if (Number.isNaN(Date.parse(verifiedAt))) {
    throw new VerificationValidationError("verifiedAt 必须是有效时间。");
  }
  return {
    conflictId,
    status: "verified",
    resolution: proposal.resolution,
    conclusion: proposal.conclusion,
    reasoning: proposal.reasoning,
    evidence: proposal.evidence,
    confidence: proposal.confidence,
    verifiedAt
  };
}

function parseEvidence(
  value: unknown,
  index: number,
  allowedSources: RankedSearchResult[]
): ExternalEvidence {
  const item = requireRecord(value, `evidence[${index}]`);
  const urlValue = requireNonEmptyString(item.url, `evidence[${index}].url`);
  const canonicalUrl = canonicalizeUrl(urlValue);
  if (canonicalUrl === null) {
    throw new VerificationValidationError(`evidence[${index}].url 必须是 HTTP(S) URL。`);
  }
  const allowed = allowedSources.find(
    (source) => canonicalizeUrl(source.url) === canonicalUrl
  );
  if (allowed === undefined) {
    throw new VerificationValidationError(`evidence[${index}].url 不在搜索结果中。`);
  }
  const expectedClassification = classifySource(allowed);
  const tier = requireInteger(item.sourceTier, `evidence[${index}].sourceTier`);
  if (tier < 0 || tier > 4 || tier !== expectedClassification.tier) {
    throw new VerificationValidationError(`evidence[${index}].sourceTier 与来源策略不一致。`);
  }
  const sourceType = requireEnum(
    item.sourceType,
    SOURCE_TYPES,
    `evidence[${index}].sourceType`
  ) as ExternalSourceType;
  if (sourceType !== expectedClassification.sourceType) {
    throw new VerificationValidationError(`evidence[${index}].sourceType 与来源策略不一致。`);
  }
  const title = requireNonEmptyString(item.title, `evidence[${index}].title`);
  if (normalizeText(title) !== normalizeText(allowed.title)) {
    throw new VerificationValidationError(`evidence[${index}].title 与搜索结果不一致。`);
  }
  const excerpt = optionalString(item.excerpt, `evidence[${index}].excerpt`);
  if (excerpt !== undefined && excerpt.length > 2_000) {
    throw new VerificationValidationError(`evidence[${index}].excerpt 过长。`);
  }
  return {
    id: requireNonEmptyString(item.id, `evidence[${index}].id`),
    title: allowed.title,
    url: canonicalUrl,
    sourceTier: tier as SourceTier,
    sourceType,
    supports: requireEnum(
      item.supports,
      SUPPORT_VALUES,
      `evidence[${index}].supports`
    ) as EvidenceSupport,
    excerpt,
    reasoning: requireNonEmptyString(item.reasoning, `evidence[${index}].reasoning`),
    confidence: requireConfidence(item.confidence, `evidence[${index}].confidence`)
  };
}

function parseJsonObject(response: string): unknown {
  const trimmed = response.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  throw new VerificationValidationError("模型没有返回合法 JSON。");
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VerificationValidationError(`${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new VerificationValidationError(`${field} 必须是数组。`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VerificationValidationError(`${field} 必须是非空字符串。`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, field);
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new VerificationValidationError(`${field} 必须是整数。`);
  }
  return value;
}

function requireConfidence(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new VerificationValidationError(`${field} 必须在 0～1 之间。`);
  }
  return value;
}

function requireEnum(value: unknown, allowed: Set<string>, field: string): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new VerificationValidationError(`${field} 枚举值无效。`);
  }
  return value;
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
