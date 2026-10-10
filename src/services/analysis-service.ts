import type { TFile } from "obsidian";
import type {
  AnalysisContextMetadata,
  AnalysisResult,
  RetrievalCandidate
} from "../types/analysis";
import { LlmService } from "./llm-service";
import { RetrievalService } from "./retrieval-service";
import { VaultService } from "./vault-service";
import type { KnowledgeCuratorSettings } from "../types/settings";
import { ClaimExtractionService } from "./claim-extraction-service";
import {
  CLAIM_RETRIEVAL_VERSION,
  ClaimRetrievalService
} from "./claim-retrieval-service";
import {
  CLAIM_COMPARISON_VERSION,
  ClaimComparisonService
} from "./claim-comparison-service";
import { ClaimStoreService } from "./claim-store-service";
import { aggregateClaimAnalysis, countRelations } from "./claim-analysis-aggregator";

export const MAX_SOURCE_CHARS = 24_000;
export const MAX_TOTAL_CONTEXT_CHARS = 60_000;

export class ClaimAnalysisUnavailableError extends Error {
  readonly code = "claim_store_not_ready";
  readonly userMessage = "Claim Store 尚未建立或没有可用 Claim，请先在设置中建立 Claim Store，或切换到 Legacy Document Mode。";
  constructor() {
    super("Claim Store is not ready for claim mode analysis.");
    this.name = "ClaimAnalysisUnavailableError";
  }
}

export class AnalysisService {
  constructor(
    private readonly vaultService: VaultService,
    private readonly retrievalService: RetrievalService,
    private readonly llmService: LlmService,
    private readonly claimExtractionService: ClaimExtractionService,
    private readonly claimRetrievalService: ClaimRetrievalService,
    private readonly claimComparisonService: ClaimComparisonService,
    private readonly claimStoreService: ClaimStoreService,
    private readonly getSettings: () => KnowledgeCuratorSettings
  ) {}

  async analyzeSource(sourceFile: TFile): Promise<AnalysisResult> {
    if (!this.vaultService.isInInboxScope(sourceFile.path)) {
      throw new Error(
        `Knowledge Curator refused to analyze a source outside the configured Inbox: ${sourceFile.path}`
      );
    }
    const fullSourceContent = await this.vaultService.readMarkdown(sourceFile);
    const sourceTruncated = fullSourceContent.length > MAX_SOURCE_CHARS;
    const sourceContent = sourceTruncated
      ? fullSourceContent.slice(0, MAX_SOURCE_CHARS)
      : fullSourceContent;
    const retrievedCandidates = await this.retrievalService.findRelatedNotes(sourceFile);
    const limited = limitTotalContext(sourceContent, retrievedCandidates);
    const settings = this.getSettings();
    const context: AnalysisContextMetadata = {
      sourceTruncated,
      relatedNotesTruncated: limited.candidates.some((candidate) => candidate.truncated),
      totalContextTruncated: limited.totalContextTruncated,
      candidatePaths: limited.candidates.map((candidate) => candidate.path),
      retrievalScope: this.vaultService.getConfiguredRetrievalScope(),
      claimContext: {
        mode: settings.claimComparisonMode,
        topK: settings.claimComparisonMode === "claim" ? settings.claimRetrievalTopK : 0,
        claimStoreRevision: settings.claimComparisonMode === "claim"
          ? this.claimStoreService.getRevision()
          : "legacy",
        retrievalVersion: settings.claimComparisonMode === "claim"
          ? CLAIM_RETRIEVAL_VERSION
          : "legacy-document",
        comparisonVersion: settings.claimComparisonMode === "claim"
          ? CLAIM_COMPARISON_VERSION
          : "legacy-document"
      }
    };

    if (settings.claimComparisonMode === "claim" && this.claimStoreService.getClaims().length === 0) {
      throw new ClaimAnalysisUnavailableError();
    }
    const legacyAnalysis = await this.llmService.analyzeSource({
      sourcePath: sourceFile.path,
      sourceTitle: this.vaultService.getDisplayTitle(sourceFile),
      sourceContent,
      relatedCandidates: limited.candidates
    });

    if (settings.claimComparisonMode === "legacy") {
      return {
        analysis: { ...legacyAnalysis, analysisMode: "legacy" },
        context,
        candidates: limited.candidates
      };
    }
    const candidateClaims = await this.claimExtractionService.extractCandidateClaims({
      sourcePath: sourceFile.path,
      content: sourceContent
    });
    const candidatesWithMatches = candidateClaims.map((candidate) => ({
      candidate,
      matches: this.claimRetrievalService.retrieve(
        candidate,
        settings.claimRetrievalTopK,
        CLAIM_RETRIEVAL_VERSION
      )
    }));
    const comparisons = await this.claimComparisonService.compare(candidatesWithMatches);
    console.debug("[Knowledge Curator] claim comparison metrics", {
      sourcePath: sourceFile.path,
      ...this.claimComparisonService.getLastMetrics?.()
    });
    const claimsById = new Map(this.claimStoreService.getClaims().map((claim) => [claim.id, claim]));
    const analysis = aggregateClaimAnalysis({
      legacy: legacyAnalysis,
      candidateClaims,
      comparisons,
      getExistingClaim: (id) => claimsById.get(id)
    });
    const claimPaths = comparisons.flatMap((comparison) => {
      const claim = comparison.existingClaimId === undefined
        ? undefined
        : claimsById.get(comparison.existingClaimId);
      return claim?.provenance.map((item) => item.filePath) ?? [];
    });
    context.candidatePaths = [...new Set([...context.candidatePaths, ...claimPaths])];
    console.debug("[Knowledge Curator] claim comparison A/B", {
      sourcePath: sourceFile.path,
      legacyNewClaims: legacyAnalysis.newClaims.length,
      legacyKnowledgeGain: legacyAnalysis.knowledgeGain,
      claimRelations: countRelations(comparisons),
      claimKnowledgeGain: analysis.knowledgeGain
    });

    return {
      analysis,
      context,
      candidates: limited.candidates
    };
  }
}

export function limitTotalContext(
  sourceContent: string,
  candidates: RetrievalCandidate[]
): { candidates: RetrievalCandidate[]; totalContextTruncated: boolean } {
  let remaining = Math.max(0, MAX_TOTAL_CONTEXT_CHARS - sourceContent.length);
  let totalContextTruncated = false;
  const limitedCandidates: RetrievalCandidate[] = [];

  for (const candidate of candidates) {
    if (remaining <= 0) {
      totalContextTruncated = true;
      break;
    }
    const content = candidate.content.length > remaining
      ? candidate.content.slice(0, remaining)
      : candidate.content;
    const wasTruncated = candidate.truncated || content.length < candidate.content.length;
    limitedCandidates.push({
      ...candidate,
      content,
      truncated: wasTruncated
    });
    if (content.length < candidate.content.length) {
      totalContextTruncated = true;
    }
    remaining -= content.length;
  }

  if (limitedCandidates.length < candidates.length) {
    totalContextTruncated = true;
  }
  return {
    candidates: limitedCandidates,
    totalContextTruncated
  };
}
