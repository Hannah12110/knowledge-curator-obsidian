import test from "node:test";
import assert from "node:assert/strict";
import type { ClaimRecord } from "../src/types/claim";
import type { ClaimGraphCandidatePair, ClaimGraphEdge, ClaimGraphNode } from "../src/types/claim-graph";
import { ClaimGraphRelationService } from "../src/services/claim-graph-relation-service";
import { KnowledgeCompressionService } from "../src/services/knowledge-compression-service";
import type { LlmService } from "../src/services/llm-service";

test("relation discovery retries invalid output and stores only validated relation", async () => {
  let calls = 0;
  const llm = {
    requestJsonObject: async () => {
      calls += 1;
      if (calls === 1) return "{}";
      return JSON.stringify({ relations: [{
        pairId: "pair", relation: "duplicate", direction: "symmetric", confidence: 0.96,
        reasoning: "same atomic claim", evidenceClaimIds: ["a", "b"]
      }] });
    }
  } as unknown as LlmService;
  const claims = new Map<string, ClaimRecord>([
    ["a", claim("a", "Agent memory persists across sessions.")],
    ["b", claim("b", "Agent memory stores information beyond one session.")]
  ]);
  const pairs: ClaimGraphCandidatePair[] = [{ pairId: "pair", leftClaimId: "a", rightClaimId: "b", score: 0.8, reasons: ["alias"] }];
  const result = await new ClaimGraphRelationService(llm).discover(pairs, claims);
  assert.equal(calls, 2);
  assert.equal(result.edges[0]?.relation, "duplicate");
  assert.equal(result.failedPairs.length, 0);
});

test("relation prompt makes the none evidence contract explicit", async () => {
  let prompt = "";
  const llm = {
    requestJsonObject: async (messages: Array<{ content: string }>) => {
      prompt = messages.map((message) => message.content).join("\n");
      return JSON.stringify({ relations: [{
        pairId: "pair", relation: "none", direction: "symmetric", confidence: 0.8,
        reasoning: "no reliable relation", evidenceClaimIds: []
      }] });
    }
  } as unknown as LlmService;
  const claims = new Map<string, ClaimRecord>([
    ["a", claim("a", "Agent memory persists across sessions.")],
    ["b", claim("b", "A benchmark reports model latency.")]
  ]);
  const pairs: ClaimGraphCandidatePair[] = [{ pairId: "pair", leftClaimId: "a", rightClaimId: "b", score: 0.3, reasons: ["topic"] }];
  const result = await new ClaimGraphRelationService(llm).discover(pairs, claims);
  assert.match(prompt, /relation=none/u);
  assert.match(prompt, /evidenceClaimIds[^\n]*空数组 \[\]/u);
  assert.equal(result.metrics.unrelatedCount, 1);
  assert.equal(result.failedPairs.length, 0);
  assert.equal(result.edges.length, 0);
});

test("compression preview merges only high-confidence duplicate components", async () => {
  const nodes = [node("a"), node("b"), node("c")];
  const duplicate = edge("d", "a", "b", "duplicate", 0.92);
  const supports = edge("s", "b", "c", "supports", 0.99);
  const proposals = await new KnowledgeCompressionService().preview(nodes, [duplicate, supports]);
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0]?.claimIds.sort(), ["a", "b"]);
  assert.equal(proposals[0]?.claimIds.includes("c"), false);
});

test("contradictions can never authorize compression", async () => {
  const proposals = await new KnowledgeCompressionService().preview(
    [node("a"), node("b")],
    [edge("c", "a", "b", "contradicts", 1)]
  );
  assert.deepEqual(proposals, []);
});

function claim(id: string, statement: string): ClaimRecord {
  return {
    id, statement, normalizedStatement: statement.toLowerCase(), type: "fact", status: "active", confidence: 0.9,
    provenance: [{ filePath: `Wiki/${id}.md`, fileHash: "a".repeat(64), sourceKind: "wiki" }],
    createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z"
  };
}
function node(claimId: string): ClaimGraphNode {
  return { claimId, statement: claimId, sourcePath: `Wiki/${claimId}.md`, createdAt: "2026-09-28T00:00:00.000Z", claimFingerprint: "a".repeat(64), status: "active" };
}
function edge(id: string, fromClaimId: string, toClaimId: string, relation: ClaimGraphEdge["relation"], confidence: number): ClaimGraphEdge {
  return {
    id, fromClaimId, toClaimId, relation, confidence, evidence: [{ claimId: fromClaimId, statement: fromClaimId, sourcePath: `Wiki/${fromClaimId}.md`, reason: relation }],
    retrievalScore: 0.9, retrievalReasons: ["test"], createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z"
  };
}
