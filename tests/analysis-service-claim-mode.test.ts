import test from "node:test";
import assert from "node:assert/strict";
import type { TFile } from "obsidian";
import type { KnowledgeCuratorSettings } from "../src/types/settings";
import type { CandidateClaim, ClaimRecord } from "../src/types/claim";
import { DEFAULT_SETTINGS } from "../src/types/settings";
import { VALID_ANALYSIS } from "./test-fixture";
import {
  AnalysisService,
  ClaimAnalysisUnavailableError
} from "../src/services/analysis-service";
import type { VaultService } from "../src/services/vault-service";
import type { RetrievalService } from "../src/services/retrieval-service";
import type { LlmService } from "../src/services/llm-service";
import type { ClaimExtractionService } from "../src/services/claim-extraction-service";
import type { ClaimRetrievalService } from "../src/services/claim-retrieval-service";
import type { ClaimComparisonService } from "../src/services/claim-comparison-service";
import type { ClaimStoreService } from "../src/services/claim-store-service";
import { normalizeClaim } from "../src/services/claim-identity";

const SOURCE = { path: "KnowledgeCuratorPhase1Test/inbox/Test.md" } as TFile;

function existing(): ClaimRecord {
  return {
    id: "claim-existing",
    statement: "Long-term memory persists across sessions.",
    normalizedStatement: normalizeClaim("Long-term memory persists across sessions."),
    type: "fact",
    status: "active",
    confidence: 0.9,
    provenance: [{
      filePath: "KnowledgeCuratorPhase1Test/wiki/Memory.md",
      fileHash: "wiki-hash",
      sourceKind: "wiki",
      accepted: true
    }],
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z"
  };
}

function candidate(): CandidateClaim {
  return {
    id: "candidate-existing",
    statement: "Agent long-term memory persists across sessions.",
    normalizedStatement: normalizeClaim("Agent long-term memory persists across sessions."),
    type: "fact",
    confidence: 0.9
  };
}

function createService(mode: "legacy" | "claim", hasClaims: boolean) {
  let llmCalls = 0;
  let extractionCalls = 0;
  let comparisonCalls = 0;
  const known = existing();
  const settings: KnowledgeCuratorSettings = {
    ...DEFAULT_SETTINGS,
    claimComparisonMode: mode,
    claimRetrievalTopK: 5
  };
  const vault = {
    isInInboxScope: () => true,
    readMarkdown: async () => "# Test\n\nAgent long-term memory persists across sessions.",
    getDisplayTitle: () => "Test",
    getConfiguredRetrievalScope: () => ({
      inboxFolder: "KnowledgeCuratorPhase1Test/inbox",
      wikiFolder: "KnowledgeCuratorPhase1Test/wiki",
      rawFolders: []
    })
  } as unknown as VaultService;
  const retrieval = {
    findRelatedNotes: async () => []
  } as unknown as RetrievalService;
  const llm = {
    analyzeSource: async () => {
      llmCalls += 1;
      return VALID_ANALYSIS;
    }
  } as unknown as LlmService;
  const extraction = {
    extractCandidateClaims: async () => {
      extractionCalls += 1;
      return [candidate()];
    }
  } as unknown as ClaimExtractionService;
  const claimRetrieval = {
    retrieve: () => [{ claimId: known.id, score: 0.9, reasons: ["semantic match"] }]
  } as unknown as ClaimRetrievalService;
  const comparison = {
    compare: async () => {
      comparisonCalls += 1;
      return [{
        candidateClaimId: candidate().id,
        candidateStatement: candidate().statement,
        relation: "reinforce" as const,
        existingClaimId: known.id,
        existingStatement: known.statement,
        reasoning: "same knowledge",
        confidence: 0.9
      }];
    }
  } as unknown as ClaimComparisonService;
  const store = {
    getClaims: () => hasClaims ? [known] : [],
    getRevision: () => hasClaims ? "Memory.md:wiki-hash" : "not-built"
  } as unknown as ClaimStoreService;
  return {
    service: new AnalysisService(
      vault,
      retrieval,
      llm,
      extraction,
      claimRetrieval,
      comparison,
      store,
      () => settings
    ),
    counts: () => ({ llmCalls, extractionCalls, comparisonCalls })
  };
}

test("Legacy Document Mode remains available without a Claim Store", async () => {
  const harness = createService("legacy", false);
  const result = await harness.service.analyzeSource(SOURCE);
  assert.equal(result.analysis.analysisMode, "legacy");
  assert.equal(result.analysis.claimAnalysis, undefined);
  assert.deepEqual(harness.counts(), { llmCalls: 1, extractionCalls: 0, comparisonCalls: 0 });
  assert.deepEqual(result.context.claimContext, {
    mode: "legacy",
    topK: 0,
    claimStoreRevision: "legacy",
    retrievalVersion: "legacy-document",
    comparisonVersion: "legacy-document"
  });
});

test("Claim Mode refuses analysis before any provider call when store is unavailable", async () => {
  const harness = createService("claim", false);
  await assert.rejects(
    harness.service.analyzeSource(SOURCE),
    ClaimAnalysisUnavailableError
  );
  assert.deepEqual(harness.counts(), { llmCalls: 0, extractionCalls: 0, comparisonCalls: 0 });
});

test("Claim Mode derives newClaims from relations and performs no Markdown writes", async () => {
  const harness = createService("claim", true);
  const result = await harness.service.analyzeSource(SOURCE);
  assert.equal(result.analysis.analysisMode, "claim");
  assert.equal(result.analysis.claimAnalysis?.comparisons[0]?.relation, "reinforce");
  assert.deepEqual(result.analysis.newClaims, []);
  assert.deepEqual(harness.counts(), { llmCalls: 1, extractionCalls: 1, comparisonCalls: 1 });
  assert.equal(result.context.claimContext.claimStoreRevision, "Memory.md:wiki-hash");
  assert.equal(result.context.claimContext.retrievalVersion, "claim-retrieval-v2");
  assert.equal(result.context.claimContext.comparisonVersion, "claim-comparison-v2");
});

test("product workflow explicitly permits first article in an empty knowledge base without switching to legacy backend", async () => {
  const harness = createService("claim", false);
  const result = await harness.service.analyzeSource(SOURCE, { allowEmptyStore: true });
  assert.equal(result.analysis.analysisMode, "claim");
  assert.equal(harness.counts().extractionCalls, 1);
});

test("disabling extraction avoids extraction and comparison calls while retaining the shared source analysis", async () => {
  const harness = createService("claim", false);
  await harness.service.analyzeSource(SOURCE, { allowEmptyStore: true, extractKnowledge: false });
  assert.deepEqual(harness.counts(), { llmCalls: 1, extractionCalls: 0, comparisonCalls: 0 });
});
