import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimRecord } from "../src/types/claim";
import type { MaintenanceStore } from "../src/types/maintenance";
import { FreshnessRiskService } from "../src/services/freshness-risk-service";
import { MaintenanceService } from "../src/services/maintenance-service";
import type { ClaimStoreService } from "../src/services/claim-store-service";
import type { MaintenanceStoreRepository } from "../src/services/maintenance-store-repository";
import type { VaultService } from "../src/services/vault-service";

const claims: ClaimRecord[] = [
  claim("stable", "RAG 是 Retrieval-Augmented Generation。", "definition", "Wiki/Stable.md"),
  claim("volatile", "GPT-5 当前上下文窗口为 128K tokens。", "quantitative", "Wiki/Current.md")
];

test("local risk scan persists an explainable queue without any network dependency", async () => {
  const repository = new FakeRepository();
  const service = createService(repository);
  await service.initialize();

  const first = await service.scan();
  assert.equal(first.assessed, 2);
  assert.equal(first.reused, 0);
  assert.equal(first.stats.totalClaims, 2);
  assert.equal(first.stats.critical, 1);
  assert.equal(first.stats.low, 1);
  assert.equal(repository.saves, 1);
  const queue = service.getSnapshot();
  assert.equal(queue.items[0]?.claim.id, "volatile");
  assert.match(queue.items[0]?.record.explanation ?? "", /当前|数值/u);

  const second = await service.scan();
  assert.equal(second.assessed, 0);
  assert.equal(second.reused, 2);
  assert.equal(repository.saves, 2);
});

test("verification metadata persists locally and cache clearing preserves the result", async () => {
  const repository = new FakeRepository();
  const service = createService(repository);
  await service.initialize();
  await service.scan();
  const record = service.getRecord("volatile")!;
  await service.saveVerification({
    cacheKey: "cache-1",
    claimId: "volatile",
    claimFingerprint: record.claimFingerprint,
    queries: ["GPT-5 context window official current"],
    provider: "tavily",
    model: "deepseek-flash",
    rankedSources: [],
    result: {
      id: "fresh-test",
      claimId: "volatile",
      claimFingerprint: record.claimFingerprint,
      originalStatement: claims[1]!.statement,
      resolution: "insufficient_evidence",
      conclusion: "证据不足。",
      reasoning: "未找到可靠来源。",
      evidence: [],
      confidence: 0.3,
      verifiedAt: "2026-09-27T00:00:00.000Z"
    }
  });
  assert.equal(service.getRecord("volatile")?.latestResolution, "insufficient_evidence");
  assert.equal(service.getSnapshot("verified").items.length, 1);
  assert.equal(await service.clearVerificationCache(), 1);
  assert.equal(service.getCachedVerification("cache-1"), null);
  assert.equal(service.getVerification("fresh-test")?.resolution, "insufficient_evidence");
});

function createService(repository: FakeRepository): MaintenanceService {
  const claimStore = { getClaims: () => claims } as unknown as ClaimStoreService;
  const vault = {
    getMarkdownFile: (path: string) => ({ path, stat: { mtime: Date.parse("2026-09-01T00:00:00.000Z") } })
  } as unknown as VaultService;
  return new MaintenanceService(
    claimStore,
    vault,
    new FreshnessRiskService(),
    repository as unknown as MaintenanceStoreRepository
  );
}

class FakeRepository {
  store: MaintenanceStore = this.empty();
  saves = 0;
  empty(): MaintenanceStore {
    return { schemaVersion: 1, riskPolicyVersion: "freshness-risk-v1", generatedAt: new Date(0).toISOString(), records: {}, verifications: {}, verificationCache: {} };
  }
  async load() { return { status: "not_scanned" as const, store: structuredClone(this.store) }; }
  async save(store: MaintenanceStore): Promise<void> { this.store = structuredClone(store); this.saves += 1; }
}

function claim(id: string, statement: string, type: ClaimRecord["type"], filePath: string): ClaimRecord {
  return {
    id,
    statement,
    normalizedStatement: statement.toLowerCase(),
    type,
    status: "active",
    confidence: 0.9,
    provenance: [{ filePath, fileHash: "a".repeat(64), sourceKind: "wiki" }],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}
