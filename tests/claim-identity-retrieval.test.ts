import test from "node:test";
import assert from "node:assert/strict";
import type { CandidateClaim, ClaimRecord } from "../src/types/claim";
import {
  generateClaimId,
  normalizeClaim
} from "../src/services/claim-identity";
import {
  CLAIM_RETRIEVAL_V1,
  CLAIM_RETRIEVAL_VERSION,
  ClaimRetrievalService,
  scoreClaim,
  tokenizeClaimText
} from "../src/services/claim-retrieval-service";

function record(
  id: string,
  statement: string,
  overrides: Partial<ClaimRecord> = {}
): ClaimRecord {
  return {
    id,
    statement,
    normalizedStatement: normalizeClaim(statement),
    type: "fact",
    status: "active",
    confidence: 0.9,
    provenance: [{
      filePath: `KnowledgeCuratorPhase1Test/wiki/${id}.md`,
      fileHash: `hash-${id}`,
      sourceKind: "wiki",
      accepted: true
    }],
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides
  };
}

function candidate(statement: string): CandidateClaim {
  return {
    id: "candidate-1",
    statement,
    normalizedStatement: normalizeClaim(statement),
    type: "fact",
    confidence: 0.9,
    topic: "Agent Memory"
  };
}

test("claim normalization removes Markdown formatting but preserves semantic qualifiers", () => {
  assert.equal(
    normalizeClaim(" **RAG**  may improve factual accuracy。 "),
    "rag may improve factual accuracy"
  );
  assert.notEqual(
    normalizeClaim("RAG may improve factual accuracy."),
    normalizeClaim("RAG always improves factual accuracy.")
  );
});

test("claim ID is deterministic and qualifier-sensitive", async () => {
  const base = {
    statement: "Long-term memory persists across sessions.",
    sourcePath: "KnowledgeCuratorPhase1Test/wiki/Memory.md"
  };
  const first = await generateClaimId({ ...base, qualifiers: ["usually"] });
  const second = await generateClaimId({ ...base, qualifiers: ["usually"] });
  const absolute = await generateClaimId({ ...base, qualifiers: ["always"] });
  const otherPath = await generateClaimId({
    ...base,
    sourcePath: "KnowledgeCuratorRegression/wiki/Memory.md",
    qualifiers: ["usually"]
  });
  assert.equal(first, second);
  assert.notEqual(first, absolute);
  assert.notEqual(first, otherPath);
  assert.match(first, /^claim_[a-f0-9]{24}$/u);
});

test("claim retrieval ranks a semantic duplicate above unrelated claims and honors Top K", () => {
  const claims = [
    record("memory", "Long-term memory persists information across sessions.", { topic: "Agent Memory" }),
    record("evaluation", "Agent evaluation should use reproducible benchmarks.", { topic: "Agent Evaluation" }),
    record("tools", "Tool permissions should follow least privilege.", { topic: "Agent Tools" }),
    record("rag", "RAG retrieves documents before generation.", { topic: "RAG" })
  ];
  const service = new ClaimRetrievalService(() => claims);
  const results = service.retrieve(
    candidate("Agent long-term memory stores information beyond a single session."),
    3
  );
  assert.equal(results[0]?.claimId, "memory");
  assert.equal(results.length, 3);
  assert.ok(results[0]!.score > results[1]!.score);
});

test("exact normalized statement receives a perfect retrieval score", () => {
  const existing = record("same", "Long-term memory persists across sessions.");
  assert.equal(
    scoreClaim(candidate("Long-term memory persists across sessions."), existing).score,
    1
  );
});

test("Chinese tokenization keeps technical phrases and bigrams while removing stop words", () => {
  const tokens = tokenizeClaimText("长期记忆需要跨 Session 持久化，并通过上下文窗口工作。");
  assert.ok(tokens.has("长期记忆"));
  assert.ok(tokens.has("长期"));
  assert.ok(tokens.has("持久化"));
  assert.ok(tokens.has("session"));
  assert.ok(!tokens.has("需要"));
  assert.ok(!tokens.has("通过"));
});

test("English tokenization normalizes plural and hyphen variants but preserves versions", () => {
  assert.deepEqual(
    [...tokenizeClaimText("Long-term memories for agents")].sort(),
    [...tokenizeClaimText("long term memory agent")].sort()
  );
  assert.ok(tokenizeClaimText("GPT-4o uses a 128k context window").has("gpt4o"));
  assert.ok(tokenizeClaimText("GPT-4o uses a 128k context window").has("128k"));
});

test("v2 bilingual aliases retrieve a Chinese memory claim that v1 misses", () => {
  const claims = [
    record("a-distractor", "A memory controller selects tools for an agent.", { topic: "Agent Memory" }),
    record("memory", "长期记忆通常需要跨 Session 持久化。", { topic: "Agent Memory" }),
    record("z-distractor", "Agent memory may summarize conversations.", { topic: "Agent Memory" })
  ];
  const service = new ClaimRetrievalService(() => claims);
  const input = candidate("Long-term memory persists information beyond a single session.");
  const v1 = service.retrieve(input, 3, CLAIM_RETRIEVAL_V1);
  const v2 = service.retrieveWithDebug(input, 3, CLAIM_RETRIEVAL_VERSION);
  assert.notEqual(v1[0]?.claimId, "memory");
  assert.equal(v2.matches[0]?.claimId, "memory");
  assert.ok(v2.matches[0]?.reasons.some((reason) => reason.includes("alias match")));
  assert.ok(v2.debug.expandedTerms.includes("alias:long-term-memory"));
});

test("acronym expansion retrieves RAG against its full bilingual term", () => {
  const claims = [
    record("distractor", "Generation temperature changes output diversity.", { topic: "RAG" }),
    record("rag", "Retrieval augmented generation may improve factual grounding.", { topic: "RAG" })
  ];
  const result = new ClaimRetrievalService(() => claims).retrieveWithDebug(
    candidate("RAG 可以改善模型回答的事实依据。"),
    3
  );
  assert.equal(result.matches[0]?.claimId, "rag");
  assert.ok(result.matches[0]?.features?.acronymScore === 1);
  assert.ok(result.matches[0]?.features?.aliasScore === 1);
});

test("qualifier and negation conflicts remain retrieval-positive", () => {
  const claims = [
    record("rag", "RAG may improve factual accuracy.", { topic: "RAG" }),
    record("episodic", "Episodic memory remains useful in modern agents.", { topic: "Agent Memory" }),
    record("other", "Agents can call external tools.", { topic: "Agent Tools" })
  ];
  const service = new ClaimRetrievalService(() => claims);
  const qualifier = service.retrieve(candidate("RAG always improves factual accuracy."), 3);
  const negation = service.retrieve(
    candidate("Episodic memory is no longer useful in modern agents."),
    3
  );
  assert.equal(qualifier[0]?.claimId, "rag");
  assert.ok(qualifier[0]?.reasons.includes("qualifier contrast retained for conflict comparison"));
  assert.equal(negation[0]?.claimId, "episodic");
  assert.ok(negation[0]?.reasons.includes("negation contrast retained for conflict comparison"));
});

test("numbers and model versions improve precision without hiding conflicting values", () => {
  const claims = [
    record("gpt4", "GPT-4 reaches an 80% pass rate on Benchmark A.", { type: "quantitative", topic: "Evaluation" }),
    record("gpt4o", "GPT-4o reaches an 80% pass rate on Benchmark A.", { type: "quantitative", topic: "Evaluation" })
  ];
  const input = {
    ...candidate("GPT-4o reaches a 92% pass rate on Benchmark A."),
    type: "quantitative" as const,
    topic: "Evaluation"
  };
  const result = new ClaimRetrievalService(() => claims).retrieve(input, 3);
  assert.equal(result[0]?.claimId, "gpt4o");
  assert.ok(result[0]?.reasons.includes("different numbers retained for comparison"));
});

test("topic and type are auxiliary signals and output remains deterministic", () => {
  const claims = [
    record("definition", "Memory is information retained by an agent.", { type: "definition", topic: "Agent Memory" }),
    record("method", "Memory is evaluated with a benchmark.", { type: "method", topic: "Evaluation" }),
    record("fact", "Memory can persist across sessions.", { topic: "Agent Memory" })
  ];
  const service = new ClaimRetrievalService(() => claims);
  const input = { ...candidate("Agent memory retains information."), type: "definition" as const };
  const first = service.retrieveWithDebug(input, 3);
  const second = service.retrieveWithDebug(input, 3);
  assert.deepEqual(first, second);
  assert.equal(first.matches[0]?.claimId, "definition");
  assert.ok((first.matches[0]?.features?.topicScore ?? 0) > 0);
  assert.equal(first.matches[0]?.features?.typeScore, 1);
});

test("retrieval scans local claims without any Markdown write capability", () => {
  let reads = 0;
  const service = new ClaimRetrievalService(() => {
    reads += 1;
    return [record("memory", "Long-term memory persists across sessions.")];
  });
  service.retrieve(candidate("Long term memory persists across a session."), 5);
  assert.equal(reads, 1);
});
