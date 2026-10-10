import {
  CLAIM_STORE_SCHEMA_VERSION
} from "../types/claim";
import type {
  CandidateClaim,
  ClaimCoverageResult,
  ClaimComparison,
  ClaimProvenance,
  ClaimRecord,
  ClaimRelation,
  ClaimStore,
  ClaimType
} from "../types/claim";
import { normalizeClaim } from "./claim-identity";

const CLAIM_TYPES: ClaimType[] = [
  "definition", "fact", "causal", "quantitative", "method",
  "experiential", "predictive", "opinion"
];
const RELATIONS: ClaimRelation[] = ["add", "reinforce", "refine", "challenge", "supersede"];
const COVERAGES = ["none", "partial", "full", "conflicting"] as const;
const PAIRWISE_RELATIONS = [
  "equivalent", "existing_broader", "candidate_broader", "overlap", "conflict", "unrelated"
] as const;
const MAX_STATEMENT_LENGTH = 800;
const MAX_EXCERPT_LENGTH = 1_000;

export class ClaimValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimValidationError";
  }
}

export interface ExtractedClaimInput {
  statement: string;
  type: ClaimType;
  topic?: string;
  scope?: string[];
  qualifiers?: string[];
  confidence: number;
  heading?: string;
  excerpt?: string;
}

export function parseExtractedClaims(text: string): ExtractedClaimInput[] {
  const root = parseJsonObject(text);
  const values = requireArray(root.claims, "claims");
  if (values.length > 50) {
    throw new ClaimValidationError("单篇 Wiki 最多允许 50 条 Claim。");
  }
  const output = values.map((value, index) => validateExtractedClaim(value, index));
  const seen = new Set<string>();
  for (const claim of output) {
    const normalized = normalizeClaim(claim.statement);
    if (seen.has(normalized)) {
      throw new ClaimValidationError("抽取结果包含重复 Claim。");
    }
    seen.add(normalized);
  }
  return output;
}

export function parseClaimComparisons(
  text: string,
  candidates: CandidateClaim[],
  allowedExistingIds: Set<string>
): ClaimComparison[] {
  const root = parseJsonObject(text);
  const values = requireArray(root.comparisons, "comparisons");
  if (values.length !== candidates.length) {
    throw new ClaimValidationError("每条 Candidate Claim 必须且只能有一个比较结果。");
  }
  const candidateMap = new Map(candidates.map((claim) => [claim.id, claim]));
  const seen = new Set<string>();
  return values.map((value, index) => {
    const item = requireRecord(value, `comparisons[${index}]`);
    const candidateClaimId = requireString(item.candidateClaimId, `comparisons[${index}].candidateClaimId`);
    const candidate = candidateMap.get(candidateClaimId);
    if (candidate === undefined || seen.has(candidateClaimId)) {
      throw new ClaimValidationError("比较结果包含未知或重复 Candidate Claim ID。");
    }
    seen.add(candidateClaimId);
    let relation = requireEnum(item.relation, RELATIONS, `comparisons[${index}].relation`);
    if (relation === "supersede") {
      relation = "challenge";
    }
    const existingClaimId = optionalString(item.existingClaimId);
    if (existingClaimId !== undefined && !allowedExistingIds.has(existingClaimId)) {
      throw new ClaimValidationError("比较结果引用了未提供的 Existing Claim。");
    }
    if (relation !== "add" && existingClaimId === undefined) {
      throw new ClaimValidationError("非 ADD 关系必须引用 Existing Claim。");
    }
    if (relation === "add" && existingClaimId !== undefined) {
      throw new ClaimValidationError("ADD 关系不能引用 Existing Claim。");
    }
    const comparison: ClaimComparison = {
      candidateClaimId,
      candidateStatement: candidate.statement,
      relation,
      reasoning: requireString(item.reasoning, `comparisons[${index}].reasoning`),
      confidence: requireConfidence(item.confidence, `comparisons[${index}].confidence`)
    };
    if (existingClaimId !== undefined) comparison.existingClaimId = existingClaimId;
    const existingStatement = optionalString(item.existingStatement);
    if (existingClaimId !== undefined && existingStatement !== undefined) {
      comparison.existingStatement = existingStatement;
    }
    if (item.similarity !== undefined) {
      comparison.similarity = requireConfidence(item.similarity, `comparisons[${index}].similarity`);
    }
    return comparison;
  });
}

export function parseClaimCoverageResults(
  text: string,
  candidates: CandidateClaim[],
  allowedExistingIdsByCandidate: Map<string, Set<string>>
): ClaimCoverageResult[] {
  const root = parseJsonObject(text);
  const values = requireArray(root.coverages, "coverages");
  if (values.length !== candidates.length) {
    throw new ClaimValidationError("每条 Candidate Claim 必须且只能有一个 Coverage 结果。");
  }
  const candidateMap = new Map(candidates.map((claim) => [claim.id, claim]));
  const seen = new Set<string>();
  return values.map((value, index) => {
    const item = requireRecord(value, `coverages[${index}]`);
    const candidateClaimId = requireString(item.candidateClaimId, `coverages[${index}].candidateClaimId`);
    if (!candidateMap.has(candidateClaimId) || seen.has(candidateClaimId)) {
      throw new ClaimValidationError("Coverage 结果包含未知或重复 Candidate Claim ID。");
    }
    seen.add(candidateClaimId);
    const allowed = allowedExistingIdsByCandidate.get(candidateClaimId) ?? new Set<string>();
    const coreAspects = requireBoundedAspectArray(item.coreAspects, `coverages[${index}].coreAspects`);
    const coveredBy = requireStringArray(item.coveredBy, `coverages[${index}].coveredBy`);
    if (coveredBy.some((id) => !allowed.has(id))) {
      throw new ClaimValidationError("Coverage 引用了未提供的 Existing Claim。");
    }
    const coverage = requireEnum(item.coverage, COVERAGES, `coverages[${index}].coverage`);
    const coveredAspects = requireStringArray(item.coveredAspects, `coverages[${index}].coveredAspects`);
    const uncoveredAspects = requireStringArray(item.uncoveredAspects, `coverages[${index}].uncoveredAspects`);
    const conflictingAspects = requireStringArray(item.conflictingAspects, `coverages[${index}].conflictingAspects`);
    const pairwise = requireArray(item.pairwise, `coverages[${index}].pairwise`).map((entry, pairIndex) => {
      const pair = requireRecord(entry, `coverages[${index}].pairwise[${pairIndex}]`);
      const claimId = requireString(pair.claimId, `coverages[${index}].pairwise[${pairIndex}].claimId`);
      if (!allowed.has(claimId)) {
        throw new ClaimValidationError("Pairwise Coverage 引用了未提供的 Existing Claim。");
      }
      return {
        claimId,
        relation: requireEnum(pair.relation, PAIRWISE_RELATIONS, `coverages[${index}].pairwise[${pairIndex}].relation`),
        coveredAspects: requireStringArray(pair.coveredAspects, `coverages[${index}].pairwise[${pairIndex}].coveredAspects`),
        conflictingAspects: requireStringArray(pair.conflictingAspects, `coverages[${index}].pairwise[${pairIndex}].conflictingAspects`),
        reasoning: requireString(pair.reasoning, `coverages[${index}].pairwise[${pairIndex}].reasoning`)
      };
    });
    validateCoverageConsistency(coverage, coveredBy, coveredAspects, uncoveredAspects, conflictingAspects, pairwise);
    return {
      candidateClaimId,
      coverage,
      coreAspects,
      coveredBy: [...new Set(coveredBy)],
      coveredAspects,
      uncoveredAspects,
      conflictingAspects,
      pairwise,
      reasoning: requireString(item.reasoning, `coverages[${index}].reasoning`),
      confidence: requireConfidence(item.confidence, `coverages[${index}].confidence`)
    };
  });
}

function validateCoverageConsistency(
  coverage: ClaimCoverageResult["coverage"],
  coveredBy: string[],
  coveredAspects: string[],
  uncoveredAspects: string[],
  conflictingAspects: string[],
  pairwise: ClaimCoverageResult["pairwise"]
): void {
  if (coverage === "none") {
    if (coveredBy.length > 0 || coveredAspects.length > 0 || conflictingAspects.length > 0 ||
      pairwise.some((item) => item.relation !== "unrelated")) {
      throw new ClaimValidationError("Coverage=none 不能包含已覆盖、冲突或相关 Pairwise 结果。");
    }
    return;
  }
  if (coveredBy.length === 0) {
    throw new ClaimValidationError("非 none Coverage 必须引用至少一条 Existing Claim。");
  }
  if (coverage === "full" && (uncoveredAspects.length > 0 || conflictingAspects.length > 0)) {
    throw new ClaimValidationError("Coverage=full 不能包含未覆盖或冲突 Aspect。");
  }
  if (coverage === "partial" && (coveredAspects.length === 0 || uncoveredAspects.length === 0)) {
    throw new ClaimValidationError("Coverage=partial 必须同时包含已覆盖和未覆盖 Aspect。");
  }
  if (coverage === "conflicting" && conflictingAspects.length === 0) {
    throw new ClaimValidationError("Coverage=conflicting 必须列出冲突 Aspect。");
  }
}

function requireBoundedAspectArray(value: unknown, field: string): string[] {
  const result = requireStringArray(value, field);
  if (result.length === 0 || result.length > 5) {
    throw new ClaimValidationError(`${field} 必须包含 1 到 5 个核心 Aspect。`);
  }
  return result;
}

function requireStringArray(value: unknown, field: string): string[] {
  return requireArray(value, field).map((item, index) => requireString(item, `${field}[${index}]`));
}

export function validateClaimStore(value: unknown): ClaimStore {
  const root = requireRecord(value, "claimStore");
  if (root.schemaVersion !== CLAIM_STORE_SCHEMA_VERSION) {
    throw new ClaimValidationError("Claim Store schema 版本不兼容，需要重新构建。");
  }
  const claimsValue = requireRecord(root.claims, "claims");
  const claims: Record<string, ClaimRecord> = {};
  for (const [id, value] of Object.entries(claimsValue)) {
    const claim = validateClaimRecord(value, id);
    claims[id] = claim;
  }
  const filesValue = requireRecord(root.files, "files");
  const files: ClaimStore["files"] = {};
  for (const [path, value] of Object.entries(filesValue)) {
    const item = requireRecord(value, `files.${path}`);
    const claimIds = requireArray(item.claimIds, `files.${path}.claimIds`).map((id, index) =>
      requireString(id, `files.${path}.claimIds[${index}]`)
    );
    if (claimIds.some((id) => claims[id] === undefined)) {
      throw new ClaimValidationError(`files.${path} 引用了不存在的 Claim。`);
    }
    files[path] = {
      fileHash: requireString(item.fileHash, `files.${path}.fileHash`),
      claimIds,
      indexedAt: requireIsoDate(item.indexedAt, `files.${path}.indexedAt`)
    };
  }
  const failedFilesValue = requireRecord(root.failedFiles ?? {}, "failedFiles");
  const failedFiles: Record<string, string> = {};
  for (const [path, message] of Object.entries(failedFilesValue)) {
    failedFiles[path] = requireString(message, `failedFiles.${path}`);
  }
  return {
    schemaVersion: CLAIM_STORE_SCHEMA_VERSION,
    generatedAt: requireIsoDate(root.generatedAt, "generatedAt"),
    claims,
    files,
    failedFiles
  };
}

function validateExtractedClaim(value: unknown, index: number): ExtractedClaimInput {
  const item = requireRecord(value, `claims[${index}]`);
  const statement = requireString(item.statement, `claims[${index}].statement`);
  if (statement.length > MAX_STATEMENT_LENGTH) {
    throw new ClaimValidationError(`claims[${index}].statement 过长。`);
  }
  const result: ExtractedClaimInput = {
    statement,
    type: requireEnum(item.type, CLAIM_TYPES, `claims[${index}].type`),
    confidence: requireConfidence(item.confidence, `claims[${index}].confidence`)
  };
  const topic = optionalString(item.topic);
  if (topic !== undefined) result.topic = topic;
  const scope = optionalStringArray(item.scope, `claims[${index}].scope`);
  if (scope !== undefined) result.scope = scope;
  const qualifiers = optionalStringArray(item.qualifiers, `claims[${index}].qualifiers`);
  if (qualifiers !== undefined) result.qualifiers = qualifiers;
  const heading = optionalString(item.heading);
  if (heading !== undefined) result.heading = heading;
  const excerpt = optionalString(item.excerpt);
  if (excerpt !== undefined) result.excerpt = excerpt.slice(0, MAX_EXCERPT_LENGTH);
  return result;
}

function validateClaimRecord(value: unknown, expectedId: string): ClaimRecord {
  const item = requireRecord(value, `claims.${expectedId}`);
  const provenance = requireArray(item.provenance, `claims.${expectedId}.provenance`)
    .map((entry, index) => validateProvenance(entry, `claims.${expectedId}.provenance[${index}]`));
  if (provenance.length === 0) {
    throw new ClaimValidationError("Claim 必须包含 provenance。");
  }
  const id = requireString(item.id, `claims.${expectedId}.id`);
  if (id !== expectedId) throw new ClaimValidationError("Claim ID 与索引 Key 不一致。");
  const status = requireEnum(item.status, ["active", "disputed", "superseded", "deprecated"], "status");
  const statement = requireString(item.statement, "statement");
  const record: ClaimRecord = {
    id,
    statement,
    normalizedStatement: requireString(item.normalizedStatement, "normalizedStatement"),
    type: requireEnum(item.type, CLAIM_TYPES, "type"),
    status,
    confidence: requireConfidence(item.confidence, "confidence"),
    provenance,
    createdAt: requireIsoDate(item.createdAt, "createdAt"),
    updatedAt: requireIsoDate(item.updatedAt, "updatedAt")
  };
  const topic = optionalString(item.topic);
  if (topic !== undefined) record.topic = topic;
  const scope = optionalStringArray(item.scope, "scope");
  if (scope !== undefined) record.scope = scope;
  const qualifiers = optionalStringArray(item.qualifiers, "qualifiers");
  if (qualifiers !== undefined) record.qualifiers = qualifiers;
  return record;
}

function validateProvenance(value: unknown, field: string): ClaimProvenance {
  const item = requireRecord(value, field);
  const sourceKind = requireEnum(item.sourceKind, ["wiki", "source", "raw", "external"], `${field}.sourceKind`);
  const result: ClaimProvenance = {
    filePath: requireString(item.filePath, `${field}.filePath`),
    fileHash: requireString(item.fileHash, `${field}.fileHash`),
    sourceKind
  };
  const heading = optionalString(item.heading);
  if (heading !== undefined) result.heading = heading;
  const excerpt = optionalString(item.excerpt);
  if (excerpt !== undefined) result.excerpt = excerpt.slice(0, MAX_EXCERPT_LENGTH);
  if (typeof item.accepted === "boolean") result.accepted = item.accepted;
  return result;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  try {
    return requireRecord(JSON.parse(candidate) as unknown, "root");
  } catch (error: unknown) {
    if (error instanceof ClaimValidationError) throw error;
    throw new ClaimValidationError("模型响应不是有效 JSON 对象。");
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClaimValidationError(`${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}
function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ClaimValidationError(`${field} 必须是数组。`);
  return value;
}
function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ClaimValidationError(`${field} 必须是非空字符串。`);
  }
  return value.trim();
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  const values = requireArray(value, field).map((item, index) => requireString(item, `${field}[${index}]`));
  return values.length === 0 ? undefined : [...new Set(values)];
}
function requireConfidence(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ClaimValidationError(`${field} 必须是 0～1 数字。`);
  }
  return value;
}
function requireIsoDate(value: unknown, field: string): string {
  const date = requireString(value, field);
  if (Number.isNaN(Date.parse(date))) throw new ClaimValidationError(`${field} 必须是 ISO 日期。`);
  return date;
}
function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ClaimValidationError(`${field} 值无效。`);
  }
  return value as T;
}
