import test from "node:test";
import assert from "node:assert/strict";
import {
  AnalysisCacheService,
  normalizeSourcePath
} from "../src/services/analysis-cache-service";
import type { CachedSourceAnalysis } from "../src/types/analysis";
import { VALID_ANALYSIS } from "./test-fixture";

const SOURCE_PATH = "KnowledgeCuratorPhase1Test/inbox/Harness Engineering.md";
const SOURCE_MTIME = 1_764_000_000_000;
const TEST_SCOPE = {
  inboxFolder: "KnowledgeCuratorPhase1Test/inbox",
  wikiFolder: "KnowledgeCuratorPhase1Test/wiki",
  rawFolders: [
    "KnowledgeCuratorPhase1Test/raw-产品",
    "KnowledgeCuratorPhase1Test/raw-技术"
  ]
};
const SCOPED_ANALYSIS = {
  ...VALID_ANALYSIS,
  relatedNotes: VALID_ANALYSIS.relatedNotes.map((note) => ({
    ...note,
    path: "KnowledgeCuratorPhase1Test/wiki/Agent Memory 设计与评测.md"
  }))
};

function createCacheEntry(
  sourcePath = SOURCE_PATH,
  sourceModified = SOURCE_MTIME
): CachedSourceAnalysis {
  return {
    schemaVersion: 6,
    sourcePath,
    sourceModified,
    analyzedAt: "2026-09-24T00:00:00.000Z",
    analysis: SCOPED_ANALYSIS,
    context: {
      sourceTruncated: false,
      relatedNotesTruncated: false,
      totalContextTruncated: false,
      candidatePaths: [
        "KnowledgeCuratorPhase1Test/wiki/Agent Memory 设计与评测.md"
      ],
      retrievalScope: TEST_SCOPE,
      claimContext: {
        mode: "claim",
        topK: 5,
        claimStoreRevision: "wiki-a:hash-a",
        retrievalVersion: "claim-retrieval-v2",
        comparisonVersion: "claim-comparison-v2"
      }
    }
  };
}

test("analyzed item with a valid cache returns SourceAnalysis", () => {
  const entry = createCacheEntry();
  const service = new AnalysisCacheService(
    { [SOURCE_PATH]: entry },
    async () => undefined
  );
  assert.deepEqual(service.getAnalysis(SOURCE_PATH, SOURCE_MTIME), SCOPED_ANALYSIS);
});

test("analyzed item with no cache fails safely", () => {
  const service = new AnalysisCacheService({}, async () => undefined);
  assert.equal(service.getAnalysis(SOURCE_PATH, SOURCE_MTIME), null);
});

test("changed source mtime invalidates the old cache", () => {
  const entry = createCacheEntry();
  const service = new AnalysisCacheService(
    { [SOURCE_PATH]: entry },
    async () => undefined
  );
  assert.equal(service.getAnalysis(SOURCE_PATH, SOURCE_MTIME + 1), null);
});

test("cache keys normalize leading slashes and Windows separators", async () => {
  let persistedPath = "";
  const service = new AnalysisCacheService({}, async (cache) => {
    persistedPath = Object.keys(cache)[0] ?? "";
  });
  await service.set(createCacheEntry("/KnowledgeCuratorPhase1Test\\inbox\\Harness Engineering.md"));
  assert.equal(persistedPath, SOURCE_PATH);
  assert.equal(normalizeSourcePath(`/${SOURCE_PATH}`), SOURCE_PATH);
  assert.deepEqual(service.getAnalysis(SOURCE_PATH, SOURCE_MTIME), SCOPED_ANALYSIS);
});

test("same-basename files in different folders use different cache keys", async () => {
  const service = new AnalysisCacheService({}, async () => undefined);
  await service.set(createCacheEntry("A/Test.md"));
  await service.set(createCacheEntry("B/Test.md"));

  assert.deepEqual(Object.keys(service.snapshot()).sort(), ["A/Test.md", "B/Test.md"]);
  assert.notEqual(
    service.snapshot()["A/Test.md"]?.sourcePath,
    service.snapshot()["B/Test.md"]?.sourcePath
  );
});

test("cache created under another retrieval scope is invalid", () => {
  const entry = createCacheEntry();
  const service = new AnalysisCacheService(
    { [SOURCE_PATH]: entry },
    async () => undefined
  );
  const otherScope = {
    inboxFolder: TEST_SCOPE.inboxFolder,
    wikiFolder: "03_公众号阅读/wiki",
    rawFolders: ["03_公众号阅读/raw-技术"]
  };

  assert.equal(
    service.getAnalysis(SOURCE_PATH, SOURCE_MTIME, otherScope),
    null
  );
});

test("cache containing an out-of-scope related path is invalid", () => {
  const entry = createCacheEntry();
  entry.analysis = {
    ...entry.analysis,
    relatedNotes: [{
      ...entry.analysis.relatedNotes[0]!,
      path: "03_公众号阅读/wiki/Agent Memory 设计与评测.md"
    }]
  };
  const service = new AnalysisCacheService(
    { [SOURCE_PATH]: entry },
    async () => undefined
  );

  assert.equal(
    service.getAnalysis(SOURCE_PATH, SOURCE_MTIME, TEST_SCOPE),
    null
  );
});

test("Phase 4 cache entries without schema version are safely invalidated", () => {
  const legacy = createCacheEntry() as CachedSourceAnalysis & { schemaVersion?: number };
  delete legacy.schemaVersion;
  const service = new AnalysisCacheService(
    { [SOURCE_PATH]: legacy },
    async () => undefined
  );
  assert.equal(service.getAnalysis(SOURCE_PATH, SOURCE_MTIME), null);
});

test("mode, Top K, and Claim Store revision changes invalidate analysis cache", () => {
  const entry = createCacheEntry();
  const service = new AnalysisCacheService(
    { [SOURCE_PATH]: entry },
    async () => undefined
  );
  const valid = entry.context.claimContext;
  assert.notEqual(service.getValid(SOURCE_PATH, SOURCE_MTIME, TEST_SCOPE, valid), null);
  assert.equal(service.getValid(SOURCE_PATH, SOURCE_MTIME, TEST_SCOPE, {
    mode: "legacy",
    topK: 0,
    claimStoreRevision: "legacy",
    retrievalVersion: "legacy-document",
    comparisonVersion: "legacy-document"
  }), null);
  assert.equal(service.getValid(SOURCE_PATH, SOURCE_MTIME, TEST_SCOPE, {
    ...valid,
    topK: 6
  }), null);
  assert.equal(service.getValid(SOURCE_PATH, SOURCE_MTIME, TEST_SCOPE, {
    ...valid,
    claimStoreRevision: "wiki-a:hash-b"
  }), null);
  assert.equal(service.getValid(SOURCE_PATH, SOURCE_MTIME, TEST_SCOPE, {
    ...valid,
    retrievalVersion: "claim-retrieval-v1"
  }), null);
  assert.equal(service.getValid(SOURCE_PATH, SOURCE_MTIME, TEST_SCOPE, {
    ...valid,
    comparisonVersion: "claim-comparison-v1"
  }), null);
});
