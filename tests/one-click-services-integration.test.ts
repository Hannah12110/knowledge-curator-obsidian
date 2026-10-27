import test from "node:test";
import assert from "node:assert/strict";
import { OneClickAnalysisOrchestrator } from "../src/product/one-click-analysis-orchestrator";
import { LlmService } from "../src/services/llm-service";
import { AnalysisService } from "../src/services/analysis-service";
import { ClaimExtractionService } from "../src/services/claim-extraction-service";
import { ClaimRetrievalService } from "../src/services/claim-retrieval-service";
import { ClaimComparisonService } from "../src/services/claim-comparison-service";
import { ClaimStoreService } from "../src/services/claim-store-service";
import { ClaimStoreRepository } from "../src/services/claim-store-repository";
import { ClaimGraphRepository } from "../src/services/claim-graph-repository";
import { ClaimGraphService } from "../src/services/claim-graph-service";
import { ClaimGraphCandidateService } from "../src/services/claim-graph-candidate-service";
import { ClaimGraphRelationService } from "../src/services/claim-graph-relation-service";
import { ClaimEvolutionService } from "../src/services/claim-evolution-service";
import { KnowledgeCompressionService } from "../src/services/knowledge-compression-service";
import { KnowledgePRService } from "../src/services/knowledge-pr-service";
import { KnowledgeWriteService } from "../src/services/knowledge-write-service";
import { KnowledgePRCacheService } from "../src/services/knowledge-pr-cache-service";
import { HistoryService } from "../src/services/history-service";
import { DEFAULT_SETTINGS } from "../src/types/settings";
import { generateCandidateClaimId } from "../src/services/claim-identity";
import { VALID_ANALYSIS } from "./test-fixture";
import type { CachedSourceAnalysis } from "../src/types/analysis";

test("real services complete first-article creation, persist history/index/graph, and avoid a repeat Wiki write (synthetic provider only)", async () => {
  const statement = "知识整理应保留来源。", sourcePath = "raw/Fixture.md";
  const settings = { ...DEFAULT_SETTINGS, llmBaseUrl: "https://fixture.invalid/v1", llmApiKey: "synthetic-only", llmModel: "fixture" };
  const files = new Map<string, { content: string; mtime: number }>([[sourcePath, { content: `# Fixture\n\n${statement}`, mtime: 100 }]]);
  const derived = new Map<string, string>(), directories = new Set<string>();
  let wikiWrites = 0, tick = 200, providerCalls = 0;
  const file = (path: string) => files.has(path) ? { path, stat: { mtime: files.get(path)!.mtime }, extension: "md" } : null;
  const vault = {
    isInInboxScope: (path: string) => path.startsWith("raw/"), isInWikiScope: (path: string) => path.startsWith("wiki/"),
    isInKnowledgeScope: (path: string) => path.startsWith("wiki/") || path.startsWith("raw/"),
    getMarkdownFile: file, getDisplayTitle: () => "Fixture", readMarkdown: async (target: any) => files.get(target.path)!.content,
    listWikiFiles: async () => [...files.keys()].filter((path) => path.startsWith("wiki/")).map(file),
    getConfiguredRetrievalScope: () => ({ inboxFolder: "raw", rawFolders: ["raw"], wikiFolder: "wiki" })
  } as any;
  const adapterVault = { adapter: {
    exists: async (path: string) => derived.has(path) || directories.has(path),
    mkdir: async (path: string) => { directories.add(path); },
    read: async (path: string) => derived.get(path)!, write: async (path: string, value: string) => { derived.set(path, value); }
  } } as any;
  const llm = new LlmService(() => settings, async (_url, _headers, body) => {
    providerCalls++;
    const messages = JSON.parse(body).messages, system = messages[0].content;
    let response: unknown;
    if (system.includes("extract atomic claims")) response = { claims: [{ statement, type: "fact", confidence: 0.9 }] };
    else if (system.includes("analyze atomic claim coverage")) {
      const existing = index.getClaims()[0];
      response = { coverages: [{ candidateClaimId: await generateCandidateClaimId({ statement, sourcePath }),
        coverage: existing === undefined ? "none" : "full", coreAspects: [statement], coveredBy: existing === undefined ? [] : [existing.id],
        coveredAspects: existing === undefined ? [] : [statement], uncoveredAspects: existing === undefined ? [statement] : [], conflictingAspects: [],
        pairwise: existing === undefined ? [] : [{ claimId: existing.id, relation: "equivalent", coveredAspects: [statement], conflictingAspects: [], reasoning: "同一知识" }],
        reasoning: "Synthetic coverage fixture", confidence: 0.9 }] };
    }
    else if (system.includes("Knowledge PR proposals")) response = {
      summary: "保留来源", changes: [{ id: "change-1", type: "add", after: `# Fixture\n\n${statement}`, reason: "新增来源规范", sourceClaims: [statement], confidence: 0.9 }],
      evidence: [{ kind: "internal", sourcePath, sourceTitle: "Fixture" }], confidence: 0.9
    };
    else response = { ...VALID_ANALYSIS, topic: "Fixture", relatedNotes: [], newClaims: [], conflicts: [], duplicateWith: [] };
    return { status: 200, json: { choices: [{ message: { content: JSON.stringify(response) }, finish_reason: "stop" }] } };
  });
  const extraction = new ClaimExtractionService(llm);
  const index = new ClaimStoreService(vault, extraction, new ClaimStoreRepository(adapterVault));
  await index.initialize();
  const analysis = new AnalysisService(vault, { findRelatedNotes: async () => [] } as any, llm, extraction,
    new ClaimRetrievalService(() => index.getClaims()), new ClaimComparisonService(llm, (id) => index.getClaims().find((claim) => claim.id === id)), index, () => settings);
  const cache = new KnowledgePRCacheService({}, async () => undefined);
  const proposals = new KnowledgePRService(vault, llm, cache, () => "wiki");
  const store = {
    read: async (path: string) => files.has(path) ? { path, ...files.get(path)! } : null,
    create: async (path: string, content: string) => { assert.equal(files.has(path), false); wikiWrites++; files.set(path, { content, mtime: tick++ }); return { path, ...files.get(path)! }; },
    modify: async (path: string, content: string) => { wikiWrites++; files.set(path, { content, mtime: tick++ }); return { path, ...files.get(path)! }; },
    delete: async (path: string) => { files.delete(path); },
    createJson: async (path: string, content: string) => { derived.set(path, content); }, list: async (path: string) => [...derived.keys()].filter((key) => key.startsWith(path + "/"))
  };
  const writer = new KnowledgeWriteService(store, new HistoryService(store), cache, () => "normal", { reindexWiki: (path) => index.reindexWiki(path) }, () => "wiki");
  const graph = new ClaimGraphService(index, new ClaimGraphRepository(adapterVault), new ClaimGraphCandidateService(), new ClaimGraphRelationService(llm), new ClaimEvolutionService(), new KnowledgeCompressionService());
  await graph.initialize();
  const ports = {
    prepareIndex: async () => { await index.build({ rebuild: false }); },
    analyze: async () => { const result = await analysis.analyzeSource(file(sourcePath) as any, { allowEmptyStore: true }); return { schemaVersion: 6, sourcePath, sourceModified: 100, analyzedAt: new Date().toISOString(), analysis: result.analysis, context: result.context } as CachedSourceAnalysis; },
    verifyConflicts: async () => [], assessFreshness: async () => ({ text: "本地判断", detail: "未外部核验" }),
    previousUpdate: async () => { const pr = cache.get(sourcePath); return pr?.status === "accepted" ? pr : null; },
    generateUpdate: async (entry: CachedSourceAnalysis, verifications: any) => (await proposals.generate(file(sourcePath) as any, entry, verifications)).pr,
    assertUnchanged: async () => undefined, write: (pr: any, entry: any, verifications: any) => writer.accept(pr, entry, verifications),
    refreshIndex: (path: string) => index.reindexWiki(path), buildRelations: async () => (await graph.build()).stats,
    log: (error: unknown) => { throw error; }
  };
  const orchestrator = new OneClickAnalysisOrchestrator();
  const result = await orchestrator.run(ports, settings.analysisPreferences, () => undefined);
  assert.equal(result.wikiPath, "wiki/Fixture.md"); assert.equal(wikiWrites, 1);
  assert.equal(index.getClaims()[0]?.statement, statement); assert.equal(graph.getSnapshot().nodes.length, 1);
  assert.equal([...derived.keys()].filter((path) => path.startsWith(".knowledge-agent/history/")).length, 1);
  assert.ok(providerCalls >= 4); assert.equal(result.warnings.length, 0);
  const repeated = await orchestrator.run(ports, settings.analysisPreferences, () => undefined);
  assert.equal(wikiWrites, 1); assert.match(repeated.updateMessage, /未重复写入/u);
});
