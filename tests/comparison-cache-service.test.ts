import test from "node:test";
import assert from "node:assert/strict";
import type { CandidateClaim, ClaimComparison, ClaimRecord } from "../src/types/claim";
import {
  ComparisonCacheService,
  buildComparisonCacheIdentity,
  createComparisonCacheEntry
} from "../src/services/comparison-cache-service";
import { normalizeClaim } from "../src/services/claim-identity";

function candidate(statement = "Long-term memory persists across sessions."): CandidateClaim {
  return {
    id: "candidate-memory",
    statement,
    normalizedStatement: normalizeClaim(statement),
    type: "fact",
    scope: ["agent memory"],
    qualifiers: ["usually"],
    confidence: 0.9
  };
}

function existing(statement = "Long-term memory persists across sessions."): ClaimRecord {
  return {
    id: "claim-memory",
    statement,
    normalizedStatement: normalizeClaim(statement),
    type: "fact",
    scope: ["agent memory"],
    qualifiers: ["usually"],
    status: "active",
    confidence: 0.9,
    provenance: [{
      filePath: "KnowledgeCuratorPhase1Test/wiki/Memory.md",
      fileHash: "wiki-hash-v1",
      sourceKind: "wiki",
      accepted: true
    }],
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z"
  };
}

function comparison(): ClaimComparison {
  return {
    candidateClaimId: "candidate-memory",
    candidateStatement: "Long-term memory persists across sessions.",
    relation: "reinforce",
    existingClaimId: "claim-memory",
    existingStatement: "Long-term memory persists across sessions.",
    reasoning: "exact",
    confidence: 0.9,
    coverage: {
      candidateClaimId: "candidate-memory",
      coverage: "full",
      coreAspects: ["memory persists"],
      coveredBy: ["claim-memory"],
      coveredAspects: ["memory persists"],
      uncoveredAspects: [],
      conflictingAspects: [],
      pairwise: [{
        claimId: "claim-memory",
        relation: "equivalent",
        coveredAspects: ["memory persists"],
        conflictingAspects: [],
        reasoning: "exact"
      }],
      reasoning: "exact",
      confidence: 0.9
    },
    debug: {
      comparisonVersion: "claim-comparison-v2",
      executionMode: "fast_path",
      candidate: "Long-term memory persists across sessions.",
      topClaims: [{
        id: "claim-memory",
        statement: "Long-term memory persists across sessions.",
        pairwiseRelation: "equivalent"
      }],
      coverage: {
        candidateClaimId: "candidate-memory",
        coverage: "full",
        coreAspects: ["memory persists"],
        coveredBy: ["claim-memory"],
        coveredAspects: ["memory persists"],
        uncoveredAspects: [],
        conflictingAspects: [],
        pairwise: [{
          claimId: "claim-memory",
          relation: "equivalent",
          coveredAspects: ["memory persists"],
          conflictingAspects: [],
          reasoning: "exact"
        }],
        reasoning: "exact",
        confidence: 0.9
      },
      finalRelation: "reinforce",
      confidence: 0.9,
      guardsTriggered: ["fast-path-exact"]
    }
  };
}

async function identity(overrides: Partial<{
  candidate: CandidateClaim;
  claim: ClaimRecord;
  retrievalVersion: string;
  comparisonVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
}> = {}) {
  const known = overrides.claim ?? existing();
  return await buildComparisonCacheIdentity({
    candidate: overrides.candidate ?? candidate(),
    matches: [{ claimId: known.id, score: 1, reasons: ["exact"] }],
    getClaim: () => known,
    retrievalVersion: overrides.retrievalVersion ?? "claim-retrieval-v2",
    comparisonVersion: overrides.comparisonVersion ?? "claim-comparison-v2",
    promptVersion: overrides.promptVersion ?? "claim-coverage-prompt-v1",
    provider: overrides.provider ?? "api.deepseek.com",
    model: overrides.model ?? "deepseek-flash"
  });
}

test("Comparison Cache stores and restores a validated candidate-level result", async () => {
  let persisted = {};
  const cache = new ComparisonCacheService({}, async (value) => { persisted = value; });
  const key = await identity();
  await cache.setMany([createComparisonCacheEntry({ ...key, comparison: comparison() })]);
  assert.equal(cache.get(key.key)?.comparison.relation, "reinforce");
  assert.equal(Object.keys(persisted).length, 1);
});

test("candidate, Existing Claim, versions, prompt, provider, and model changes invalidate keys", async () => {
  const base = (await identity()).key;
  const changed = [
    (await identity({ candidate: candidate("Memory persists outside one session.") })).key,
    (await identity({ claim: existing("Memory may persist across sessions.") })).key,
    (await identity({ retrievalVersion: "claim-retrieval-v3" })).key,
    (await identity({ comparisonVersion: "claim-comparison-v3" })).key,
    (await identity({ promptVersion: "claim-coverage-prompt-v2" })).key,
    (await identity({ provider: "another.example.com" })).key,
    (await identity({ model: "another-model" })).key
  ];
  assert.equal(new Set([base, ...changed]).size, 8);
});

test("Comparison Cache evicts oldest entries and ignores corrupt persisted data", async () => {
  const cache = new ComparisonCacheService({ broken: { schemaVersion: 1 } }, async () => undefined, 2);
  const identities = await Promise.all([
    identity({ candidate: candidate("A") }),
    identity({ candidate: candidate("B") }),
    identity({ candidate: candidate("C") })
  ]);
  await cache.setMany(identities.map((entry, index) => createComparisonCacheEntry({
    ...entry,
    comparison: comparison(),
    createdAt: `2026-09-26T00:00:0${index}.000Z`
  })));
  assert.equal(cache.size(), 2);
  assert.equal(cache.get(identities[0]!.key), null);
  assert.notEqual(cache.get(identities[2]!.key), null);
});

test("clearing Comparison Cache changes only plugin-derived state", async () => {
  const cache = new ComparisonCacheService({}, async () => undefined);
  const key = await identity();
  await cache.setMany([createComparisonCacheEntry({ ...key, comparison: comparison() })]);
  assert.equal(await cache.clear(), 1);
  assert.equal(cache.size(), 0);
});
