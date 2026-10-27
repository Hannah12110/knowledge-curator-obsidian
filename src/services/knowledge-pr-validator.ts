import type {
  EvidenceRef,
  KnowledgeChange,
  KnowledgePR,
  KnowledgePRProposal,
  KnowledgePRStatus
} from "../types/knowledge-pr";
import type { RawRecommendation } from "../types/source-analysis";
import type {
  ConflictResolution,
  ExternalEvidence
} from "../types/verification";
import { canonicalizeUrl } from "./source-ranking-service";
import { isInsideWritableWikiScope } from "./write-scope-guard";
import type { ClaimRelation } from "../types/claim";

const CHANGE_TYPES = new Set(["add", "refine", "replace", "remove"]);
const RAW_RECOMMENDATIONS = new Set([
  "keep",
  "extract_only",
  "reject",
  "replace_canonical"
]);
const PR_STATUSES = new Set(["draft", "accepted", "rejected", "stale"]);

export interface KnowledgePRValidationContext {
  writableWikiRoot?: string;
  sourcePath: string;
  targetPath: string;
  targetOperation: "create" | "update";
  sourceMtime: number;
  sourceHash: string;
  targetMtime?: number;
  targetHash?: string;
  targetContent?: string;
  rawRecommendation: RawRecommendation;
  allowedSourceClaims: Set<string>;
  allowedEvidencePaths: Set<string>;
  allowedExternalEvidence?: Map<string, ExternalEvidence>;
  conflictPolicies?: Array<{
    existingClaim: string;
    newClaim: string;
    resolution?: ConflictResolution;
    evidenceUrls: Set<string>;
  }>;
  claimPolicies?: Array<{
    candidateStatement: string;
    relation: ClaimRelation;
  }>;
  expectedStatus?: KnowledgePRStatus;
}

export class KnowledgePRValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgePRValidationError";
  }
}

export function parseKnowledgePRProposal(response: string): KnowledgePRProposal {
  const parsed = parseJsonObject(response);
  const root = requireRecord(parsed, "Knowledge PR proposal");
  return {
    summary: requireNonEmptyString(root.summary, "summary"),
    changes: requireArray(root.changes, "changes").map(parseChange),
    evidence: requireArray(root.evidence, "evidence").map(parseEvidence),
    confidence: requireConfidence(root.confidence, "confidence")
  };
}

export function validateKnowledgePR(
  value: unknown,
  context: KnowledgePRValidationContext
): KnowledgePR {
  const root = requireRecord(value, "KnowledgePR");
  const target = requireRecord(root.target, "target");
  const sourceFingerprint = requireRecord(
    root.sourceFingerprint,
    "sourceFingerprint"
  );
  const targetFingerprint = root.targetFingerprint === undefined
    ? undefined
    : requireRecord(root.targetFingerprint, "targetFingerprint");
  const status = requireEnum(root.status, PR_STATUSES, "status") as KnowledgePRStatus;
  const operation = requireEnum(
    target.operation,
    new Set(["create", "update"]),
    "target.operation"
  ) as "create" | "update";
  const changes = requireArray(root.changes, "changes").map(parseChange);
  const evidence = requireArray(root.evidence, "evidence").map(parseEvidence);
  const pr: KnowledgePR = {
    id: requireNonEmptyString(root.id, "id"),
    sourcePath: requireNonEmptyString(root.sourcePath, "sourcePath"),
    target: {
      path: requireNonEmptyString(target.path, "target.path"),
      title: requireNonEmptyString(target.title, "target.title"),
      operation
    },
    summary: requireNonEmptyString(root.summary, "summary"),
    changes,
    evidence,
    rawRecommendation: requireEnum(
      root.rawRecommendation,
      RAW_RECOMMENDATIONS,
      "rawRecommendation"
    ) as RawRecommendation,
    confidence: requireConfidence(root.confidence, "confidence"),
    status,
    sourceFingerprint: {
      mtime: requireFiniteNumber(sourceFingerprint.mtime, "sourceFingerprint.mtime"),
      hash: requireHash(sourceFingerprint.hash, "sourceFingerprint.hash")
    },
    targetFingerprint: targetFingerprint === undefined
      ? undefined
      : {
          mtime: requireFiniteNumber(targetFingerprint.mtime, "targetFingerprint.mtime"),
          hash: requireHash(targetFingerprint.hash, "targetFingerprint.hash")
        },
    createdAt: requireIsoDate(root.createdAt, "createdAt"),
    claimRelations: Array.isArray(root.claimRelations)
      ? root.claimRelations as KnowledgePR["claimRelations"]
      : undefined
  };

  validateImmutableFields(pr, context);
  validateChanges(pr, context);
  validateEvidence(
    pr.evidence,
    context.allowedEvidencePaths,
    context.allowedExternalEvidence ?? new Map()
  );
  return pr;
}

function validateImmutableFields(
  pr: KnowledgePR,
  context: KnowledgePRValidationContext
): void {
  if (pr.sourcePath !== context.sourcePath) {
    throw new KnowledgePRValidationError("sourcePath 与当前文章不一致。");
  }
  if (pr.target.path !== context.targetPath || !isInsideWritableWikiScope(pr.target.path, context.writableWikiRoot)) {
    throw new KnowledgePRValidationError("target.path 不在允许的测试 Wiki 范围内。");
  }
  if (pr.target.operation !== context.targetOperation) {
    throw new KnowledgePRValidationError("target.operation 与目标状态不一致。");
  }
  if (
    pr.sourceFingerprint.mtime !== context.sourceMtime ||
    pr.sourceFingerprint.hash !== context.sourceHash
  ) {
    throw new KnowledgePRValidationError("Source fingerprint 不一致。");
  }
  if (pr.rawRecommendation !== context.rawRecommendation) {
    throw new KnowledgePRValidationError("rawRecommendation 与 SourceAnalysis 不一致。");
  }
  if (context.expectedStatus !== undefined && pr.status !== context.expectedStatus) {
    throw new KnowledgePRValidationError("Knowledge PR 状态不符合当前操作。");
  }
  if (pr.target.operation === "update") {
    if (
      pr.targetFingerprint === undefined ||
      pr.targetFingerprint.mtime !== context.targetMtime ||
      pr.targetFingerprint.hash !== context.targetHash ||
      context.targetContent === undefined
    ) {
      throw new KnowledgePRValidationError("Target fingerprint 不完整或不一致。");
    }
  } else if (pr.targetFingerprint !== undefined) {
    throw new KnowledgePRValidationError("Create PR 不应包含 targetFingerprint。");
  }
}

function validateChanges(
  pr: KnowledgePR,
  context: KnowledgePRValidationContext
): void {
  if (pr.changes.length === 0 || pr.changes.length > 5) {
    throw new KnowledgePRValidationError("changes 数量必须为 1～5。");
  }
  const ids = new Set<string>();
  for (const change of pr.changes) {
    if (ids.has(change.id)) {
      throw new KnowledgePRValidationError(`change id 重复：${change.id}`);
    }
    ids.add(change.id);
    if (change.type === "remove") {
      throw new KnowledgePRValidationError("Phase 3 MVP 不允许 remove 变更。");
    }
    if (change.after.length > 6_000) {
      throw new KnowledgePRValidationError("单条 after 超过最小变更长度限制。");
    }
    if (
      change.sourceClaims.length === 0 ||
      !change.sourceClaims.every((claim) => context.allowedSourceClaims.has(claim))
    ) {
      throw new KnowledgePRValidationError("sourceClaims 必须对应 Phase 2 分析结论。");
    }
    validateConflictChangePolicy(change, pr.evidence, context.conflictPolicies ?? []);
    validateClaimRelationPolicy(change, context.claimPolicies ?? []);
    if (pr.target.operation === "create") {
      if (change.type !== "add" || change.before !== undefined) {
        throw new KnowledgePRValidationError("Create PR 只能包含没有 before 的 add 变更。");
      }
      continue;
    }
    if (change.before === undefined || change.before.length === 0) {
      throw new KnowledgePRValidationError("Update PR 的每条变更都必须包含真实 before。");
    }
    const occurrences = countOccurrences(context.targetContent ?? "", change.before);
    if (occurrences !== 1) {
      throw new KnowledgePRValidationError(
        occurrences === 0
          ? "before 未在 Target Wiki 中找到。"
          : "before 在 Target Wiki 中出现多次。"
      );
    }
    if (change.after === context.targetContent) {
      throw new KnowledgePRValidationError("禁止用完整 Wiki 内容作为单条 after。");
    }
  }
}

function validateClaimRelationPolicy(
  change: KnowledgeChange,
  policies: NonNullable<KnowledgePRValidationContext["claimPolicies"]>
): void {
  for (const statement of change.sourceClaims) {
    const policy = policies.find((item) => item.candidateStatement === statement);
    if (policy === undefined) continue;
    if (policy.relation === "reinforce") {
      throw new KnowledgePRValidationError("REINFORCE Claim 不应生成重复 Wiki 正文。");
    }
    if (policy.relation === "add" && change.type !== "add") {
      throw new KnowledgePRValidationError("ADD Claim 必须生成 add 变更。");
    }
    if (policy.relation === "refine" && change.type !== "refine") {
      throw new KnowledgePRValidationError("REFINE Claim 必须生成 refine 变更。");
    }
  }
}

function validateEvidence(
  evidence: EvidenceRef[],
  allowedPaths: Set<string>,
  allowedExternal: Map<string, ExternalEvidence>
): void {
  if (evidence.length === 0) {
    throw new KnowledgePRValidationError("Knowledge PR 至少需要一条 Evidence。");
  }
  for (const item of evidence) {
    if (item.kind === "external") {
      const canonicalUrl = canonicalizeUrl(item.url);
      const allowed = canonicalUrl === null ? undefined : allowedExternal.get(canonicalUrl);
      if (
        allowed === undefined ||
        item.sourceTitle !== allowed.title ||
        item.sourceTier !== allowed.sourceTier ||
        item.supports !== allowed.supports
      ) {
        throw new KnowledgePRValidationError("External Evidence 未获验证结果授权。");
      }
    } else if (!allowedPaths.has(item.sourcePath)) {
      throw new KnowledgePRValidationError(`Evidence 路径未获授权：${item.sourcePath}`);
    }
    if (item.excerpt !== undefined && item.excerpt.length > 1_000) {
      throw new KnowledgePRValidationError("Evidence excerpt 过长。");
    }
  }
}

function validateConflictChangePolicy(
  change: KnowledgeChange,
  evidence: EvidenceRef[],
  policies: NonNullable<KnowledgePRValidationContext["conflictPolicies"]>
): void {
  const relatedPolicies = policies.filter((policy) =>
    change.sourceClaims.includes(policy.existingClaim) ||
    change.sourceClaims.includes(policy.newClaim)
  );
  if (change.type === "replace" && policies.length > 0 && relatedPolicies.length === 0) {
    throw new KnowledgePRValidationError(
      "存在冲突时，replace 必须明确绑定经过 SUPERSEDE 验证的冲突。"
    );
  }
  for (const policy of relatedPolicies) {
    if (change.type !== "replace") {
      continue;
    }
    if (policy.resolution !== "supersede") {
      throw new KnowledgePRValidationError(
        "只有经过 SUPERSEDE 验证的冲突才允许 replace。"
      );
    }
    const hasAuthorizedExternalEvidence = evidence.some((item) =>
      item.kind === "external" &&
      policy.evidenceUrls.has(canonicalizeUrl(item.url) ?? "")
    );
    if (!hasAuthorizedExternalEvidence) {
      throw new KnowledgePRValidationError(
        "SUPERSEDE replace 必须引用对应的外部验证证据。"
      );
    }
  }
}

function parseChange(value: unknown, index: number): KnowledgeChange {
  const item = requireRecord(value, `changes[${index}]`);
  const type = requireEnum(item.type, CHANGE_TYPES, `changes[${index}].type`) as KnowledgeChange["type"];
  return {
    id: requireNonEmptyString(item.id, `changes[${index}].id`),
    type,
    section: optionalString(item.section, `changes[${index}].section`),
    before: optionalString(item.before, `changes[${index}].before`),
    after: requireNonEmptyString(item.after, `changes[${index}].after`),
    reason: requireNonEmptyString(item.reason, `changes[${index}].reason`),
    sourceClaims: requireArray(item.sourceClaims, `changes[${index}].sourceClaims`)
      .map((claim, claimIndex) => requireNonEmptyString(
        claim,
        `changes[${index}].sourceClaims[${claimIndex}]`
      )),
    confidence: requireConfidence(item.confidence, `changes[${index}].confidence`)
  };
}

function parseEvidence(value: unknown, index: number): EvidenceRef {
  const item = requireRecord(value, `evidence[${index}]`);
  if (item.kind === "external") {
    const sourceTier = requireFiniteNumber(item.sourceTier, `evidence[${index}].sourceTier`);
    if (!Number.isInteger(sourceTier) || sourceTier < 0 || sourceTier > 4) {
      throw new KnowledgePRValidationError(`evidence[${index}].sourceTier 必须为 0～4 的整数。`);
    }
    const url = requireNonEmptyString(item.url, `evidence[${index}].url`);
    if (canonicalizeUrl(url) === null) {
      throw new KnowledgePRValidationError(`evidence[${index}].url 必须是 HTTP(S) URL。`);
    }
    return {
      kind: "external",
      sourceTitle: requireNonEmptyString(item.sourceTitle, `evidence[${index}].sourceTitle`),
      url,
      sourceTier: sourceTier as 0 | 1 | 2 | 3 | 4,
      supports: requireEnum(
        item.supports,
        new Set(["existing", "new", "both", "neither"]),
        `evidence[${index}].supports`
      ) as "existing" | "new" | "both" | "neither",
      conclusion: requireNonEmptyString(item.conclusion, `evidence[${index}].conclusion`),
      confidence: requireConfidence(item.confidence, `evidence[${index}].confidence`),
      excerpt: optionalString(item.excerpt, `evidence[${index}].excerpt`)
    };
  }
  return {
    kind: item.kind === "internal" ? "internal" : undefined,
    sourcePath: requireNonEmptyString(item.sourcePath, `evidence[${index}].sourcePath`),
    sourceTitle: requireNonEmptyString(item.sourceTitle, `evidence[${index}].sourceTitle`),
    claim: optionalString(item.claim, `evidence[${index}].claim`),
    excerpt: optionalString(item.excerpt, `evidence[${index}].excerpt`)
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
  throw new KnowledgePRValidationError("模型没有返回合法 JSON。");
}

function countOccurrences(content: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - value.length) {
    const index = content.indexOf(value, offset);
    if (index < 0) {
      break;
    }
    count += 1;
    offset = index + value.length;
  }
  return count;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KnowledgePRValidationError(`${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new KnowledgePRValidationError(`${field} 必须是数组。`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KnowledgePRValidationError(`${field} 必须是非空字符串。`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, field);
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new KnowledgePRValidationError(`${field} 必须是有限数字。`);
  }
  return value;
}

function requireConfidence(value: unknown, field: string): number {
  const number = requireFiniteNumber(value, field);
  if (number < 0 || number > 1) {
    throw new KnowledgePRValidationError(`${field} 必须在 0～1 之间。`);
  }
  return number;
}

function requireHash(value: unknown, field: string): string {
  const hash = requireNonEmptyString(value, field);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new KnowledgePRValidationError(`${field} 必须是 SHA-256。`);
  }
  return hash;
}

function requireIsoDate(value: unknown, field: string): string {
  const date = requireNonEmptyString(value, field);
  if (Number.isNaN(Date.parse(date))) {
    throw new KnowledgePRValidationError(`${field} 必须是有效时间。`);
  }
  return date;
}

function requireEnum(
  value: unknown,
  allowed: Set<string>,
  field: string
): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new KnowledgePRValidationError(`${field} 枚举值无效。`);
  }
  return value;
}
