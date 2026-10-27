import test from "node:test";
import assert from "node:assert/strict";
import type { CandidateClaim } from "../src/types/claim";
import type { LlmMessage, LlmService } from "../src/services/llm-service";
import { LlmServiceError } from "../src/services/llm-service";
import { normalizeClaim } from "../src/services/claim-identity";
import { ComparisonCacheService } from "../src/services/comparison-cache-service";
import {
  COMPARISON_BATCH_LIMITS,
  planComparisonBatches
} from "../src/services/comparison-batch-planner";
import { ComparisonExecutionScheduler } from "../src/services/comparison-execution-scheduler";
import {
  ClaimComparisonService,
  type CandidateWithMatches
} from "../src/services/claim-comparison-service";

function candidates(count: number, suffix = ""): CandidateWithMatches[] {
  return Array.from({ length: count }, (_, index) => {
    const statement = `Novel atomic claim ${index + 1}${suffix}.`;
    const next: CandidateClaim = {
      id: `candidate-${index + 1}`,
      statement,
      normalizedStatement: normalizeClaim(statement),
      type: "fact",
      confidence: 0.9
    };
    return { candidate: next, matches: [] };
  });
}

function payloadFromMessages(messages: LlmMessage[]): Array<{ candidate: CandidateClaim }> {
  const message = [...messages].reverse().find((item) => item.content.includes("Input (only Candidate"));
  assert.ok(message);
  const marker = "Input (only Candidate + Top K Existing Claims):\n";
  const start = message.content.indexOf(marker);
  assert.notEqual(start, -1);
  return JSON.parse(message.content.slice(start + marker.length)) as Array<{ candidate: CandidateClaim }>;
}

function validCoverage(messages: LlmMessage[]): string {
  return JSON.stringify({
    coverages: payloadFromMessages(messages).map(({ candidate }) => ({
      candidateClaimId: candidate.id,
      coverage: "none",
      coreAspects: [candidate.statement],
      coveredBy: [],
      coveredAspects: [],
      uncoveredAspects: [candidate.statement],
      conflictingAspects: [],
      pairwise: [],
      reasoning: "No provided Existing Claim covers this atomic statement.",
      confidence: 0.86
    }))
  });
}

function service(
  requestJsonObject: (messages: LlmMessage[], retry: number) => Promise<string>,
  cache?: ComparisonCacheService
): ClaimComparisonService {
  const llm = { requestJsonObject } as unknown as LlmService;
  return new ClaimComparisonService(llm, () => undefined, {
    cache,
    getProviderContext: () => ({ provider: "api.deepseek.com", model: "deepseek-flash" }),
    sleep: async () => undefined
  });
}

test("dynamic batch packing respects hard max and reduces batch size for long claims", () => {
  const shortBatches = planComparisonBatches(candidates(13), () => undefined);
  assert.deepEqual(shortBatches.map((batch) => batch.length), [6, 6, 1]);
  assert.ok(shortBatches.every((batch) => batch.length <= COMPARISON_BATCH_LIMITS.maxCandidates));

  const long = candidates(4, ` ${"long context ".repeat(1_700)}`);
  const longBatches = planComparisonBatches(long, () => undefined);
  assert.deepEqual(longBatches.map((batch) => batch.length), [1, 1, 1, 1]);
});

test("scheduler limits concurrency and restores stable task order", async () => {
  let active = 0;
  let peak = 0;
  const scheduler = new ComparisonExecutionScheduler(2);
  const tasks = [30, 5, 20, 1].map((delay, index) => ({
    id: `task-${index}`,
    run: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return index;
    }
  }));
  const results = await scheduler.run(tasks);
  assert.equal(peak, 2);
  assert.deepEqual(results.map((result) => result.id), tasks.map((task) => task.id));
  assert.deepEqual(results.map((result) => result.status === "fulfilled" ? result.value : -1), [0, 1, 2, 3]);
});

test("cold Comparison results become per-candidate warm cache hits", async () => {
  let calls = 0;
  const cache = new ComparisonCacheService({}, async () => undefined);
  const compare = service(async (messages) => {
    calls += 1;
    return validCoverage(messages);
  }, cache);
  const input = candidates(7);
  const cold = await compare.compare(input);
  const coldMetrics = compare.getLastMetrics();
  assert.equal(cold.length, 7);
  assert.equal(coldMetrics?.cacheHits, 0);
  assert.equal(coldMetrics?.llmCandidates, 7);
  assert.equal(coldMetrics?.llmCalls, 2);
  assert.equal(cache.size(), 7);

  const callsAfterCold = calls;
  const warm = await compare.compare(input);
  const warmMetrics = compare.getLastMetrics();
  assert.equal(warm.length, 7);
  assert.equal(calls, callsAfterCold);
  assert.equal(warmMetrics?.cacheHits, 7);
  assert.equal(warmMetrics?.cacheHitRate, 1);
  assert.equal(warmMetrics?.llmCalls, 0);
  assert.ok(warm.every((item) => item.debug?.executionMode === "cache"));

  const partiallyChanged = input.map((item, index) => index === 0 ? {
    ...item,
    candidate: {
      ...item.candidate,
      statement: "A changed atomic claim.",
      normalizedStatement: normalizeClaim("A changed atomic claim.")
    }
  } : item);
  await compare.compare(partiallyChanged);
  const partialMetrics = compare.getLastMetrics();
  assert.equal(partialMetrics?.cacheHits, 6);
  assert.equal(partialMetrics?.cacheMisses, 1);
  assert.equal(partialMetrics?.llmCalls, 1);
});

test("partial batch failure preserves successful candidates and retries only the missing batch", async () => {
  const cache = new ComparisonCacheService({}, async () => undefined);
  let failLastBatch = true;
  let calls = 0;
  const compare = service(async (messages) => {
    calls += 1;
    const payload = payloadFromMessages(messages);
    if (failLastBatch && payload.some(({ candidate }) => candidate.id === "candidate-7")) {
      throw new LlmServiceError("请求过于频繁", "http_429");
    }
    return validCoverage(messages);
  }, cache);
  const input = candidates(7);
  await assert.rejects(compare.compare(input), /Claim coverage analysis failed/u);
  assert.equal(cache.size(), 6);
  assert.equal(compare.getLastMetrics()?.retries, 2);

  failLastBatch = false;
  const callsBeforeRecovery = calls;
  const recovered = await compare.compare(input);
  const metrics = compare.getLastMetrics();
  assert.equal(recovered.length, 7);
  assert.equal(metrics?.cacheHits, 6);
  assert.equal(metrics?.llmCandidates, 1);
  assert.equal(metrics?.llmCalls, 1);
  assert.equal(calls - callsBeforeRecovery, 1);
});

test("transient 429 retries with bounded backoff without silent fallback", async () => {
  let calls = 0;
  const compare = service(async (messages) => {
    calls += 1;
    if (calls === 1) throw new LlmServiceError("请求过于频繁", "http_429");
    return validCoverage(messages);
  });
  const result = await compare.compare(candidates(1));
  assert.equal(result[0]?.relation, "add");
  assert.equal(result[0]?.debug?.executionMode, "llm");
  assert.equal(compare.getLastMetrics()?.llmCalls, 2);
  assert.equal(compare.getLastMetrics()?.retries, 1);
});

test("schema-invalid batch recovers candidates individually without silent ADD fallback", async () => {
  let calls = 0;
  const compare = service(async (messages) => {
    calls += 1;
    const payload = payloadFromMessages(messages);
    if (payload.length > 1) return JSON.stringify({ coverages: [] });
    return validCoverage(messages);
  });

  const result = await compare.compare(candidates(6));
  assert.equal(result.length, 6);
  assert.ok(result.every((item) => item.debug?.executionMode === "llm"));
  assert.equal(calls, 8);
  assert.equal(compare.getLastMetrics()?.llmCalls, 8);
  assert.equal(compare.getLastMetrics()?.retries, 2);
});

test("instrumentation counts unique LLM pairs separately from retrieval duplicates, cache hits and retry attempts", async () => {
  const existing = { id: "existing-1", statement: "An unrelated historical statement.", normalizedStatement: normalizeClaim("An unrelated historical statement."), type: "fact", status: "active", confidence: .9,
    provenance: [{ sourceKind: "wiki", filePath: "wiki/Existing.md", fileHash: "hash", accepted: true }], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" } as any;
  let attempts = 0;
  const cache = new ComparisonCacheService({}, async () => undefined);
  const compare = new ClaimComparisonService({ requestJsonObject: async (messages: LlmMessage[]) => {
    attempts++; return attempts === 1 ? '{"invalid":true}' : validCoverage(messages);
  } } as any, () => existing, { cache, fastPath: { evaluate: () => null } as any, sleep: async () => undefined });
  const input = candidates(2).map((item) => ({ ...item, matches: [1, 2].map(() => ({ claimId: existing.id, score: .4, reasons: ["fixture"] })) }));
  await compare.compare(input);
  const cold = compare.getLastMetrics()!;
  assert.equal(cold.candidatePairCount, 4); assert.equal(cold.deduplicatedPairCount, 2); assert.equal(cold.llmComparisonPairCount, 2); assert.equal(cold.llmComparisonPairAttempts, 4);
  await compare.compare(input);
  const warm = compare.getLastMetrics()!; assert.equal(warm.cacheHits, 2); assert.equal(warm.candidatePairCount, 4); assert.equal(warm.llmComparisonPairCount, 0); assert.equal(warm.llmComparisonPairAttempts, 0);
});
