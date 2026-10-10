import type { ClaimRecord } from "../types/claim";
import type { KnowledgePR, KnowledgePRProposal } from "../types/knowledge-pr";
import type { FreshnessVerificationResult } from "../types/maintenance";
import { sha256Text } from "./content-hash";
import type { KnowledgePRCacheService } from "./knowledge-pr-cache-service";
import { parseKnowledgePRProposal } from "./knowledge-pr-validator";
import { LlmService, LlmServiceError } from "./llm-service";
import type { LlmMessage } from "./llm-service";
import { MaintenancePRValidationError, validateMaintenanceProposal } from "./maintenance-pr-validator";
import type { VaultService } from "./vault-service";

export class MaintenancePRServiceError extends Error {
  constructor(public readonly userMessage: string, public readonly code: string, public readonly originalError?: unknown) {
    super(userMessage); this.name = "MaintenancePRServiceError";
  }
}

export class MaintenancePRService {
  constructor(
    private readonly vault: VaultService,
    private readonly llm: LlmService,
    private readonly cache: KnowledgePRCacheService
  ) {}

  async generate(claim: ClaimRecord, verification: FreshnessVerificationResult): Promise<KnowledgePR> {
    if (!["needs_refinement", "stale"].includes(verification.resolution)) {
      throw new MaintenancePRServiceError("当前验证结果不需要修改 Wiki。", "maintenance_pr_not_required");
    }
    const targetPath = claim.provenance.find((item) => item.sourceKind === "wiki")?.filePath;
    const targetFile = targetPath === undefined ? null : this.vault.getMarkdownFile(targetPath);
    if (targetFile === null || !this.vault.isInWikiScope(targetFile.path)) throw new MaintenancePRServiceError("找不到 Claim 对应的 Wiki 文件。", "missing_maintenance_target");
    const targetContent = await this.vault.readMarkdown(targetFile);
    const targetHash = await sha256Text(targetContent);
    const context = {
      claimId: claim.id,
      claimFingerprint: verification.claimFingerprint,
      targetPath: targetFile.path,
      targetMtime: targetFile.stat.mtime,
      targetHash,
      targetContent,
      verification,
      expectedStatus: "draft" as const
    };
    const messages = buildMessages(claim, verification, targetContent);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.llm.requestJsonObject(attempt === 0 ? messages : [...messages, {
          role: "user",
          content: "上一次 Maintenance PR 不合法。只返回 JSON。before 必须逐字复制 Target Wiki 中只出现一次的短文本；after 只做最小修改；stale 只能 replace，needs_refinement 只能 refine；必须引用 allowlist evidence。"
        }], attempt);
        const proposal = parseKnowledgePRProposal(response);
        validateMaintenanceProposal(proposal, context);
        const pr = buildPR(proposal, claim, verification, targetFile.path, targetFile.stat.mtime, targetHash);
        await this.cache.set(pr);
        return pr;
      } catch (error: unknown) {
        lastError = error;
        if (attempt === 0 && (error instanceof MaintenancePRValidationError || error instanceof LlmServiceError && error.code === "empty_provider_response")) continue;
        if (error instanceof LlmServiceError && error.code !== "empty_provider_response") throw error;
      }
    }
    throw new MaintenancePRServiceError("生成知识维护建议失败：模型返回结果不符合要求。", "invalid_maintenance_pr", lastError);
  }
}

function buildPR(proposal: KnowledgePRProposal, claim: ClaimRecord, verification: FreshnessVerificationResult, path: string, mtime: number, hash: string): KnowledgePR {
  const createdAt = new Date().toISOString();
  return {
    id: `mpr-${createdAt.replace(/[^0-9]/gu, "").slice(0, 17)}-${Math.random().toString(36).slice(2, 8)}`,
    sourcePath: path,
    target: { path, title: path.split("/").pop()?.replace(/\.md$/u, "") ?? path, operation: "update" },
    summary: proposal.summary,
    changes: proposal.changes,
    evidence: proposal.evidence,
    rawRecommendation: "extract_only",
    confidence: proposal.confidence,
    status: "draft",
    sourceFingerprint: { mtime, hash },
    targetFingerprint: { mtime, hash },
    createdAt,
    origin: "maintenance",
    maintenanceContext: {
      claimId: claim.id,
      claimFingerprint: verification.claimFingerprint,
      freshnessResolution: verification.resolution,
      verificationId: verification.id
    }
  };
}

function buildMessages(claim: ClaimRecord, verification: FreshnessVerificationResult, targetContent: string): LlmMessage[] {
  const expectedType = verification.resolution === "stale" ? "replace" : "refine";
  return [{ role: "system", content: "You create minimal reviewable Obsidian Maintenance PR proposals. JSON only. Never write files or invent evidence." }, {
    role: "user",
    content: [
      `Existing Claim: ${claim.statement}`,
      `Freshness Resolution: ${verification.resolution}`,
      `Expected change type: ${expectedType}`,
      `Conclusion: ${verification.conclusion}`,
      `Reasoning: ${verification.reasoning}`,
      "Authorized External Evidence:",
      JSON.stringify(verification.evidence.map((item) => ({ kind: "external", sourceTitle: item.title, url: item.url, sourceTier: item.sourceTier, supports: item.supports, conclusion: verification.conclusion, confidence: item.confidence, excerpt: item.excerpt }))),
      "Target Wiki:", targetContent,
      "Rules: make one minimal local replacement; never rewrite the whole Wiki. before must be an exact unique short excerpt from Target Wiki. sourceClaims must contain exactly the Existing Claim. Use only authorized external evidence.",
      `Required JSON: {"summary":"...","changes":[{"id":"change-1","type":"${expectedType}","before":"exact unique text","after":"minimal replacement","reason":"...","sourceClaims":[${JSON.stringify(claim.statement)}],"confidence":0.8}],"evidence":[{"kind":"external","sourceTitle":"exact","url":"exact","sourceTier":0,"supports":"existing|new|both|neither","conclusion":"...","confidence":0.9}],"confidence":0.8}`
    ].join("\n")
  }];
}
