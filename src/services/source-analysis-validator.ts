import type {
  AnalysisRecommendation,
  Claim,
  ClaimNovelty,
  ClaimType,
  Conflict,
  ConflictType,
  KnowledgeGain,
  RawRecommendation,
  RelatedNote,
  SourceAnalysis,
  SourceQuality,
  SourceQualityGrade
} from "../types/source-analysis";
import type {
  CandidateClaim,
  ClaimAnalysis,
  ClaimComparison,
  ClaimComparisonDebug,
  ClaimCoverageResult,
  ClaimRelation,
  ClaimType as AtomicClaimType
} from "../types/claim";
import { normalizeClaim } from "./claim-identity";

const QUALITY_GRADES: SourceQualityGrade[] = ["A", "B", "C", "D"];
const KNOWLEDGE_GAINS: KnowledgeGain[] = ["high", "medium", "low", "none"];
const RECOMMENDATIONS: AnalysisRecommendation[] = [
  "reject",
  "extract_only",
  "merge",
  "review"
];
const RAW_RECOMMENDATIONS: RawRecommendation[] = [
  "keep",
  "extract_only",
  "reject",
  "replace_canonical"
];
const CLAIM_TYPES: ClaimType[] = [
  "definition",
  "factual",
  "causal",
  "quantitative",
  "methodological",
  "experiential",
  "predictive",
  "opinion"
];
const CLAIM_NOVELTIES: ClaimNovelty[] = ["new", "supporting", "refinement"];
const CONFLICT_TYPES: ConflictType[] = [
  "temporal",
  "definition",
  "scope",
  "data",
  "method",
  "direct"
];
const ATOMIC_CLAIM_TYPES: AtomicClaimType[] = [
  "definition", "fact", "causal", "quantitative", "method",
  "experiential", "predictive", "opinion"
];
const CLAIM_RELATIONS: ClaimRelation[] = ["add", "reinforce", "refine", "challenge", "supersede"];
const CLAIM_COVERAGES = ["none", "partial", "full", "conflicting"] as const;
const PAIRWISE_RELATIONS = [
  "equivalent", "existing_broader", "candidate_broader", "overlap", "conflict", "unrelated"
] as const;

export class SourceAnalysisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceAnalysisValidationError";
  }
}

export function parseSourceAnalysisResponse(responseText: string): SourceAnalysis {
  const trimmed = responseText.trim();
  const candidates = [trimmed];
  const extracted = extractFirstJsonObject(trimmed);
  if (extracted !== null && extracted !== trimmed) {
    candidates.push(extracted);
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return validateSourceAnalysis(JSON.parse(candidate) as unknown);
    } catch (error: unknown) {
      lastError = error;
    }
  }

  if (lastError instanceof SourceAnalysisValidationError) {
    throw lastError;
  }
  throw new SourceAnalysisValidationError("模型响应不是有效的 JSON 对象。");
}

export function validateSourceAnalysis(value: unknown): SourceAnalysis {
  const root = requireRecord(value, "root");
  const sourceQualityValue = requireRecord(root.sourceQuality, "sourceQuality");

  const sourceQuality: SourceQuality = {
    grade: requireEnum(sourceQualityValue.grade, QUALITY_GRADES, "sourceQuality.grade"),
    authority: requireIntegerInRange(sourceQualityValue.authority, 1, 5, "sourceQuality.authority"),
    evidence: requireIntegerInRange(sourceQualityValue.evidence, 1, 5, "sourceQuality.evidence"),
    primarySource: requireIntegerInRange(sourceQualityValue.primarySource, 1, 5, "sourceQuality.primarySource"),
    recency: requireIntegerInRange(sourceQualityValue.recency, 1, 5, "sourceQuality.recency"),
    independence: requireIntegerInRange(sourceQualityValue.independence, 1, 5, "sourceQuality.independence"),
    reproducibility: requireIntegerInRange(sourceQualityValue.reproducibility, 1, 5, "sourceQuality.reproducibility"),
    reason: requireNonEmptyString(sourceQualityValue.reason, "sourceQuality.reason")
  };

  const analysisMode = root.analysisMode === "claim" || root.analysisMode === "legacy"
    ? root.analysisMode
    : undefined;
  const claimAnalysis = root.claimAnalysis === undefined
    ? undefined
    : validateClaimAnalysis(root.claimAnalysis);
  if (analysisMode === "claim" && claimAnalysis === undefined) {
    throw new SourceAnalysisValidationError("Claim Mode 分析必须包含 claimAnalysis。");
  }
  return {
    ...(analysisMode === undefined ? {} : { analysisMode }),
    ...(claimAnalysis === undefined ? {} : { claimAnalysis }),
    topic: requireNonEmptyString(root.topic, "topic"),
    sourceQuality,
    overlap: requireNumberInRange(root.overlap, 0, 1, "overlap"),
    knowledgeGain: requireEnum(root.knowledgeGain, KNOWLEDGE_GAINS, "knowledgeGain"),
    relatedNotes: requireArray(root.relatedNotes, "relatedNotes").map(validateRelatedNote),
    duplicateWith: requireArray(root.duplicateWith, "duplicateWith").map(
      (item, index) => requireNonEmptyString(item, `duplicateWith[${index}]`)
    ),
    newClaims: requireArray(root.newClaims, "newClaims").map(validateClaim),
    conflicts: requireArray(root.conflicts, "conflicts").map(validateConflict),
    recommendation: requireEnum(root.recommendation, RECOMMENDATIONS, "recommendation"),
    rawRecommendation: requireEnum(root.rawRecommendation, RAW_RECOMMENDATIONS, "rawRecommendation"),
    reason: requireNonEmptyString(root.reason, "reason")
  };
}

function validateClaimAnalysis(value: unknown): ClaimAnalysis {
  const root = requireRecord(value, "claimAnalysis");
  const candidateClaims = requireArray(root.candidateClaims, "claimAnalysis.candidateClaims")
    .map(validateCandidateClaim);
  const candidateIds = new Set(candidateClaims.map((claim) => claim.id));
  const comparisons = requireArray(root.comparisons, "claimAnalysis.comparisons")
    .map((item, index) => validateClaimComparison(item, index, candidateIds));
  if (comparisons.length !== candidateClaims.length) {
    throw new SourceAnalysisValidationError("每条 Candidate Claim 必须有一个比较结果。");
  }
  return {
    candidateClaims,
    comparisons,
    coverage: requireNumberInRange(root.coverage, 0, 1, "claimAnalysis.coverage")
  };
}

function validateCandidateClaim(value: unknown, index: number): CandidateClaim {
  const item = requireRecord(value, `claimAnalysis.candidateClaims[${index}]`);
  const statement = requireNonEmptyString(item.statement, `candidateClaims[${index}].statement`);
  const claim: CandidateClaim = {
    id: requireNonEmptyString(item.id, `candidateClaims[${index}].id`),
    statement,
    normalizedStatement: requireNonEmptyString(item.normalizedStatement, `candidateClaims[${index}].normalizedStatement`),
    type: requireEnum(item.type, ATOMIC_CLAIM_TYPES, `candidateClaims[${index}].type`),
    confidence: requireNumberInRange(item.confidence, 0, 1, `candidateClaims[${index}].confidence`)
  };
  if (claim.normalizedStatement !== normalizeClaim(statement)) {
    throw new SourceAnalysisValidationError(`candidateClaims[${index}].normalizedStatement 与 statement 不一致。`);
  }
  if (item.topic !== undefined) claim.topic = requireNonEmptyString(item.topic, `candidateClaims[${index}].topic`);
  if (item.scope !== undefined) claim.scope = validateStringArray(item.scope, `candidateClaims[${index}].scope`);
  if (item.qualifiers !== undefined) claim.qualifiers = validateStringArray(item.qualifiers, `candidateClaims[${index}].qualifiers`);
  if (item.sourceExcerpt !== undefined) claim.sourceExcerpt = requireNonEmptyString(item.sourceExcerpt, `candidateClaims[${index}].sourceExcerpt`);
  return claim;
}

function validateClaimComparison(
  value: unknown,
  index: number,
  candidateIds: Set<string>
): ClaimComparison {
  const item = requireRecord(value, `claimAnalysis.comparisons[${index}]`);
  const candidateClaimId = requireNonEmptyString(item.candidateClaimId, `comparisons[${index}].candidateClaimId`);
  if (!candidateIds.has(candidateClaimId)) {
    throw new SourceAnalysisValidationError(`comparisons[${index}] 引用了未知 Candidate Claim。`);
  }
  const relation = requireEnum(item.relation, CLAIM_RELATIONS, `comparisons[${index}].relation`);
  const result: ClaimComparison = {
    candidateClaimId,
    candidateStatement: requireNonEmptyString(item.candidateStatement, `comparisons[${index}].candidateStatement`),
    relation,
    reasoning: requireNonEmptyString(item.reasoning, `comparisons[${index}].reasoning`),
    confidence: requireNumberInRange(item.confidence, 0, 1, `comparisons[${index}].confidence`)
  };
  if (item.existingClaimId !== undefined) result.existingClaimId = requireNonEmptyString(item.existingClaimId, `comparisons[${index}].existingClaimId`);
  if (item.existingStatement !== undefined) result.existingStatement = requireNonEmptyString(item.existingStatement, `comparisons[${index}].existingStatement`);
  if (item.similarity !== undefined) result.similarity = requireNumberInRange(item.similarity, 0, 1, `comparisons[${index}].similarity`);
  if (item.coverage !== undefined) {
    result.coverage = validateCoverageResult(item.coverage, candidateClaimId, index);
    const expectedRelation = {
      none: "add",
      partial: "refine",
      full: "reinforce",
      conflicting: "challenge"
    } as const;
    if (expectedRelation[result.coverage.coverage] !== relation) {
      throw new SourceAnalysisValidationError(
        `comparisons[${index}] 的 Coverage 与 Relation 不一致。`
      );
    }
  }
  if (item.debug !== undefined) {
    result.debug = validateComparisonDebug(item.debug, result, index);
  }
  if (relation !== "add" && result.existingClaimId === undefined) {
    throw new SourceAnalysisValidationError(`comparisons[${index}] 非 ADD 关系必须引用 Existing Claim。`);
  }
  return result;
}

function validateCoverageResult(value: unknown, candidateClaimId: string, index: number): ClaimCoverageResult {
  const item = requireRecord(value, `comparisons[${index}].coverage`);
  const storedCandidateId = requireNonEmptyString(item.candidateClaimId, `comparisons[${index}].coverage.candidateClaimId`);
  if (storedCandidateId !== candidateClaimId) {
    throw new SourceAnalysisValidationError(`comparisons[${index}].coverage Candidate ID 不一致。`);
  }
  const result: ClaimCoverageResult = {
    candidateClaimId,
    coverage: requireEnum(item.coverage, CLAIM_COVERAGES, `comparisons[${index}].coverage.coverage`),
    coreAspects: validateStringArray(item.coreAspects, `comparisons[${index}].coverage.coreAspects`),
    coveredBy: validateStringArray(item.coveredBy, `comparisons[${index}].coverage.coveredBy`),
    coveredAspects: validateStringArray(item.coveredAspects, `comparisons[${index}].coverage.coveredAspects`),
    uncoveredAspects: validateStringArray(item.uncoveredAspects, `comparisons[${index}].coverage.uncoveredAspects`),
    conflictingAspects: validateStringArray(item.conflictingAspects, `comparisons[${index}].coverage.conflictingAspects`),
    pairwise: requireArray(item.pairwise, `comparisons[${index}].coverage.pairwise`).map((entry, pairIndex) => {
      const pair = requireRecord(entry, `comparisons[${index}].coverage.pairwise[${pairIndex}]`);
      return {
        claimId: requireNonEmptyString(pair.claimId, `comparisons[${index}].coverage.pairwise[${pairIndex}].claimId`),
        relation: requireEnum(pair.relation, PAIRWISE_RELATIONS, `comparisons[${index}].coverage.pairwise[${pairIndex}].relation`),
        coveredAspects: validateStringArray(pair.coveredAspects, `comparisons[${index}].coverage.pairwise[${pairIndex}].coveredAspects`),
        conflictingAspects: validateStringArray(pair.conflictingAspects, `comparisons[${index}].coverage.pairwise[${pairIndex}].conflictingAspects`),
        reasoning: requireNonEmptyString(pair.reasoning, `comparisons[${index}].coverage.pairwise[${pairIndex}].reasoning`)
      };
    }),
    reasoning: requireNonEmptyString(item.reasoning, `comparisons[${index}].coverage.reasoning`),
    confidence: requireNumberInRange(item.confidence, 0, 1, `comparisons[${index}].coverage.confidence`)
  };
  if (result.coreAspects.length === 0 || result.coreAspects.length > 5) {
    throw new SourceAnalysisValidationError(`comparisons[${index}].coverage.coreAspects 必须包含 1 到 5 项。`);
  }
  return result;
}

function validateComparisonDebug(
  value: unknown,
  comparison: ClaimComparison,
  index: number
): ClaimComparisonDebug {
  const item = requireRecord(value, `comparisons[${index}].debug`);
  const coverage = validateCoverageResult(item.coverage, comparison.candidateClaimId, index);
  const finalRelation = requireEnum(item.finalRelation, CLAIM_RELATIONS, `comparisons[${index}].debug.finalRelation`);
  if (finalRelation !== comparison.relation) {
    throw new SourceAnalysisValidationError(`comparisons[${index}].debug Relation 不一致。`);
  }
  return {
    comparisonVersion: requireEnum(item.comparisonVersion, ["claim-comparison-v1", "claim-comparison-v2"], `comparisons[${index}].debug.comparisonVersion`),
    executionMode: item.executionMode === undefined
      ? "llm"
      : requireEnum(item.executionMode, ["cache", "fast_path", "llm"], `comparisons[${index}].debug.executionMode`),
    candidate: requireNonEmptyString(item.candidate, `comparisons[${index}].debug.candidate`),
    topClaims: requireArray(item.topClaims, `comparisons[${index}].debug.topClaims`).map((entry, claimIndex) => {
      const claim = requireRecord(entry, `comparisons[${index}].debug.topClaims[${claimIndex}]`);
      return {
        id: requireNonEmptyString(claim.id, `comparisons[${index}].debug.topClaims[${claimIndex}].id`),
        statement: requireNonEmptyString(claim.statement, `comparisons[${index}].debug.topClaims[${claimIndex}].statement`),
        pairwiseRelation: requireEnum(claim.pairwiseRelation, PAIRWISE_RELATIONS, `comparisons[${index}].debug.topClaims[${claimIndex}].pairwiseRelation`)
      };
    }),
    coverage,
    finalRelation,
    confidence: requireNumberInRange(item.confidence, 0, 1, `comparisons[${index}].debug.confidence`),
    guardsTriggered: validateStringArray(item.guardsTriggered, `comparisons[${index}].debug.guardsTriggered`)
  };
}

function validateStringArray(value: unknown, field: string): string[] {
  return requireArray(value, field).map((item, index) => requireNonEmptyString(item, `${field}[${index}]`));
}

export function extractFirstJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start < 0) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function validateRelatedNote(value: unknown, index: number): RelatedNote {
  const item = requireRecord(value, `relatedNotes[${index}]`);
  return {
    path: requireNonEmptyString(item.path, `relatedNotes[${index}].path`),
    title: requireNonEmptyString(item.title, `relatedNotes[${index}].title`),
    relevance: requireNumberInRange(item.relevance, 0, 1, `relatedNotes[${index}].relevance`),
    reason: requireNonEmptyString(item.reason, `relatedNotes[${index}].reason`)
  };
}

function validateClaim(value: unknown, index: number): Claim {
  const item = requireRecord(value, `newClaims[${index}]`);
  const claim: Claim = {
    statement: requireNonEmptyString(item.statement, `newClaims[${index}].statement`),
    type: requireEnum(item.type, CLAIM_TYPES, `newClaims[${index}].type`),
    novelty: requireEnum(item.novelty, CLAIM_NOVELTIES, `newClaims[${index}].novelty`),
    confidence: requireNumberInRange(item.confidence, 0, 1, `newClaims[${index}].confidence`)
  };
  if (item.sourceExcerpt !== undefined) {
    claim.sourceExcerpt = requireNonEmptyString(
      item.sourceExcerpt,
      `newClaims[${index}].sourceExcerpt`
    );
  }
  return claim;
}

function validateConflict(value: unknown, index: number): Conflict {
  const item = requireRecord(value, `conflicts[${index}]`);
  if (item.status !== "unverified") {
    throw new SourceAnalysisValidationError(
      `conflicts[${index}].status 必须为 unverified。`
    );
  }
  return {
    newClaim: requireNonEmptyString(item.newClaim, `conflicts[${index}].newClaim`),
    existingClaim: requireNonEmptyString(item.existingClaim, `conflicts[${index}].existingClaim`),
    existingFile: requireNonEmptyString(item.existingFile, `conflicts[${index}].existingFile`),
    type: requireEnum(item.type, CONFLICT_TYPES, `conflicts[${index}].type`),
    confidence: requireNumberInRange(item.confidence, 0, 1, `conflicts[${index}].confidence`),
    explanation: requireNonEmptyString(item.explanation, `conflicts[${index}].explanation`),
    status: "unverified"
  };
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceAnalysisValidationError(`${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SourceAnalysisValidationError(`${field} 必须是数组。`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SourceAnalysisValidationError(`${field} 必须是非空字符串。`);
  }
  return value.trim();
}

function requireNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new SourceAnalysisValidationError(
      `${field} 必须是 ${minimum}～${maximum} 之间的数字。`
    );
  }
  return value;
}

function requireIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string
): number {
  const number = requireNumberInRange(value, minimum, maximum, field);
  if (!Number.isInteger(number)) {
    throw new SourceAnalysisValidationError(`${field} 必须是整数。`);
  }
  return number;
}

function requireEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  field: string
): T {
  if (typeof value !== "string" || allowedValues.indexOf(value as T) < 0) {
    throw new SourceAnalysisValidationError(
      `${field} 的值不在允许范围内。`
    );
  }
  return value as T;
}
