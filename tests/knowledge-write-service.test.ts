import test from "node:test";
import assert from "node:assert/strict";
import type { CachedSourceAnalysis } from "../src/types/analysis";
import type { KnowledgePR } from "../src/types/knowledge-pr";
import { sha256Text } from "../src/services/content-hash";
import { HistoryService } from "../src/services/history-service";
import type {
  KnowledgeFileSnapshot,
  KnowledgeFileStore
} from "../src/services/knowledge-file-store";
import { KnowledgePRCacheService } from "../src/services/knowledge-pr-cache-service";
import {
  KnowledgeWriteError,
  KnowledgeWriteService,
  applyKnowledgeChanges
} from "../src/services/knowledge-write-service";
import { VALID_ANALYSIS } from "./test-fixture";

const SOURCE_PATH = "KnowledgeCuratorPhase1Test/inbox/Agent Memory.md";
const TARGET_PATH = "KnowledgeCuratorPhase1Test/wiki/Agent Memory 设计与评测.md";
const SOURCE_CONTENT = "# Agent Memory\n\n新的评测方法。\n";
const TARGET_CONTENT = "# Agent Memory\n\n旧的记忆评测说明。\n\n## 边界\n\n保留本节。\n";
const CLAIM = VALID_ANALYSIS.newClaims[0]!.statement;

class FakeKnowledgeFileStore implements KnowledgeFileStore {
  readonly files = new Map<string, KnowledgeFileSnapshot>();
  readonly wikiWrites: Array<{ operation: "create" | "modify"; path: string }> = [];
  readonly historyPaths: string[] = [];
  failHistoryWrite = false;

  put(path: string, content: string, mtime: number): void {
    this.files.set(path, { path, content, mtime });
  }

  async read(path: string): Promise<KnowledgeFileSnapshot | null> {
    const file = this.files.get(path);
    return file === undefined ? null : { ...file };
  }

  async create(path: string, content: string): Promise<KnowledgeFileSnapshot> {
    if (this.files.has(path)) {
      throw new Error("exists");
    }
    const file = { path, content, mtime: Date.now() };
    this.files.set(path, file);
    this.wikiWrites.push({ operation: "create", path });
    return { ...file };
  }

  async modify(path: string, content: string): Promise<KnowledgeFileSnapshot> {
    if (!this.files.has(path)) {
      throw new Error("missing");
    }
    const file = { path, content, mtime: Date.now() };
    this.files.set(path, file);
    this.wikiWrites.push({ operation: "modify", path });
    return { ...file };
  }

  async delete(path: string): Promise<void> {
    if (!this.files.delete(path)) {
      throw new Error("missing");
    }
  }

  async createJson(path: string, content: string): Promise<void> {
    if (this.failHistoryWrite) {
      throw new Error("history write failed");
    }
    if (this.files.has(path)) {
      throw new Error("history exists");
    }
    this.files.set(path, { path, content, mtime: Date.now() });
    this.historyPaths.push(path);
  }

  async list(path: string): Promise<string[]> {
    return Array.from(this.files.keys()).filter((candidate) => candidate.startsWith(`${path}/`));
  }
}

function createAnalysisEntry(): CachedSourceAnalysis {
  return {
    schemaVersion: 3,
    sourcePath: SOURCE_PATH,
    sourceModified: 100,
    analyzedAt: "2026-09-25T00:00:00.000Z",
    analysis: {
      ...VALID_ANALYSIS,
      relatedNotes: [{
        path: TARGET_PATH,
        title: "Agent Memory 设计与评测",
        relevance: 0.92,
        reason: "主题高度相关。"
      }]
    },
    context: {
      sourceTruncated: false,
      relatedNotesTruncated: false,
      totalContextTruncated: false,
      candidatePaths: [TARGET_PATH],
      retrievalScope: {
        inboxFolder: "KnowledgeCuratorPhase1Test/inbox",
        wikiFolder: "KnowledgeCuratorPhase1Test/wiki",
        rawFolders: ["KnowledgeCuratorPhase1Test/raw-技术"]
      },
      claimContext: {
        mode: "legacy",
        topK: 0,
        claimStoreRevision: "legacy",
        retrievalVersion: "legacy-document",
        comparisonVersion: "legacy-document"
      }
    }
  };
}

async function createUpdatePR(
  sourceContent = SOURCE_CONTENT,
  targetContent = TARGET_CONTENT
): Promise<KnowledgePR> {
  return {
    id: "kpr-write-test",
    sourcePath: SOURCE_PATH,
    target: {
      path: TARGET_PATH,
      title: "Agent Memory 设计与评测",
      operation: "update"
    },
    summary: "补充记忆评测方法。",
    changes: [{
      id: "change-1",
      type: "refine",
      section: "评测",
      before: "旧的记忆评测说明。",
      after: "记忆写入策略需要按任务失败模式分别评测。",
      reason: "增加可执行的评测维度。",
      sourceClaims: [CLAIM],
      confidence: 0.82
    }],
    evidence: [{
      sourcePath: SOURCE_PATH,
      sourceTitle: "Agent Memory",
      claim: CLAIM
    }],
    rawRecommendation: "extract_only",
    confidence: 0.82,
    status: "draft",
    sourceFingerprint: {
      mtime: 100,
      hash: await sha256Text(sourceContent)
    },
    targetFingerprint: {
      mtime: 200,
      hash: await sha256Text(targetContent)
    },
    createdAt: "2026-09-25T00:00:00.000Z"
  };
}

function createService(store: FakeKnowledgeFileStore) {
  let persisted: KnowledgePR | null = null;
  const cache = new KnowledgePRCacheService({}, async (snapshot) => {
    persisted = snapshot[SOURCE_PATH] ?? null;
  });
  return {
    service: new KnowledgeWriteService(store, new HistoryService(store), cache),
    cached: () => persisted
  };
}

test("accept applies the expected minimal patch and writes accepted history", async () => {
  const store = new FakeKnowledgeFileStore();
  store.put(SOURCE_PATH, SOURCE_CONTENT, 100);
  store.put(TARGET_PATH, TARGET_CONTENT, 200);
  const pr = await createUpdatePR();
  const { service, cached } = createService(store);

  const result = await service.accept(pr, createAnalysisEntry());
  const updated = await store.read(TARGET_PATH);
  assert.equal(
    updated?.content,
    TARGET_CONTENT.replace(
      "旧的记忆评测说明。",
      "记忆写入策略需要按任务失败模式分别评测。"
    )
  );
  assert.equal(store.wikiWrites.length, 1);
  assert.equal(result.pr.status, "accepted");
  assert.equal(cached()?.status, "accepted");
  assert.equal(store.historyPaths.length, 1);
  assert.match(store.historyPaths[0]!, /^\.knowledge-agent\/history\//u);
  const history = await store.read(store.historyPaths[0]!);
  assert.equal(JSON.parse(history!.content).decision, "accepted");
});

test("reject records history and cache status without reading or writing Wiki", async () => {
  const store = new FakeKnowledgeFileStore();
  const pr = await createUpdatePR();
  const { service, cached } = createService(store);

  const result = await service.reject(pr);
  assert.equal(result.pr.status, "rejected");
  assert.equal(cached()?.status, "rejected");
  assert.deepEqual(store.wikiWrites, []);
  assert.equal(store.historyPaths.length, 1);
  const history = await store.read(store.historyPaths[0]!);
  assert.equal(JSON.parse(history!.content).decision, "rejected");
});

test("accept re-indexes the final Wiki while reject leaves Claim Store unchanged", async () => {
  const store = new FakeKnowledgeFileStore();
  store.put(SOURCE_PATH, SOURCE_CONTENT, 100);
  store.put(TARGET_PATH, TARGET_CONTENT, 200);
  const cache = new KnowledgePRCacheService({}, async () => undefined);
  const indexed: string[] = [];
  const service = new KnowledgeWriteService(
    store,
    new HistoryService(store),
    cache,
    () => "test",
    { reindexWiki: async (path) => { indexed.push(path); } }
  );

  const accepted = await service.accept(await createUpdatePR(), createAnalysisEntry());
  assert.equal(accepted.claimStoreUpdated, true);
  assert.deepEqual(indexed, [TARGET_PATH]);

  const rejectedPR = await createUpdatePR();
  rejectedPR.id = "kpr-reject-index-test";
  await service.reject(rejectedPR);
  assert.deepEqual(indexed, [TARGET_PATH]);
});

test("production preview blocks accept before any Markdown write", async () => {
  const store = new FakeKnowledgeFileStore();
  store.put(SOURCE_PATH, SOURCE_CONTENT, 100);
  store.put(TARGET_PATH, TARGET_CONTENT, 200);
  const cache = new KnowledgePRCacheService({}, async () => undefined);
  const service = new KnowledgeWriteService(
    store,
    new HistoryService(store),
    cache,
    () => "production-preview"
  );

  await assert.rejects(
    service.accept(await createUpdatePR(), createAnalysisEntry()),
    (error: unknown) => error instanceof KnowledgeWriteError &&
      error.code === "production_preview_read_only"
  );
  assert.deepEqual(store.wikiWrites, []);
  assert.deepEqual(store.historyPaths, []);
});

test("maintenance accept uses the same guarded writer, records origin, and re-indexes only the target Wiki", async () => {
  const store = new FakeKnowledgeFileStore();
  store.put(TARGET_PATH, TARGET_CONTENT, 200);
  const cache = new KnowledgePRCacheService({}, async () => undefined);
  const indexed: string[] = [];
  const service = new KnowledgeWriteService(
    store,
    new HistoryService(store),
    cache,
    () => "test",
    { reindexWiki: async (path) => { indexed.push(path); } }
  );
  const { pr, verification } = await createMaintenancePR();

  const result = await service.acceptMaintenance(pr, verification);
  assert.equal(result.pr.status, "accepted");
  assert.equal((await store.read(TARGET_PATH))?.content.includes("当前记忆评测说明。"), true);
  assert.deepEqual(indexed, [TARGET_PATH]);
  const history = JSON.parse((await store.read(store.historyPaths[0]!))!.content) as Record<string, unknown>;
  assert.equal(history.origin, "maintenance");
  assert.equal(history.claimId, "claim-maintenance");
  assert.equal(history.freshnessResolution, "stale");
});

test("maintenance reject writes history but never changes Wiki or Claim Store", async () => {
  const store = new FakeKnowledgeFileStore();
  store.put(TARGET_PATH, TARGET_CONTENT, 200);
  const indexed: string[] = [];
  const service = new KnowledgeWriteService(
    store,
    new HistoryService(store),
    new KnowledgePRCacheService({}, async () => undefined),
    () => "test",
    { reindexWiki: async (path) => { indexed.push(path); } }
  );
  const { pr } = await createMaintenancePR();
  const result = await service.reject(pr);
  assert.equal(result.pr.status, "rejected");
  assert.equal((await store.read(TARGET_PATH))?.content, TARGET_CONTENT);
  assert.deepEqual(store.wikiWrites, []);
  assert.deepEqual(indexed, []);
});

test("production preview blocks Maintenance Accept before any Markdown write", async () => {
  const store = new FakeKnowledgeFileStore();
  store.put(TARGET_PATH, TARGET_CONTENT, 200);
  const service = new KnowledgeWriteService(
    store,
    new HistoryService(store),
    new KnowledgePRCacheService({}, async () => undefined),
    () => "production-preview"
  );
  const { pr, verification } = await createMaintenancePR();
  await assert.rejects(
    service.acceptMaintenance(pr, verification),
    (error: unknown) => error instanceof KnowledgeWriteError && error.code === "production_preview_read_only"
  );
  assert.deepEqual(store.wikiWrites, []);
  assert.deepEqual(store.historyPaths, []);
});

test("history failure rolls back an accepted update to the exact original content", async () => {
  const store = new FakeKnowledgeFileStore();
  store.put(SOURCE_PATH, SOURCE_CONTENT, 100);
  store.put(TARGET_PATH, TARGET_CONTENT, 200);
  store.failHistoryWrite = true;
  const { service } = createService(store);

  await assert.rejects(
    service.accept(await createUpdatePR(), createAnalysisEntry()),
    (error: unknown) => error instanceof KnowledgeWriteError &&
      error.code === "decision_persistence_failed_rolled_back"
  );
  assert.equal((await store.read(TARGET_PATH))?.content, TARGET_CONTENT);
  assert.deepEqual(store.historyPaths, []);
});

test("stale target mtime or hash blocks acceptance before any write", async () => {
  const scenarios = [
    { content: TARGET_CONTENT, mtime: 201 },
    { content: `${TARGET_CONTENT}\nchanged`, mtime: 200 }
  ];
  for (const scenario of scenarios) {
    const store = new FakeKnowledgeFileStore();
    store.put(SOURCE_PATH, SOURCE_CONTENT, 100);
    store.put(TARGET_PATH, scenario.content, scenario.mtime);
    const { service } = createService(store);
    await assert.rejects(
      service.accept(await createUpdatePR(), createAnalysisEntry()),
      (error: unknown) => error instanceof KnowledgeWriteError && error.code === "stale_target"
    );
    assert.deepEqual(store.wikiWrites, []);
    assert.deepEqual(store.historyPaths, []);
  }
});

test("missing or duplicate before text blocks acceptance", async () => {
  const cases = [
    {
      content: TARGET_CONTENT,
      before: "不存在的内容",
      message: /before 未在 Target Wiki 中找到/u
    },
    {
      content: "旧的记忆评测说明。\n旧的记忆评测说明。",
      before: "旧的记忆评测说明。",
      message: /before 在 Target Wiki 中出现多次/u
    }
  ];
  for (const testCase of cases) {
    const store = new FakeKnowledgeFileStore();
    store.put(SOURCE_PATH, SOURCE_CONTENT, 100);
    store.put(TARGET_PATH, testCase.content, 200);
    const pr = await createUpdatePR(SOURCE_CONTENT, testCase.content);
    pr.changes[0]!.before = testCase.before;
    const { service } = createService(store);
    await assert.rejects(service.accept(pr, createAnalysisEntry()), testCase.message);
    assert.deepEqual(store.wikiWrites, []);
  }
});

test("create collision blocks overwriting an existing target", async () => {
  const store = new FakeKnowledgeFileStore();
  store.put(SOURCE_PATH, SOURCE_CONTENT, 100);
  store.put(TARGET_PATH, TARGET_CONTENT, 200);
  const pr = await createUpdatePR();
  pr.target.operation = "create";
  pr.targetFingerprint = undefined;
  pr.changes = [{ ...pr.changes[0]!, type: "add", before: undefined }];
  const { service } = createService(store);

  await assert.rejects(
    service.accept(pr, createAnalysisEntry()),
    (error: unknown) => error instanceof KnowledgeWriteError && error.code === "create_collision"
  );
  assert.deepEqual(store.wikiWrites, []);
});

test("write scope guard blocks a real-vault path before any file access", async () => {
  const store = new FakeKnowledgeFileStore();
  const pr = await createUpdatePR();
  pr.target.path = "03_公众号阅读/wiki/Agent Memory.md";
  const { service } = createService(store);

  await assert.rejects(
    service.accept(pr, createAnalysisEntry()),
    (error: unknown) => error instanceof KnowledgeWriteError && error.code === "write_scope_violation"
  );
  assert.deepEqual(store.wikiWrites, []);
  assert.deepEqual(store.historyPaths, []);
});

test("patch application rejects overlap and applies valid changes from back to front", () => {
  assert.equal(
    applyKnowledgeChanges("A B C", [
      {
        id: "2",
        type: "replace",
        before: "C",
        after: "CC",
        reason: "test",
        sourceClaims: [CLAIM],
        confidence: 1
      },
      {
        id: "1",
        type: "replace",
        before: "A",
        after: "AA",
        reason: "test",
        sourceClaims: [CLAIM],
        confidence: 1
      }
    ]),
    "AA B CC"
  );

  assert.throws(() => applyKnowledgeChanges("abcd", [
    {
      id: "1",
      type: "replace",
      before: "abc",
      after: "x",
      reason: "test",
      sourceClaims: [CLAIM],
      confidence: 1
    },
    {
      id: "2",
      type: "replace",
      before: "bcd",
      after: "y",
      reason: "test",
      sourceClaims: [CLAIM],
      confidence: 1
    }
  ]), /重叠/u);
});

async function createMaintenancePR() {
  const claimFingerprint = "c".repeat(64);
  const verification = {
    id: "fresh-maintenance-test",
    claimId: "claim-maintenance",
    claimFingerprint,
    originalStatement: "旧的记忆评测说明。",
    resolution: "stale" as const,
    conclusion: "当前官方资料已更新该说明。",
    reasoning: "Tier 0 官方文档直接说明当前状态。",
    evidence: [{
      id: "e-1",
      title: "Official Documentation",
      url: "https://openai.com/docs/current",
      sourceTier: 0 as const,
      sourceType: "official" as const,
      supports: "new" as const,
      excerpt: "Current behavior.",
      reasoning: "直接证据。",
      confidence: 0.95
    }],
    confidence: 0.92,
    verifiedAt: "2026-09-27T00:00:00.000Z"
  };
  const hash = await sha256Text(TARGET_CONTENT);
  const pr: KnowledgePR = {
    id: "mpr-write-test",
    sourcePath: TARGET_PATH,
    target: { path: TARGET_PATH, title: "Agent Memory 设计与评测", operation: "update" },
    summary: "更新已过时说明。",
    changes: [{
      id: "change-1",
      type: "replace",
      before: "旧的记忆评测说明。",
      after: "当前记忆评测说明。",
      reason: "当前官方资料已更新。",
      sourceClaims: [verification.originalStatement],
      confidence: 0.92
    }],
    evidence: [{ kind: "external", sourceTitle: "Official Documentation", url: "https://openai.com/docs/current", sourceTier: 0, supports: "new", conclusion: verification.conclusion, confidence: 0.95 }],
    rawRecommendation: "extract_only",
    confidence: 0.92,
    status: "draft",
    sourceFingerprint: { mtime: 200, hash },
    targetFingerprint: { mtime: 200, hash },
    createdAt: "2026-09-27T00:00:00.000Z",
    origin: "maintenance",
    maintenanceContext: { claimId: verification.claimId, claimFingerprint, freshnessResolution: verification.resolution, verificationId: verification.id }
  };
  return { pr, verification };
}

test("normal mode safely updates a configured Wiki using the same fingerprints, history and readback", async () => {
  const store = new FakeKnowledgeFileStore(), pr = await createUpdatePR();
  pr.target.path = "wiki/Test.md";
  store.put(SOURCE_PATH, SOURCE_CONTENT, 100); store.put(pr.target.path, TARGET_CONTENT, 200);
  const cache = new KnowledgePRCacheService({}, async () => undefined);
  const writer = new KnowledgeWriteService(store, new HistoryService(store), cache, () => "normal", undefined, () => "wiki");
  const result = await writer.accept(pr, createAnalysisEntry());
  assert.equal(result.pr.status, "accepted"); assert.equal(store.historyPaths.length, 1);
  assert.match((await store.read(pr.target.path))!.content, /记忆写入策略/u);
});

test("normal mode without an explicit scope fails closed", async () => {
  const store = new FakeKnowledgeFileStore(), cache = new KnowledgePRCacheService({}, async () => undefined);
  const writer = new KnowledgeWriteService(store, new HistoryService(store), cache, () => "normal");
  await assert.rejects(writer.accept(await createUpdatePR(), createAnalysisEntry()), (error: any) => error.code === "write_scope_violation");
  assert.equal(store.wikiWrites.length, 0);
});

test("normal mode retains target fingerprint and history-failure rollback", async () => {
  const store = new FakeKnowledgeFileStore(), pr = await createUpdatePR(); pr.target.path = "wiki/Test.md";
  store.put(SOURCE_PATH, SOURCE_CONTENT, 100); store.put(pr.target.path, TARGET_CONTENT, 200);
  const cache = new KnowledgePRCacheService({}, async () => undefined);
  const writer = new KnowledgeWriteService(store, new HistoryService(store), cache, () => "normal", undefined, () => "wiki");
  store.put(pr.target.path, TARGET_CONTENT + "edited", 201);
  await assert.rejects(writer.accept(pr, createAnalysisEntry()), (error: any) => error.code === "stale_target");
  assert.equal(store.wikiWrites.length, 0);
  store.put(pr.target.path, TARGET_CONTENT, 200); store.failHistoryWrite = true;
  await assert.rejects(writer.accept(pr, createAnalysisEntry()), (error: any) => error.code === "decision_persistence_failed_rolled_back");
  assert.equal((await store.read(pr.target.path))!.content, TARGET_CONTENT);
});
