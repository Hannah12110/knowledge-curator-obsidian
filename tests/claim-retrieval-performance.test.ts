import test from "node:test";
import assert from "node:assert/strict";
import type { CandidateClaim, ClaimRecord } from "../src/types/claim";
import { normalizeClaim } from "../src/services/claim-identity";
import { ClaimRetrievalService } from "../src/services/claim-retrieval-service";

function makeClaims(size: number): ClaimRecord[] {
  return Array.from({ length: size }, (_, index) => {
    const statement = index % 2 === 0
      ? `Long-term memory persists across session ${index}.`
      : `RAG improves grounding for dataset ${index}.`;
    return {
      id: `claim-${index}`,
      statement,
      normalizedStatement: normalizeClaim(statement),
      type: "fact",
      topic: index % 2 === 0 ? "Agent Memory" : "RAG",
      status: "active",
      confidence: 0.9,
      provenance: [{ filePath: `Test/${index}.md`, fileHash: `hash-${index}`, sourceKind: "wiki" }],
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z"
    };
  });
}

const candidate: CandidateClaim = {
  id: "candidate",
  statement: "Long-term agent memory stores information beyond a session.",
  normalizedStatement: normalizeClaim("Long-term agent memory stores information beyond a session."),
  type: "fact",
  topic: "Agent Memory",
  confidence: 0.9
};

test("retrieval remains deterministic and bounded at 1k, 5k, and 10k Claims", () => {
  for (const size of [1_000, 5_000, 10_000]) {
    const claims = makeClaims(size);
    const service = new ClaimRetrievalService(() => claims);
    const first = service.retrieve(candidate, 5);
    const second = service.retrieve(candidate, 5);
    assert.equal(first.length, 5);
    assert.deepEqual(first, second);
  }
});
