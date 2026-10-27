import type { TFile } from "obsidian";
import type { CachedSourceAnalysis, RetrievalCandidate } from "../types/analysis";
import type {
  KnowledgePR,
  KnowledgePRProposal
} from "../types/knowledge-pr";
import type { SourceAnalysis } from "../types/source-analysis";
import type {
  CachedConflictVerification,
  ConflictResolution,
  ExternalEvidence
} from "../types/verification";
import { sha256Text } from "./content-hash";
import { KnowledgePRCacheService } from "./knowledge-pr-cache-service";
import {
  KnowledgePRValidationError,
  parseKnowledgePRProposal,
  validateKnowledgePR
} from "./knowledge-pr-validator";
import { LlmService, LlmServiceError } from "./llm-service";
import type { LlmMessage } from "./llm-service";
import { VaultService } from "./vault-service";
import {
  buildWritableWikiPath,
  isInsideWritableWikiScope
} from "./write-scope-guard";

const MAX_PR_SOURCE_CHARS = 24_000;
const MAX_PR_SUPPORTING_CHARS = 6_000;

export class KnowledgePRServiceError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
    public readonly originalError?: unknown
  ) {
    super(userMessage);
    this.name = "KnowledgePRServiceError";
  }
}

export interface KnowledgePRGenerationResult {
  pr: KnowledgePR;
  targetContent: string;
}

export class KnowledgePRService {
  constructor(
    private readonly vaultService: VaultService,
    private readonly llmService: LlmService,
    private readonly cacheService: KnowledgePRCacheService,
    private readonly getWritableWikiRoot?: () => string
  ) {}

  async generate(
    sourceFile: TFile,
    analysisEntry: CachedSourceAnalysis,
    verifications: CachedConflictVerification[] = []
  ): Promise<KnowledgePRGenerationResult> {
    if (analysisEntry.analysis.recommendation === "reject") {
      throw new KnowledgePRServiceError(
        "当前建议为不摄入，不生成 Knowledge PR。",
        "recommendation_reject"
      );
    }
    if (
      sourceFile.path !== analysisEntry.sourcePath ||
      sourceFile.stat.mtime !== analysisEntry.sourceModified
    ) {
      throw new KnowledgePRServiceError(
        "Source 已发生变化，请先重新分析文章。",
        "stale_source_analysis"
      );
    }

    const sourceContent = await this.vaultService.readMarkdown(sourceFile);
    const sourceHash = await sha256Text(sourceContent);
    const target = this.selectTarget(analysisEntry.analysis);
    const targetFile = this.vaultService.getMarkdownFile(target.path);
    const operation = targetFile === null ? "create" as const : "update" as const;
    if (target.operation !== operation) {
      target.operation = operation;
    }
    const targetContent = targetFile === null
      ? ""
      : await this.vaultService.readMarkdown(targetFile);
    const targetHash = targetFile === null ? undefined : await sha256Text(targetContent);
    const supportingCandidates = await this.loadSupportingCandidates(
      analysisEntry.context.candidatePaths
    );
    const allowedSourceClaims = this.getAllowedSourceClaims(analysisEntry.analysis);
    const allowedEvidencePaths = new Set([
      sourceFile.path,
      ...supportingCandidates.map((candidate) => candidate.path)
    ]);
    const allowedExternalEvidence = this.getAllowedExternalEvidence(verifications);
    const conflictPolicies = this.getConflictPolicies(
      analysisEntry.analysis,
      verifications
    );
    const messages = this.buildMessages({
      sourceFile,
      sourceContent,
      analysis: analysisEntry.analysis,
      target,
      targetContent,
      supportingCandidates,
      allowedSourceClaims,
      verifications
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptMessages: LlmMessage[] = attempt === 0
        ? messages
        : [
            ...messages,
            {
              role: "user",
              content: "上一次 Knowledge PR 不符合要求。请只返回完整、合法、非空的 JSON 对象。当前是 Update 时，每一条 change（包括 add/refine/replace）都必须提供非空 reason 和 before：before 必须逐字复制 Target Wiki 中只出现一次的短文本；after 必须包含该锚点经过最小修改后的完整替换文本。每条 change 的 sourceClaims 只能属于同一种 Claim Relation：ADD 只能对应 add，REFINE 只能对应 refine，REINFORCE 不得进入正文变更；不要把不同 Relation 的 Claim 合并到同一 change。sourceClaims 和 evidence path 必须从给定列表中选择。不要解释，不要 Markdown。"
            }
          ];
      try {
        const response = await this.llmService.requestJsonObject(
          attemptMessages,
          attempt
        );
        const proposal = parseKnowledgePRProposal(response);
        const pr = this.buildValidatedPR({
          proposal,
          sourceFile,
          sourceHash,
          analysis: analysisEntry.analysis,
          target,
          targetFile,
          targetContent,
          targetHash,
          allowedSourceClaims,
          allowedEvidencePaths,
          allowedExternalEvidence,
          conflictPolicies
        });
        await this.cacheService.set(pr);
        return { pr, targetContent };
      } catch (error: unknown) {
        lastError = error;
        if (
          attempt === 0 &&
          (error instanceof KnowledgePRValidationError ||
            (error instanceof LlmServiceError && error.code === "empty_provider_response"))
        ) {
          continue;
        }
        if (error instanceof LlmServiceError && error.code !== "empty_provider_response") {
          throw error;
        }
      }
    }

    throw new KnowledgePRServiceError(
      "生成知识更新建议失败：模型返回的结果不符合要求。",
      "invalid_pr_response",
      lastError
    );
  }

  private selectTarget(analysis: SourceAnalysis): KnowledgePR["target"] {
    const existingTargets = [...analysis.relatedNotes]
      .sort((left, right) => right.relevance - left.relevance)
      .filter((note) => isInsideWritableWikiScope(note.path, this.getWritableWikiRoot?.()))
      .map((note) => ({ note, file: this.vaultService.getMarkdownFile(note.path) }))
      .filter((entry) => entry.file !== null);
    const preferred = existingTargets[0];
    if (preferred !== undefined && preferred.file !== null) {
      return {
        path: preferred.file.path,
        title: this.vaultService.getDisplayTitle(preferred.file),
        operation: "update"
      };
    }

    const path = buildWritableWikiPath(analysis.topic, this.getWritableWikiRoot?.());
    const existing = this.vaultService.getMarkdownFile(path);
    return existing === null
      ? { path, title: analysis.topic, operation: "create" }
      : {
          path: existing.path,
          title: this.vaultService.getDisplayTitle(existing),
          operation: "update"
        };
  }

  private async loadSupportingCandidates(paths: string[]): Promise<RetrievalCandidate[]> {
    const candidates: RetrievalCandidate[] = [];
    for (const path of paths) {
      if (!this.vaultService.isInKnowledgeScope(path)) {
        continue;
      }
      const file = this.vaultService.getMarkdownFile(path);
      if (file === null) {
        continue;
      }
      const content = await this.vaultService.readMarkdown(file);
      candidates.push({
        path: file.path,
        title: this.vaultService.getDisplayTitle(file),
        kind: this.vaultService.isInWikiScope(file.path) ? "wiki" : "raw",
        relevance: 0,
        reason: "Phase 2 candidate",
        content: content.slice(0, MAX_PR_SUPPORTING_CHARS),
        truncated: content.length > MAX_PR_SUPPORTING_CHARS
      });
    }
    return candidates;
  }

  private getAllowedSourceClaims(analysis: SourceAnalysis): Set<string> {
    return new Set([
      ...analysis.newClaims.map((claim) => claim.statement),
      ...analysis.conflicts.flatMap((conflict) => [
        conflict.newClaim,
        conflict.existingClaim
      ])
    ]);
  }

  private buildValidatedPR(input: {
    proposal: KnowledgePRProposal;
    sourceFile: TFile;
    sourceHash: string;
    analysis: SourceAnalysis;
    target: KnowledgePR["target"];
    targetFile: TFile | null;
    targetContent: string;
    targetHash?: string;
    allowedSourceClaims: Set<string>;
    allowedEvidencePaths: Set<string>;
    allowedExternalEvidence: Map<string, ExternalEvidence>;
    conflictPolicies: Array<{
      existingClaim: string;
      newClaim: string;
      resolution?: ConflictResolution;
      evidenceUrls: Set<string>;
    }>;
  }): KnowledgePR {
    const createdAt = new Date().toISOString();
    const pr: KnowledgePR = {
      id: createKnowledgePRId(createdAt),
      sourcePath: input.sourceFile.path,
      target: input.target,
      summary: input.proposal.summary,
      changes: input.proposal.changes,
      evidence: input.proposal.evidence,
      rawRecommendation: input.analysis.rawRecommendation,
      confidence: input.proposal.confidence,
      status: "draft",
      claimRelations: input.analysis.claimAnalysis?.comparisons,
      sourceFingerprint: {
        mtime: input.sourceFile.stat.mtime,
        hash: input.sourceHash
      },
      targetFingerprint: input.targetFile === null || input.targetHash === undefined
        ? undefined
        : {
            mtime: input.targetFile.stat.mtime,
            hash: input.targetHash
          },
      createdAt
    };
    return validateKnowledgePR(pr, {
      writableWikiRoot: this.getWritableWikiRoot?.(),
      sourcePath: input.sourceFile.path,
      targetPath: input.target.path,
      targetOperation: input.target.operation,
      sourceMtime: input.sourceFile.stat.mtime,
      sourceHash: input.sourceHash,
      targetMtime: input.targetFile?.stat.mtime,
      targetHash: input.targetHash,
      targetContent: input.targetContent,
      rawRecommendation: input.analysis.rawRecommendation,
      allowedSourceClaims: input.allowedSourceClaims,
      allowedEvidencePaths: input.allowedEvidencePaths,
      allowedExternalEvidence: input.allowedExternalEvidence,
      conflictPolicies: input.conflictPolicies,
      claimPolicies: input.analysis.claimAnalysis?.comparisons.map((comparison) => ({
        candidateStatement: comparison.candidateStatement,
        relation: comparison.relation
      })),
      expectedStatus: "draft"
    });
  }

  private buildMessages(input: {
    sourceFile: TFile;
    sourceContent: string;
    analysis: SourceAnalysis;
    target: KnowledgePR["target"];
    targetContent: string;
    supportingCandidates: RetrievalCandidate[];
    allowedSourceClaims: Set<string>;
    verifications: CachedConflictVerification[];
  }): LlmMessage[] {
    const supporting = input.supportingCandidates.length === 0
      ? "(none)"
      : input.supportingCandidates.map((candidate) => [
          `--- ${candidate.kind.toUpperCase()} ---`,
          `Path: ${candidate.path}`,
          `Title: ${candidate.title}`,
          candidate.content
        ].join("\n")).join("\n\n");
    const userPrompt = [
      "生成一个 Knowledge PR proposal。你的任务不是重写 Wiki，而是基于新增知识，对现有 Wiki 做最小、必要、可追溯的修改。",
      "只输出 JSON，不要解释，不要 Markdown。",
      "规则：只修改与 newClaims/conflicts 相关内容；不重写无关章节；不降低信息密度；不重复已有知识；不删除仍有效知识；保留适用条件与边界；使用自己的话；不要长段复制 Source；优先 add/refine，谨慎 replace，禁止 remove；修改数量尽量少。",
      "Claim Relation 规则：ADD 只能生成 add；REFINE 只能生成 refine，且只能补充该 Claim coverage.uncoveredAspects 中列出的未覆盖信息，不得重写 coveredAspects；REINFORCE 不得生成正文变更，禁止把同一知识换句话写入 Wiki；CHALLENGE 必须先遵守冲突验证规则；SUPERSEDE 只有 Phase 4 验证后才允许 replace。每条 change 的 sourceClaims 只能属于同一种 Claim Relation，禁止把 ADD、REFINE、REINFORCE 混在同一 change。每条 change.reason 必须非空并解释这项最小修改的必要性。",
      "冲突治理：未验证或 unresolved 的冲突禁止 replace，只能标记争议或建议人工审核；refine 必须保留两种说法并补充分类维度、时间、场景、数据或方法边界，禁止 replace；只有 supersede 才允许 replace，而且必须引用对应的 external evidence，并明确旧知识为何过时或错误。",
      "Update 操作中每条 change（包括 add/refine/replace）都必须提供非空 before。before 必须逐字复制 Target Wiki 中唯一出现的一小段；after 是替换该小段后的最小完整文本。若要在某标题或段落后新增内容，就把该唯一标题或段落作为 before，并在 after 中先保留它、再附加新增内容。Create 操作只能输出一个 add change 且不包含 before。",
      "sourceClaims 只能逐字选择 Allowed Source Claims。Evidence sourcePath 只能逐字选择 Allowed Evidence Paths。",
      "",
      "Required JSON shape:",
      PR_PROPOSAL_SCHEMA,
      "",
      "Concrete Update JSON example (example text only; before must be replaced with an exact unique excerpt from the actual Target Wiki):",
      PR_UPDATE_EXAMPLE,
      "",
      `Target operation: ${input.target.operation}`,
      `Target path: ${input.target.path}`,
      "Target Wiki current content:",
      input.targetContent.length === 0 ? "(new file)" : input.targetContent,
      "",
      `Current Source Path: ${input.sourceFile.path}`,
      "Current Source:",
      input.sourceContent.slice(0, MAX_PR_SOURCE_CHARS),
      "",
      "Phase 2 SourceAnalysis:",
      JSON.stringify(input.analysis),
      "",
      "Phase 4 Conflict Verification Results:",
      input.verifications.length === 0 ? "(none)" : JSON.stringify(
        input.verifications.map((entry) => entry.result)
      ),
      "",
      "Allowed Source Claims:",
      JSON.stringify(Array.from(input.allowedSourceClaims)),
      "Allowed Evidence Paths:",
      JSON.stringify([
        input.sourceFile.path,
        ...input.supportingCandidates.map((candidate) => candidate.path)
      ]),
      "Allowed External Evidence (use kind=external and exact values):",
      JSON.stringify(input.verifications.flatMap((entry) =>
        entry.result.evidence.map((evidence) => ({
          kind: "external",
          sourceTitle: evidence.title,
          url: evidence.url,
          sourceTier: evidence.sourceTier,
          supports: evidence.supports,
          conclusion: entry.result.conclusion,
          confidence: evidence.confidence,
          excerpt: evidence.excerpt
        }))
      )),
      "",
      "Relevant supporting Wiki / Raw:",
      supporting
    ].join("\n");
    return [
      {
        role: "system",
        content: "You generate reviewable Knowledge PR proposals for Obsidian. JSON output is required. 只输出一个完整、合法、非空的 JSON 对象。Never write files and never invent baseline text or evidence paths."
      },
      { role: "user", content: userPrompt }
    ];
  }

  private getAllowedExternalEvidence(
    verifications: CachedConflictVerification[]
  ): Map<string, ExternalEvidence> {
    const evidence = new Map<string, ExternalEvidence>();
    for (const entry of verifications) {
      for (const item of entry.result.evidence) {
        evidence.set(item.url, item);
      }
    }
    return evidence;
  }

  private getConflictPolicies(
    analysis: SourceAnalysis,
    verifications: CachedConflictVerification[]
  ): Array<{
    existingClaim: string;
    newClaim: string;
    resolution?: ConflictResolution;
    evidenceUrls: Set<string>;
  }> {
    return analysis.conflicts.map((conflict) => {
      const verified = verifications.find((entry) =>
        entry.existingClaim === conflict.existingClaim &&
        entry.newClaim === conflict.newClaim
      );
      return {
        existingClaim: conflict.existingClaim,
        newClaim: conflict.newClaim,
        resolution: verified?.result.resolution,
        evidenceUrls: new Set(
          verified?.result.evidence.map((item) => item.url) ?? []
        )
      };
    });
  }
}

function createKnowledgePRId(createdAt: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `kpr-${createdAt.replace(/[^0-9]/gu, "").slice(0, 17)}-${random}`;
}

const PR_PROPOSAL_SCHEMA = `{
  "summary": "string",
  "changes": [{
    "id": "change-1",
    "type": "add|refine|replace",
    "section": "optional heading string",
    "before": "exact unique Target Wiki text; omit only for create",
    "after": "minimal replacement or new-file content",
    "reason": "why this exact change is needed",
    "sourceClaims": ["exact string from Allowed Source Claims"],
    "confidence": 0.85
  }],
  "evidence": [{
    "kind": "internal",
    "sourcePath": "exact full path from Allowed Evidence Paths",
    "sourceTitle": "string",
    "claim": "optional string",
    "excerpt": "optional short excerpt"
  }, {
    "kind": "external",
    "sourceTitle": "exact title from Allowed External Evidence",
    "url": "exact URL from Allowed External Evidence",
    "sourceTier": 0,
    "supports": "existing|new|both|neither",
    "conclusion": "verification conclusion",
    "confidence": 0.9,
    "excerpt": "optional short excerpt"
  }],
  "confidence": 0.85
}`;

const PR_UPDATE_EXAMPLE = `{
  "summary": "补充一个可审核的知识增量",
  "changes": [{
    "id": "change-1",
    "type": "add",
    "section": "评测方法",
    "before": "## 评测方法",
    "after": "## 评测方法\\n\\n新增的最小知识段落。",
    "reason": "为现有章节补充一个新的方法边界",
    "sourceClaims": ["必须逐字使用 Allowed Source Claims 中的一项"],
    "confidence": 0.85
  }],
  "evidence": [{
    "sourcePath": "必须逐字使用 Allowed Evidence Paths 中的一项",
    "sourceTitle": "来源标题",
    "claim": "对应的简短主张"
  }],
  "confidence": 0.85
}`;
