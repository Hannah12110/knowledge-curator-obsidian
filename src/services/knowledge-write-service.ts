import type { CachedSourceAnalysis } from "../types/analysis";
import type {
  KnowledgeChange,
  KnowledgePR,
  KnowledgePRHistoryRecord
} from "../types/knowledge-pr";
import type { CachedConflictVerification } from "../types/verification";
import { sha256Text } from "./content-hash";
import { HistoryService } from "./history-service";
import { KnowledgePRCacheService } from "./knowledge-pr-cache-service";
import { validateKnowledgePR } from "./knowledge-pr-validator";
import type { KnowledgeFileStore } from "./knowledge-file-store";
import { isInsideWritableWikiScope } from "./write-scope-guard";
import type { KnowledgeCuratorMode } from "../types/settings";
import type { FreshnessVerificationResult } from "../types/maintenance";
import { validateMaintenancePR } from "./maintenance-pr-validator";

export class KnowledgeWriteError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
    public readonly originalError?: unknown
  ) {
    super(userMessage);
    this.name = "KnowledgeWriteError";
  }
}

export interface KnowledgeDecisionResult {
  pr: KnowledgePR;
  historyPath: string;
  beforeHash?: string;
  afterHash?: string;
  claimStoreUpdated?: boolean;
  claimStoreWarning?: string;
}

export interface AcceptedWikiIndexer {
  reindexWiki(path: string): Promise<void>;
}

export class KnowledgeWriteService {
  constructor(
    private readonly store: KnowledgeFileStore,
    private readonly historyService: HistoryService,
    private readonly cacheService: KnowledgePRCacheService,
    private readonly getMode: () => KnowledgeCuratorMode = () => "test",
    private readonly acceptedWikiIndexer?: AcceptedWikiIndexer,
    private readonly getWritableWikiRoot?: () => string
  ) {}

  async accept(
    pr: KnowledgePR,
    analysisEntry: CachedSourceAnalysis,
    verifications: CachedConflictVerification[] = []
  ): Promise<KnowledgeDecisionResult> {
    this.assertTestMode();
    this.assertDraft(pr);
    this.assertWritableTarget(pr.target.path);
    const source = await this.store.read(pr.sourcePath);
    if (source === null) {
      throw new KnowledgeWriteError("Source 已不存在，请重新分析。", "missing_source");
    }
    const sourceHash = await sha256Text(source.content);
    if (
      source.mtime !== pr.sourceFingerprint.mtime ||
      sourceHash !== pr.sourceFingerprint.hash
    ) {
      throw new KnowledgeWriteError(
        "Source 在生成更新建议后已发生变化，请重新分析并生成 Knowledge PR。",
        "stale_source"
      );
    }

    const target = await this.store.read(pr.target.path);
    let beforeContent = "";
    let beforeHash: string | undefined;
    if (pr.target.operation === "update") {
      if (target === null || pr.targetFingerprint === undefined) {
        throw this.staleTargetError();
      }
      beforeContent = target.content;
      beforeHash = await sha256Text(beforeContent);
      if (
        target.mtime !== pr.targetFingerprint.mtime ||
        beforeHash !== pr.targetFingerprint.hash
      ) {
        throw this.staleTargetError();
      }
    } else if (target !== null) {
      throw new KnowledgeWriteError(
        "目标 Wiki 已存在，不能覆盖。请重新生成并按 Update Existing 审核。",
        "create_collision"
      );
    }

    this.validateForDecision(
      pr,
      analysisEntry,
      sourceHash,
      beforeContent,
      target?.mtime,
      beforeHash,
      verifications
    );
    const afterContent = pr.target.operation === "create"
      ? pr.changes[0]?.after ?? ""
      : applyKnowledgeChanges(beforeContent, pr.changes);
    const expectedAfterHash = await sha256Text(afterContent);
    try {
      if (pr.target.operation === "create") {
        await this.store.create(pr.target.path, afterContent);
      } else {
        await this.store.modify(pr.target.path, afterContent);
      }
    } catch (error: unknown) {
      throw new KnowledgeWriteError(
        "写入测试 Wiki 失败，未完成 Knowledge PR。",
        "write_failed",
        error
      );
    }
    const readBack = await this.store.read(pr.target.path);
    if (
      readBack === null ||
      readBack.content !== afterContent ||
      await sha256Text(readBack.content) !== expectedAfterHash
    ) {
      throw new KnowledgeWriteError(
        "写入后校验失败，请立即检查测试 Wiki。",
        "write_verification_failed"
      );
    }

    const decidedAt = new Date().toISOString();
    const acceptedPR: KnowledgePR = { ...pr, status: "accepted" };
    let historyPath: string;
    try {
      historyPath = await this.historyService.write(this.createHistoryRecord(
        acceptedPR,
        "accepted",
        decidedAt,
        beforeHash,
        expectedAfterHash
      ));
      await this.cacheService.set(acceptedPR);
    } catch (error: unknown) {
      const rolledBack = await this.rollbackTarget(pr, beforeContent, beforeHash);
      throw new KnowledgeWriteError(
        rolledBack
          ? "无法记录 Knowledge PR History，测试 Wiki 写入已自动回滚。"
          : "Wiki 已写入但 History 记录失败，且自动回滚未成功，请立即检查测试 Wiki。",
        rolledBack ? "decision_persistence_failed_rolled_back" : "rollback_failed",
        error
      );
    }
    let claimStoreUpdated: boolean | undefined;
    let claimStoreWarning: string | undefined;
    if (this.acceptedWikiIndexer !== undefined) {
      try {
        await this.acceptedWikiIndexer.reindexWiki(pr.target.path);
        claimStoreUpdated = true;
      } catch (error: unknown) {
        console.error("Knowledge Curator could not re-index the accepted Wiki.", error);
        claimStoreUpdated = false;
        claimStoreWarning = "Wiki 已安全写入，但 Claim Store 更新失败，请在设置中重试失败文件。";
      }
    }
    return {
      pr: acceptedPR,
      historyPath,
      beforeHash,
      afterHash: expectedAfterHash,
      claimStoreUpdated,
      claimStoreWarning
    };
  }

  async reject(pr: KnowledgePR): Promise<KnowledgeDecisionResult> {
    this.assertDraft(pr);
    this.assertWritableTarget(pr.target.path);
    const rejectedPR: KnowledgePR = { ...pr, status: "rejected" };
    const decidedAt = new Date().toISOString();
    const historyPath = await this.historyService.write(this.createHistoryRecord(
      rejectedPR,
      "rejected",
      decidedAt,
      pr.targetFingerprint?.hash,
      pr.targetFingerprint?.hash
    ));
    await this.cacheService.set(rejectedPR);
    return {
      pr: rejectedPR,
      historyPath,
      beforeHash: pr.targetFingerprint?.hash,
      afterHash: pr.targetFingerprint?.hash
    };
  }

  async acceptMaintenance(
    pr: KnowledgePR,
    verification: FreshnessVerificationResult
  ): Promise<KnowledgeDecisionResult> {
    this.assertTestMode();
    this.assertDraft(pr);
    this.assertWritableTarget(pr.target.path);
    const target = await this.store.read(pr.target.path);
    if (target === null || pr.targetFingerprint === undefined || pr.maintenanceContext === undefined) {
      throw this.staleTargetError();
    }
    const beforeContent = target.content;
    const beforeHash = await sha256Text(beforeContent);
    if (target.mtime !== pr.targetFingerprint.mtime || beforeHash !== pr.targetFingerprint.hash) {
      throw this.staleTargetError();
    }
    validateMaintenancePR(pr, {
      claimId: pr.maintenanceContext.claimId,
      claimFingerprint: pr.maintenanceContext.claimFingerprint,
      targetPath: pr.target.path,
      targetMtime: target.mtime,
      targetHash: beforeHash,
      targetContent: beforeContent,
      verification,
      expectedStatus: "draft"
    });
    const afterContent = applyKnowledgeChanges(beforeContent, pr.changes);
    const expectedAfterHash = await sha256Text(afterContent);
    try {
      await this.store.modify(pr.target.path, afterContent);
    } catch (error: unknown) {
      throw new KnowledgeWriteError("写入测试 Wiki 失败，未完成 Maintenance PR。", "write_failed", error);
    }
    const readBack = await this.store.read(pr.target.path);
    if (readBack === null || readBack.content !== afterContent || await sha256Text(readBack.content) !== expectedAfterHash) {
      throw new KnowledgeWriteError("写入后校验失败，请立即检查测试 Wiki。", "write_verification_failed");
    }
    const acceptedPR: KnowledgePR = { ...pr, status: "accepted" };
    let historyPath: string;
    try {
      historyPath = await this.historyService.write(this.createHistoryRecord(acceptedPR, "accepted", new Date().toISOString(), beforeHash, expectedAfterHash));
      await this.cacheService.set(acceptedPR);
    } catch (error: unknown) {
      const rolledBack = await this.rollbackTarget(pr, beforeContent, beforeHash);
      throw new KnowledgeWriteError(
        rolledBack ? "无法记录 Maintenance History，测试 Wiki 写入已自动回滚。" : "Wiki 已写入但 History 失败且回滚未成功，请立即检查测试 Wiki。",
        rolledBack ? "decision_persistence_failed_rolled_back" : "rollback_failed",
        error
      );
    }
    let claimStoreUpdated: boolean | undefined;
    let claimStoreWarning: string | undefined;
    if (this.acceptedWikiIndexer !== undefined) {
      try { await this.acceptedWikiIndexer.reindexWiki(pr.target.path); claimStoreUpdated = true; }
      catch (error: unknown) {
        console.error("Knowledge Curator could not re-index the maintenance target Wiki.", error);
        claimStoreUpdated = false;
        claimStoreWarning = "Wiki 已安全写入，但 Claim Store 更新失败，请重试索引。";
      }
    }
    return { pr: acceptedPR, historyPath, beforeHash, afterHash: expectedAfterHash, claimStoreUpdated, claimStoreWarning };
  }

  private assertTestMode(): void {
    if (this.getMode() !== "test" && this.getMode() !== "normal") {
      throw new KnowledgeWriteError(
        "正式知识库写入尚未开放。请切换到测试模式后，仅对隔离测试 Wiki 执行接受操作。",
        "production_preview_read_only"
      );
    }
  }

  private validateForDecision(
    pr: KnowledgePR,
    analysisEntry: CachedSourceAnalysis,
    sourceHash: string,
    targetContent: string,
    targetMtime?: number,
    targetHash?: string,
    verifications: CachedConflictVerification[] = []
  ): void {
    const analysis = analysisEntry.analysis;
    validateKnowledgePR(pr, {
      writableWikiRoot: this.writableWikiRoot(),
      sourcePath: analysisEntry.sourcePath,
      targetPath: pr.target.path,
      targetOperation: pr.target.operation,
      sourceMtime: analysisEntry.sourceModified,
      sourceHash,
      targetMtime,
      targetHash,
      targetContent,
      rawRecommendation: analysis.rawRecommendation,
      allowedSourceClaims: new Set([
        ...analysis.newClaims.map((claim) => claim.statement),
        ...analysis.conflicts.flatMap((conflict) => [
          conflict.newClaim,
          conflict.existingClaim
        ])
      ]),
      allowedEvidencePaths: new Set([
        analysisEntry.sourcePath,
        ...analysisEntry.context.candidatePaths
      ]),
      allowedExternalEvidence: new Map(
        verifications.flatMap((entry) => entry.result.evidence)
          .map((evidence) => [evidence.url, evidence])
      ),
      conflictPolicies: analysis.conflicts.map((conflict) => {
        const verified = verifications.find((entry) =>
          entry.existingClaim === conflict.existingClaim &&
          entry.newClaim === conflict.newClaim
        );
        return {
          existingClaim: conflict.existingClaim,
          newClaim: conflict.newClaim,
          resolution: verified?.result.resolution,
          evidenceUrls: new Set(
            verified?.result.evidence.map((evidence) => evidence.url) ?? []
          )
        };
      }),
      expectedStatus: "draft",
      claimPolicies: analysis.claimAnalysis?.comparisons.map((comparison) => ({
        candidateStatement: comparison.candidateStatement,
        relation: comparison.relation
      }))
    });
  }

  private createHistoryRecord(
    pr: KnowledgePR,
    decision: "accepted" | "rejected",
    decidedAt: string,
    beforeHash?: string,
    afterHash?: string
  ): KnowledgePRHistoryRecord {
    return {
      prId: pr.id,
      sourcePath: pr.sourcePath,
      targetPath: pr.target.path,
      decision,
      operation: pr.target.operation,
      beforeHash,
      afterHash,
      changes: pr.changes,
      claimRelations: pr.claimRelations,
      origin: pr.origin ?? "source_ingestion",
      claimId: pr.maintenanceContext?.claimId,
      verificationId: pr.maintenanceContext?.verificationId,
      freshnessResolution: pr.maintenanceContext?.freshnessResolution,
      createdAt: pr.createdAt,
      decidedAt
    };
  }

  private assertDraft(pr: KnowledgePR): void {
    if (pr.status !== "draft") {
      throw new KnowledgeWriteError(
        "该 Knowledge PR 已经完成审核，不能重复操作。",
        "already_decided"
      );
    }
  }

  private assertWritableTarget(path: string): void {
    if (!isInsideWritableWikiScope(path, this.writableWikiRoot())) {
      throw new KnowledgeWriteError(
        "目标路径不在 Phase 3 允许的测试 Wiki 写入范围内。",
        "write_scope_violation"
      );
    }
  }

  private writableWikiRoot(): string | undefined {
    if (this.getMode() !== "normal") return undefined;
    if (this.getWritableWikiRoot === undefined) {
      throw new KnowledgeWriteError("请先配置独立的 Wiki 目录。", "write_scope_violation");
    }
    return this.getWritableWikiRoot();
  }

  private staleTargetError(): KnowledgeWriteError {
    return new KnowledgeWriteError(
      "目标 Wiki 在生成更新建议后已发生变化，请重新生成 Knowledge PR。",
      "stale_target"
    );
  }

  private async rollbackTarget(
    pr: KnowledgePR,
    beforeContent: string,
    beforeHash?: string
  ): Promise<boolean> {
    try {
      if (pr.target.operation === "create") {
        await this.store.delete(pr.target.path);
        return await this.store.read(pr.target.path) === null;
      }
      if (beforeHash === undefined) {
        return false;
      }
      await this.store.modify(pr.target.path, beforeContent);
      const restored = await this.store.read(pr.target.path);
      return restored !== null && await sha256Text(restored.content) === beforeHash;
    } catch (rollbackError: unknown) {
      console.error("Knowledge Curator could not roll back a failed Knowledge PR decision.", rollbackError);
      return false;
    }
  }
}

export function applyKnowledgeChanges(
  content: string,
  changes: KnowledgeChange[]
): string {
  const replacements = changes.map((change) => {
    if (change.before === undefined || change.before.length === 0) {
      throw new KnowledgeWriteError(
        "目标内容已发生变化，当前 Knowledge PR 已失效，请重新生成。",
        "before_not_found"
      );
    }
    const firstIndex = content.indexOf(change.before);
    if (firstIndex < 0) {
      throw new KnowledgeWriteError(
        "目标内容已发生变化，当前 Knowledge PR 已失效，请重新生成。",
        "before_not_found"
      );
    }
    if (content.indexOf(change.before, firstIndex + change.before.length) >= 0) {
      throw new KnowledgeWriteError(
        "目标内容无法唯一定位，请重新生成更新建议。",
        "before_duplicate"
      );
    }
    return {
      start: firstIndex,
      end: firstIndex + change.before.length,
      after: change.after
    };
  }).sort((left, right) => right.start - left.start);

  for (let index = 1; index < replacements.length; index += 1) {
    const previous = replacements[index - 1];
    const current = replacements[index];
    if (previous !== undefined && current !== undefined && current.end > previous.start) {
      throw new KnowledgeWriteError(
        "多个修改范围发生重叠，请重新生成更新建议。",
        "overlapping_changes"
      );
    }
  }

  let output = content;
  for (const replacement of replacements) {
    output = `${output.slice(0, replacement.start)}${replacement.after}${output.slice(replacement.end)}`;
  }
  return output;
}
