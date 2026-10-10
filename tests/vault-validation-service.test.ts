import test from "node:test";
import assert from "node:assert/strict";
import type { ClaimStore } from "../src/types/claim";
import type { ClaimGraphStore } from "../src/types/claim-graph";
import type { VaultSnapshotSource } from "../src/types/validation";
import {
  ValidationBaselineService,
  VaultSnapshotService
} from "../src/services/vault-validation-service";

const NOW = new Date("2026-09-28T00:00:00.000Z");
const SCOPE = {
  inboxFolder: "KnowledgeCuratorValidation/inbox",
  wikiFolder: "KnowledgeCuratorValidation/wiki",
  rawFolders: ["KnowledgeCuratorValidation/raw-技术", "KnowledgeCuratorValidation/raw-产品"]
};

test("Snapshot records sorted Markdown hashes, sizes, and strict scope counts", async () => {
  const source = memorySource({
    "KnowledgeCuratorValidation/wiki/B.md": "# B",
    "KnowledgeCuratorValidation/inbox/A.md": "# A",
    "KnowledgeCuratorValidation/raw-技术/C.md": "# C",
    "KnowledgeCuratorValidation/raw-产品/D.MD": "# D",
    "KnowledgeCuratorValidation/wiki/ignored.pdf": "binary",
    "outside.md": "# Outside"
  });
  const snapshot = await new VaultSnapshotService().create(source, SCOPE, NOW);
  assert.equal(snapshot.markdownCount, 5);
  assert.equal(snapshot.wikiCount, 1);
  assert.equal(snapshot.inboxCount, 1);
  assert.equal(snapshot.rawCount, 2);
  assert.deepEqual(snapshot.files.map((file) => file.path), [
    "KnowledgeCuratorValidation/inbox/A.md",
    "KnowledgeCuratorValidation/raw-产品/D.MD",
    "KnowledgeCuratorValidation/raw-技术/C.md",
    "KnowledgeCuratorValidation/wiki/B.md",
    "outside.md"
  ]);
  assert.equal(snapshot.files.every((file) => /^[a-f0-9]{64}$/u.test(file.hash)), true);
});

test("adding a Markdown file changes snapshot count and identity", async () => {
  const service = new VaultSnapshotService();
  const before = await service.create(memorySource({ "wiki/A.md": "A" }), basicScope(), NOW);
  const after = await service.create(memorySource({ "wiki/A.md": "A", "wiki/B.md": "B" }), basicScope(), NOW);
  assert.equal(after.markdownCount, before.markdownCount + 1);
  assert.notEqual(after.snapshotId, before.snapshotId);
});

test("deleting a Markdown file changes snapshot count and identity", async () => {
  const service = new VaultSnapshotService();
  const before = await service.create(memorySource({ "wiki/A.md": "A", "wiki/B.md": "B" }), basicScope(), NOW);
  const after = await service.create(memorySource({ "wiki/A.md": "A" }), basicScope(), NOW);
  assert.equal(after.markdownCount, before.markdownCount - 1);
  assert.notEqual(after.snapshotId, before.snapshotId);
});

test("changing Markdown content changes file hash and snapshot identity", async () => {
  const service = new VaultSnapshotService();
  const before = await service.create(memorySource({ "wiki/A.md": "old" }), basicScope(), NOW);
  const after = await service.create(memorySource({ "wiki/A.md": "new" }), basicScope(), NOW);
  assert.notEqual(after.files[0]?.hash, before.files[0]?.hash);
  assert.notEqual(after.snapshotId, before.snapshotId);
});

test("same content produces a stable snapshot identity independent of listing order and time", async () => {
  const service = new VaultSnapshotService();
  const first = await service.create(memorySource({ "wiki/B.md": "B", "wiki/A.md": "A" }), basicScope(), NOW);
  const second = await service.create(memorySource({ "wiki/A.md": "A", "wiki/B.md": "B" }), basicScope(), new Date("2027-01-01T00:00:00.000Z"));
  assert.equal(first.snapshotId, second.snapshotId);
  assert.notEqual(first.createdAt, second.createdAt);
});

test("strict folder boundaries exclude similar directory names", async () => {
  const snapshot = await new VaultSnapshotService().create(memorySource({
    "wiki/A.md": "A",
    "wiki-old/B.md": "B",
    "inbox/C.md": "C",
    "inbox-old/D.md": "D",
    "raw/E.md": "E",
    "raw-backup/F.md": "F"
  }), basicScope(), NOW);
  assert.equal(snapshot.wikiCount, 1);
  assert.equal(snapshot.inboxCount, 1);
  assert.equal(snapshot.rawCount, 1);
});

test("Baseline summarizes Claim and Graph stores without mutating either input", async () => {
  const snapshot = await new VaultSnapshotService().create(memorySource({ "wiki/A.md": "A" }), basicScope(), NOW);
  const claimStore = {
    claims: { a: {}, b: {}, c: {} }, files: {}, failedFiles: {}, schemaVersion: 1, generatedAt: NOW.toISOString()
  } as unknown as ClaimStore;
  const graph = {
    nodes: { a: {}, b: {}, c: {} },
    edges: {
      ab: { relation: "duplicate" },
      bc: { relation: "contradicts" },
      ac: { relation: "supports" }
    },
    metadata: {}, evolution: []
  } as unknown as ClaimGraphStore;
  const before = JSON.stringify({ claimStore, graph });
  const baseline = new ValidationBaselineService().create({
    snapshot,
    claimStore,
    claimStoreStatus: "ready",
    claimGraph: graph,
    graphStatus: "ready",
    now: NOW
  });
  assert.equal(baseline.documents, 1);
  assert.equal(baseline.claims, 3);
  assert.equal(baseline.graphNodes, 3);
  assert.equal(baseline.graphEdges, 3);
  assert.equal(baseline.duplicateEdges, 1);
  assert.equal(baseline.conflictEdges, 1);
  assert.equal(baseline.relations.supports, 1);
  assert.equal(JSON.stringify({ claimStore, graph }), before);
});

test("Baseline reports not-built derived stores as zero instead of failing", async () => {
  const snapshot = await new VaultSnapshotService().create(memorySource({ "wiki/A.md": "A" }), basicScope(), NOW);
  const baseline = new ValidationBaselineService().create({
    snapshot,
    claimStore: null,
    claimStoreStatus: "not_built",
    claimGraph: null,
    graphStatus: "not_built",
    now: NOW
  });
  assert.equal(baseline.claims, 0);
  assert.equal(baseline.graphNodes, 0);
  assert.equal(baseline.graphEdges, 0);
  assert.equal(baseline.relations.refines, 0);
});

function memorySource(files: Record<string, string>): VaultSnapshotSource {
  const encoder = new TextEncoder();
  const contents = new Map(Object.entries(files).map(([path, content]) => [path, encoder.encode(content)]));
  return {
    listMarkdownFiles: async () => Array.from(contents, ([path, content]) => ({ path, size: content.byteLength })),
    readBytes: async (path) => {
      const content = contents.get(path);
      if (content === undefined) throw new Error(`Missing test file: ${path}`);
      return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    }
  };
}

function basicScope() {
  return { inboxFolder: "inbox", wikiFolder: "wiki", rawFolders: ["raw"] };
}
