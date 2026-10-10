import test from "node:test";
import assert from "node:assert/strict";
import type { TFile } from "obsidian";
import type { ClaimRecord, ClaimStore } from "../src/types/claim";
import type { ClaimExtractionService } from "../src/services/claim-extraction-service";
import type { ClaimStoreRepository } from "../src/services/claim-store-repository";
import { ClaimStoreService } from "../src/services/claim-store-service";
import type { VaultService } from "../src/services/vault-service";
import { normalizeClaim } from "../src/services/claim-identity";

const PATH_A = "KnowledgeCuratorPhase1Test/wiki/A.md";
const PATH_B = "KnowledgeCuratorPhase1Test/wiki/B.md";

class FakeRepository {
  store: ClaimStore | null = null;
  saveCount = 0;

  async load() {
    return this.store === null
      ? { status: "not_built" as const, store: null }
      : { status: "ready" as const, store: structuredClone(this.store) };
  }

  empty(): ClaimStore {
    return {
      schemaVersion: 1,
      generatedAt: "2026-09-25T00:00:00.000Z",
      claims: {},
      files: {},
      failedFiles: {}
    };
  }

  async save(store: ClaimStore): Promise<void> {
    this.saveCount += 1;
    this.store = structuredClone(store);
  }
}

function claim(path: string, hash: string, suffix = ""): ClaimRecord {
  const id = `claim_${path.endsWith("A.md") ? "a" : "b"}${suffix}`;
  const statement = `Knowledge from ${path}${suffix}`;
  return {
    id,
    statement,
    normalizedStatement: normalizeClaim(statement),
    type: "fact",
    status: "active",
    confidence: 0.9,
    provenance: [{ filePath: path, fileHash: hash, sourceKind: "wiki", accepted: true }],
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z"
  };
}

function makeHarness() {
  const contents = new Map([[PATH_A, "A v1"], [PATH_B, "B v1"]]);
  const repository = new FakeRepository();
  let calls = 0;
  let failPath: string | null = null;
  const vault = {
    listWikiFiles: async () => Array.from(contents.keys()).map((path) => ({ path } as TFile)),
    readMarkdown: async (file: TFile) => contents.get(file.path)!,
    getMarkdownFile: (path: string) => contents.has(path) ? ({ path } as TFile) : null,
    isInWikiScope: (path: string) => contents.has(path)
  } as unknown as VaultService;
  const extraction = {
    extractWikiClaims: async ({ filePath, fileHash }: { filePath: string; fileHash: string }) => {
      calls += 1;
      if (filePath === failPath) throw new Error("provider failed");
      return [claim(filePath, fileHash, contents.get(filePath))];
    }
  } as unknown as ClaimExtractionService;
  const service = new ClaimStoreService(
    vault,
    extraction,
    repository as unknown as ClaimStoreRepository
  );
  return {
    service,
    repository,
    contents,
    calls: () => calls,
    fail: (path: string | null) => { failPath = path; }
  };
}

test("Claim Store builds incrementally and skips unchanged Wiki hashes", async () => {
  const harness = makeHarness();
  await harness.service.initialize();
  const first = await harness.service.build({ rebuild: false });
  assert.equal(first.llmCalls, 2);
  assert.equal(first.cacheHits, 0);
  assert.equal(first.stats.indexedWiki, 2);
  const second = await harness.service.build({ rebuild: false });
  assert.equal(second.llmCalls, 0);
  assert.equal(second.cacheHits, 2);
  assert.equal(harness.calls(), 2);
});

test("changed Wiki is re-indexed and deleted Wiki claims are removed", async () => {
  const harness = makeHarness();
  await harness.service.initialize();
  await harness.service.build({ rebuild: false });
  const oldA = harness.repository.store!.files[PATH_A]!.claimIds[0]!;
  harness.contents.set(PATH_A, "A v2");
  harness.contents.delete(PATH_B);
  const result = await harness.service.build({ rebuild: false });
  assert.equal(result.llmCalls, 1);
  assert.equal(result.stats.indexedWiki, 1);
  assert.equal(harness.repository.store!.files[PATH_B], undefined);
  assert.equal(harness.repository.store!.claims.claim_bB_v1, undefined);
  assert.notEqual(harness.repository.store!.files[PATH_A]!.claimIds[0], oldA);
});

test("partial build preserves successes and retry processes only failed files", async () => {
  const harness = makeHarness();
  await harness.service.initialize();
  harness.fail(PATH_B);
  const partial = await harness.service.build({ rebuild: false });
  assert.equal(partial.stats.status, "partial");
  assert.equal(partial.stats.indexedWiki, 1);
  assert.equal(partial.stats.failedFiles, 1);
  harness.fail(null);
  const retried = await harness.service.build({ rebuild: false, retryFailedOnly: true });
  assert.equal(retried.llmCalls, 1);
  assert.equal(retried.stats.status, "ready");
  assert.equal(retried.stats.indexedWiki, 2);
});

test("Claim Store build writes only repository state and never Markdown", async () => {
  const harness = makeHarness();
  await harness.service.initialize();
  await harness.service.build({ rebuild: true });
  assert.deepEqual(
    Array.from(harness.contents.entries()),
    [[PATH_A, "A v1"], [PATH_B, "B v1"]]
  );
  assert.ok(harness.repository.saveCount >= 2);
});

test("Claim Store never exposes claims from a previously configured Wiki scope", async () => {
  const harness = makeHarness();
  const outsidePath = "03_公众号阅读/wiki/Outside.md";
  const outside = claim(outsidePath, "outside-hash");
  harness.repository.store = harness.repository.empty();
  harness.repository.store.claims[outside.id] = outside;
  harness.repository.store.files[outsidePath] = {
    fileHash: "outside-hash",
    claimIds: [outside.id],
    indexedAt: "2026-09-25T00:00:00.000Z"
  };
  await harness.service.initialize();
  assert.deepEqual(harness.service.getClaims(), []);
  assert.equal(harness.service.getStats().status, "not_built");
  assert.equal(harness.service.getStats().indexedWiki, 0);
});
