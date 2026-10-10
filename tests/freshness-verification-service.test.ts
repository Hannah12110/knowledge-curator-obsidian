import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimRecord } from "../src/types/claim";
import type { CachedFreshnessVerification, ClaimMaintenanceRecord } from "../src/types/maintenance";
import { FreshnessVerificationService } from "../src/services/freshness-verification-service";
import type { LlmService } from "../src/services/llm-service";
import type { MaintenanceService } from "../src/services/maintenance-service";
import { SearchProviderError, type SearchProvider } from "../src/services/search-provider";

test("real-service path searches only after user verification, retries invalid JSON, and then caches", async () => {
  let searches = 0;
  let llmCalls = 0;
  const storage = new Map<string, CachedFreshnessVerification>();
  const search = {
    id: "tavily" as const,
    search: async () => {
      searches += 1;
      return [{ title: "Official API Documentation", url: "https://platform.openai.com/docs/api-reference/current", snippet: "The current API supports Feature B.", publishedAt: "2026-09-01T00:00:00.000Z" }];
    }
  } satisfies SearchProvider;
  const llm = {
    requestJsonObject: async () => {
      llmCalls += 1;
      if (llmCalls === 1) return "not-json";
      return JSON.stringify({
        resolution: "needs_refinement",
        conclusion: "现有说法需要补充 Feature B。",
        reasoning: "当前官方文档显示能力边界已扩展。",
        confidence: 0.91,
        evidence: [{ id: "e-1", title: "Official API Documentation", url: "https://platform.openai.com/docs/api-reference/current", sourceTier: 0, sourceType: "official", supports: "new", excerpt: "The current API supports Feature B.", reasoning: "直接说明当前能力。", confidence: 0.95 }]
      });
    }
  } as unknown as LlmService;
  const maintenance = createMaintenance(storage);
  const service = new FreshnessVerificationService(search, llm, maintenance, () => "deepseek-flash", () => 5);

  assert.equal(searches, 0, "constructing the service and queue must not search");
  const first = await service.verify(claim.id);
  assert.equal(first.result.resolution, "needs_refinement");
  assert.equal(searches, 2, "two bounded freshness queries use the real provider abstraction");
  assert.equal(llmCalls, 2, "invalid schema retries exactly once");

  const cached = await service.verify(claim.id);
  assert.equal(cached.cacheKey, first.cacheKey);
  assert.equal(searches, 2);
  assert.equal(llmCalls, 2);
});

test("empty search results fail closed as insufficient evidence without an LLM call", async () => {
  let llmCalls = 0;
  const search: SearchProvider = {
    id: "tavily",
    search: async () => { throw new SearchProviderError("未找到足够可靠的外部来源。", "empty_search_results"); }
  };
  const llm = { requestJsonObject: async () => { llmCalls += 1; return "{}"; } } as unknown as LlmService;
  const service = new FreshnessVerificationService(search, llm, createMaintenance(new Map()), () => "deepseek-flash", () => 5);
  const result = await service.verify(claim.id);
  assert.equal(result.result.resolution, "insufficient_evidence");
  assert.equal(result.result.evidence.length, 0);
  assert.equal(llmCalls, 0);
});

const claim: ClaimRecord = {
  id: "claim-current-api",
  statement: "Product X 当前只支持 Feature A。",
  normalizedStatement: "product x 当前只支持 feature a",
  type: "fact",
  topic: "Product X API",
  status: "active",
  confidence: 0.9,
  provenance: [{ filePath: "KnowledgeCuratorPhase1Test/wiki/Product-X.md", fileHash: "a".repeat(64), sourceKind: "wiki" }],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z"
};
const record: ClaimMaintenanceRecord = {
  claimId: claim.id,
  claimFingerprint: "b".repeat(64),
  freshnessRisk: "critical",
  riskScore: 0.9,
  riskFactors: [],
  explanation: "current API",
  lastAssessedAt: "2026-09-27T00:00:00.000Z"
};

function createMaintenance(storage: Map<string, CachedFreshnessVerification>): MaintenanceService {
  return {
    getClaim: () => claim,
    getRecord: () => record,
    getCachedVerification: (key: string) => storage.get(key) ?? null,
    saveVerification: async (entry: CachedFreshnessVerification) => { storage.set(entry.cacheKey, entry); }
  } as unknown as MaintenanceService;
}
