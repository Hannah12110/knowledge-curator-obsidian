import test from "node:test";
import assert from "node:assert/strict";
import type { ClaimRecord } from "../src/types/claim";
import { normalizeClaim } from "../src/services/claim-identity";
import {
  ClaimGraphCandidateService,
  CLAIM_GRAPH_MAX_CANDIDATES_PER_NODE
} from "../src/services/claim-graph-candidate-service";

test("sparse candidate generation retrieves paraphrases without all-pairs expansion", async () => {
  const claims = Array.from({ length: 1_000 }, (_, index) => makeClaim(
    `noise-${index}`,
    `Unrelated component ${index} has configuration version v${index}.`,
    "Other"
  ));
  claims.push(makeClaim("memory-a", "长期记忆需要跨 Session 持久化。", "Agent Memory"));
  claims.push(makeClaim("memory-b", "Long-term memory persists information beyond a single session.", "Agent Memory"));
  const result = await new ClaimGraphCandidateService().generate(claims);
  assert.equal(result.pairs.some((pair) =>
    [pair.leftClaimId, pair.rightClaimId].includes("memory-a") &&
    [pair.leftClaimId, pair.rightClaimId].includes("memory-b")
  ), true);
  assert.ok(result.pairs.length <= claims.length * CLAIM_GRAPH_MAX_CANDIDATES_PER_NODE);
  assert.ok(result.metrics.scoredPairs < claims.length * claims.length / 20);
});

test("candidate generation is deterministic", async () => {
  const claims = [
    makeClaim("a", "RAG may improve factual grounding.", "RAG"),
    makeClaim("b", "Retrieval augmented generation can improve grounding.", "RAG"),
    makeClaim("c", "Agent memory persists across sessions.", "Memory")
  ];
  const service = new ClaimGraphCandidateService();
  assert.deepEqual((await service.generate(claims)).pairs, (await service.generate(claims)).pairs);
});

function makeClaim(id: string, statement: string, topic: string): ClaimRecord {
  return {
    id, statement, normalizedStatement: normalizeClaim(statement), type: "fact", topic,
    status: "active", confidence: 0.9,
    provenance: [{ filePath: `Wiki/${id}.md`, fileHash: id.padEnd(64, "0").slice(0, 64), sourceKind: "wiki" }],
    createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z"
  };
}
