import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyClaimGraphStore,
  parseClaimGraphClassifications,
  validateClaimGraphStore,
  ClaimGraphValidationError
} from "../src/services/claim-graph-validator";

test("Claim Graph runtime validation accepts valid nodes, edges, and evidence", () => {
  const store = createEmptyClaimGraphStore("wiki:a");
  store.nodes.a = node("a", "A claim", "Wiki/A.md");
  store.nodes.b = node("b", "B claim", "Wiki/B.md");
  store.edges.e = {
    id: "e", fromClaimId: "a", toClaimId: "b", relation: "supports", confidence: 0.9,
    evidence: [{ claimId: "a", statement: "A claim", sourcePath: "Wiki/A.md", reason: "direct support" }],
    retrievalScore: 0.8, retrievalReasons: ["phrase"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  store.metadata.nodeCount = 2;
  store.metadata.edgeCount = 1;
  store.metadata.relationStats.supports = 1;
  store.metadata.buildMetadata.claimCount = 2;
  store.metadata.buildMetadata.persistedEdges = 1;
  const result = validateClaimGraphStore(store);
  assert.equal(result.edges.e?.relation, "supports");
});

test("Claim Graph rejects unknown claim IDs, invalid relation/confidence, and missing evidence", () => {
  const store = createEmptyClaimGraphStore("wiki:a");
  store.nodes.a = node("a", "A claim", "Wiki/A.md");
  const bad = structuredClone(store) as any;
  bad.edges.e = { id: "e", fromClaimId: "a", toClaimId: "missing", relation: "merge", confidence: 2, evidence: [] };
  assert.throws(() => validateClaimGraphStore(bad), ClaimGraphValidationError);
});

test("relation response must cover only allowed candidate pairs", () => {
  const allowed = new Map([["p", { leftClaimId: "a", rightClaimId: "b" }]]);
  const parsed = parseClaimGraphClassifications(JSON.stringify({ relations: [{
    pairId: "p", relation: "duplicate", direction: "symmetric", confidence: 0.95,
    reasoning: "equivalent", evidenceClaimIds: ["a", "b"]
  }] }), allowed);
  assert.equal(parsed[0]?.relation, "duplicate");
  assert.throws(() => parseClaimGraphClassifications(JSON.stringify({ relations: [] }), allowed));
});

function node(claimId: string, statement: string, sourcePath: string) {
  return { claimId, statement, sourcePath, createdAt: new Date().toISOString(), claimFingerprint: "a".repeat(64), status: "active" as const };
}
