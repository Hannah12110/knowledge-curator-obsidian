import test from "node:test";
import assert from "node:assert/strict";
import { KnowledgePRCacheService } from "../src/services/knowledge-pr-cache-service";
import type { KnowledgePR } from "../src/types/knowledge-pr";

const SOURCE_PATH = "KnowledgeCuratorPhase1Test/inbox/Conflict.md";

function createPR(status: KnowledgePR["status"]): KnowledgePR {
  return {
    id: `pr-${status}`,
    sourcePath: SOURCE_PATH,
    target: {
      path: "KnowledgeCuratorPhase1Test/wiki/Conflict.md",
      title: "Conflict",
      operation: "update"
    },
    summary: "test",
    changes: [],
    evidence: [],
    rawRecommendation: "extract_only",
    confidence: 0.8,
    status,
    sourceFingerprint: { mtime: 1, hash: "a".repeat(64) },
    targetFingerprint: { mtime: 2, hash: "b".repeat(64) },
    createdAt: "2026-09-25T00:00:00.000Z"
  };
}

test("a new verification marks only an existing draft PR stale", async () => {
  let persisted: KnowledgePR | null = null;
  const service = new KnowledgePRCacheService(
    { [SOURCE_PATH]: createPR("draft") },
    async (cache) => {
      persisted = cache[SOURCE_PATH] ?? null;
    }
  );
  const stale = await service.markDraftStale(SOURCE_PATH);
  assert.equal(stale?.status, "stale");
  assert.equal(persisted?.status, "stale");

  await service.set(createPR("accepted"));
  const accepted = await service.markDraftStale(SOURCE_PATH);
  assert.equal(accepted?.status, "accepted");
});
