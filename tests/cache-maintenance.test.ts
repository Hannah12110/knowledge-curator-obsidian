import test from "node:test";
import assert from "node:assert/strict";
import { AnalysisCacheService } from "../src/services/analysis-cache-service";
import { KnowledgePRCacheService } from "../src/services/knowledge-pr-cache-service";
import { VerificationCacheService } from "../src/services/verification-cache-service";
import type { KnowledgePR } from "../src/types/knowledge-pr";

test("analysis and verification maintenance clear plugin caches only", async () => {
  let analysisSnapshot: unknown = null;
  const analysis = new AnalysisCacheService({}, async (snapshot) => {
    analysisSnapshot = snapshot;
  });
  let verificationSnapshot: unknown = null;
  const verification = new VerificationCacheService({}, async (snapshot) => {
    verificationSnapshot = snapshot;
  });
  await analysis.clear();
  await verification.clear();
  assert.deepEqual(analysisSnapshot, {});
  assert.deepEqual(verificationSnapshot, {});
});

test("draft maintenance preserves accepted and rejected PR records", async () => {
  const base = {
    id: "pr",
    sourcePath: "inbox/a.md",
    target: { path: "wiki/a.md", title: "A", operation: "update" as const },
    summary: "summary",
    changes: [],
    evidence: [],
    rawRecommendation: "keep" as const,
    confidence: 0.8,
    sourceFingerprint: { mtime: 1, hash: "hash" },
    createdAt: "2026-09-25T00:00:00.000Z"
  };
  let snapshot: Record<string, KnowledgePR> = {};
  const service = new KnowledgePRCacheService({
    "inbox/a.md": { ...base, status: "draft" },
    "inbox/b.md": { ...base, id: "pr-b", sourcePath: "inbox/b.md", status: "accepted" }
  }, async (value) => {
    snapshot = value;
  });
  assert.equal(await service.clearDrafts(), 1);
  assert.equal(snapshot["inbox/a.md"], undefined);
  assert.equal(snapshot["inbox/b.md"]?.status, "accepted");
});
