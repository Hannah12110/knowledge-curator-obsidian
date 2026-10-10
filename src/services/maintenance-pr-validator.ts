import type { KnowledgePR, KnowledgePRProposal } from "../types/knowledge-pr";
import type { FreshnessVerificationResult } from "../types/maintenance";
import type { ExternalEvidence } from "../types/verification";
import { canonicalizeUrl } from "./source-ranking-service";
import { isInsideWritableWikiScope } from "./write-scope-guard";

export class MaintenancePRValidationError extends Error {
  constructor(message: string) { super(message); this.name = "MaintenancePRValidationError"; }
}

export interface MaintenancePRValidationContext {
  claimId: string;
  claimFingerprint: string;
  targetPath: string;
  targetMtime: number;
  targetHash: string;
  targetContent: string;
  verification: FreshnessVerificationResult;
  expectedStatus: "draft" | "accepted" | "rejected";
}

export function validateMaintenanceProposal(proposal: KnowledgePRProposal, context: MaintenancePRValidationContext): void {
  if (context.verification.resolution !== "stale" && context.verification.resolution !== "needs_refinement") {
    throw new MaintenancePRValidationError("当前 Freshness Resolution 不允许生成正文 PR。");
  }
  if (proposal.changes.length === 0 || proposal.changes.length > 3) throw new MaintenancePRValidationError("Maintenance PR changes 必须为 1～3 条。");
  const expectedType = context.verification.resolution === "stale" ? "replace" : "refine";
  for (const change of proposal.changes) {
    if (change.type !== expectedType) throw new MaintenancePRValidationError(`该 Freshness Resolution 只允许 ${expectedType}。`);
    if (change.before === undefined || count(context.targetContent, change.before) !== 1) throw new MaintenancePRValidationError("before 必须逐字匹配 Target Wiki 中唯一短文本。");
    if (change.sourceClaims.length !== 1 || change.sourceClaims[0] !== context.verification.originalStatement) throw new MaintenancePRValidationError("sourceClaims 必须绑定被验证 Claim。");
  }
  validateExternalEvidence(proposal.evidence, context.verification.evidence);
}

export function validateMaintenancePR(pr: KnowledgePR, context: MaintenancePRValidationContext): void {
  if (pr.origin !== "maintenance" || pr.maintenanceContext === undefined) throw new MaintenancePRValidationError("不是有效 Maintenance PR。");
  if (!isInsideWritableWikiScope(pr.target.path) || pr.target.path !== context.targetPath || pr.sourcePath !== context.targetPath) throw new MaintenancePRValidationError("Maintenance PR target 不在测试写入范围。");
  if (pr.target.operation !== "update") throw new MaintenancePRValidationError("Maintenance PR 只允许更新已有 Wiki。");
  if (pr.status !== context.expectedStatus) throw new MaintenancePRValidationError("Maintenance PR 状态不符。");
  if (pr.sourceFingerprint.mtime !== context.targetMtime || pr.sourceFingerprint.hash !== context.targetHash || pr.targetFingerprint?.mtime !== context.targetMtime || pr.targetFingerprint.hash !== context.targetHash) throw new MaintenancePRValidationError("Maintenance PR fingerprint 已失效。");
  if (pr.maintenanceContext.claimId !== context.claimId || pr.maintenanceContext.claimFingerprint !== context.claimFingerprint || pr.maintenanceContext.verificationId !== context.verification.id || pr.maintenanceContext.freshnessResolution !== context.verification.resolution) throw new MaintenancePRValidationError("Maintenance Context 不一致。");
  validateMaintenanceProposal({ summary: pr.summary, changes: pr.changes, evidence: pr.evidence, confidence: pr.confidence }, context);
}

function validateExternalEvidence(evidence: KnowledgePR["evidence"], allowedEvidence: ExternalEvidence[]): void {
  const allowed = new Map(allowedEvidence.map((item) => [canonicalizeUrl(item.url), item]));
  if (!evidence.some((item) => item.kind === "external")) throw new MaintenancePRValidationError("Maintenance PR 必须引用外部证据。");
  for (const item of evidence) {
    if (item.kind !== "external") throw new MaintenancePRValidationError("Maintenance PR 只允许本次验证的外部证据。");
    const source = allowed.get(canonicalizeUrl(item.url));
    if (source === undefined || source.title !== item.sourceTitle || source.sourceTier !== item.sourceTier || source.supports !== item.supports) throw new MaintenancePRValidationError("External Evidence 未经本次验证授权。");
  }
}

function count(content: string, value: string): number {
  if (value === "") return 0;
  let result = 0, offset = 0;
  while ((offset = content.indexOf(value, offset)) >= 0) { result += 1; offset += value.length; }
  return result;
}
