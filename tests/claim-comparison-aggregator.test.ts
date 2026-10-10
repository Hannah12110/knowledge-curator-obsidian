import test from "node:test";
import assert from "node:assert/strict";
import type {
  CandidateClaim,
  ClaimComparison,
  ClaimRecord
} from "../src/types/claim";
import type { LlmService } from "../src/services/llm-service";
import { normalizeClaim } from "../src/services/claim-identity";
import {
  CLAIM_COMPARISON_V1,
  ClaimComparisonService,
  ClaimComparisonServiceError,
  hasNumericalConflict,
  hasQualifierConflict,
  mapCoverageToRelation,
  validateAddDecision
} from "../src/services/claim-comparison-service";
import { ClaimValidationError } from "../src/services/claim-validator";
import { aggregateClaimAnalysis } from "../src/services/claim-analysis-aggregator";
import { VALID_ANALYSIS } from "./test-fixture";

function existing(id: string, statement: string): ClaimRecord {
  return {
    id,
    statement,
    normalizedStatement: normalizeClaim(statement),
    type: "fact",
    status: "active",
    confidence: 0.9,
    provenance: [{
      filePath: `KnowledgeCuratorPhase1Test/wiki/${id}.md`,
      fileHash: "hash",
      sourceKind: "wiki",
      accepted: true
    }],
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z"
  };
}

function candidate(id: string, statement: string): CandidateClaim {
  return {
    id,
    statement,
    normalizedStatement: normalizeClaim(statement),
    type: "fact",
    confidence: 0.9
  };
}

test("qualifier and numerical conflicts are detected deterministically", () => {
  assert.equal(
    hasQualifierConflict(
      candidate("q", "RAG always improves factual accuracy."),
      existing("e", "RAG may improve factual accuracy when retrieval quality is high.")
    ),
    true
  );
  assert.equal(
    hasNumericalConflict(
      candidate("n", "Benchmark pass rate is 92%."),
      existing("e", "Benchmark pass rate is 80% under Model A.")
    ),
    true
  );
});

test("comparison safety converts exact duplicates to reinforce and initial supersede to challenge", async () => {
  const same = existing("same", "Long-term memory persists across sessions.");
  const newer = candidate("candidate-same", same.statement);
  const llm = {
    requestJsonObject: async () => JSON.stringify({
      comparisons: [{
        candidateClaimId: newer.id,
        candidateStatement: newer.statement,
        relation: "supersede",
        existingClaimId: same.id,
        existingStatement: same.statement,
        similarity: 0.7,
        reasoning: "model output",
        confidence: 0.8
      }]
    })
  } as unknown as LlmService;
  const result = await new ClaimComparisonService(llm, () => same).compare([{
    candidate: newer,
    matches: [{ claimId: same.id, score: 1, reasons: ["exact"] }]
  }], CLAIM_COMPARISON_V1);
  assert.equal(result[0]?.relation, "reinforce");
  assert.equal(result[0]?.similarity, 1);
});

test("invalid comparison JSON retries exactly once", async () => {
  let calls = 0;
  const added = candidate("candidate-add", "A genuinely new atomic fact.");
  const llm = {
    requestJsonObject: async () => {
      calls += 1;
      return calls === 1
        ? "not-json"
        : JSON.stringify({ comparisons: [{
            candidateClaimId: added.id,
            candidateStatement: added.statement,
            relation: "add",
            reasoning: "No equivalent claim was retrieved.",
            confidence: 0.86
          }] });
    }
  } as unknown as LlmService;
  const result = await new ClaimComparisonService(llm, () => undefined).compare([{
    candidate: added,
    matches: []
  }], CLAIM_COMPARISON_V1);
  assert.equal(calls, 2);
  assert.equal(result[0]?.relation, "add");
});

test("aggregation excludes reinforce from newClaims and derives add/refine/challenge deterministically", () => {
  const claims = [
    candidate("reinforce", "Existing claim."),
    candidate("add", "New claim."),
    candidate("refine", "More precise claim."),
    candidate("challenge", "Conflicting claim.")
  ];
  const old = existing("old", "Old conflicting claim.");
  const comparisons: ClaimComparison[] = [
    { candidateClaimId: "reinforce", candidateStatement: "Existing claim.", relation: "reinforce", existingClaimId: "old", reasoning: "same", confidence: 0.9 },
    { candidateClaimId: "add", candidateStatement: "New claim.", relation: "add", reasoning: "new", confidence: 0.9 },
    { candidateClaimId: "refine", candidateStatement: "More precise claim.", relation: "refine", existingClaimId: "old", reasoning: "scope", confidence: 0.8 },
    { candidateClaimId: "challenge", candidateStatement: "Conflicting claim.", relation: "challenge", existingClaimId: "old", reasoning: "conflict", confidence: 0.8 }
  ];
  const result = aggregateClaimAnalysis({
    legacy: VALID_ANALYSIS,
    candidateClaims: claims,
    comparisons,
    getExistingClaim: () => old
  });
  assert.deepEqual(result.newClaims.map((claim) => claim.statement), ["New claim.", "More precise claim."]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.claimAnalysis?.coverage, 0.25);
  assert.equal(result.recommendation, "review");
});

test("false-new prevention: a reinforce-only source has no new claims", () => {
  const known = candidate("known", "Agent long-term memory persists beyond one session.");
  const result = aggregateClaimAnalysis({
    legacy: VALID_ANALYSIS,
    candidateClaims: [known],
    comparisons: [{
      candidateClaimId: known.id,
      candidateStatement: known.statement,
      relation: "reinforce",
      existingClaimId: "existing",
      reasoning: "same semantic claim",
      confidence: 0.94
    }],
    getExistingClaim: () => existing("existing", "Long-term memory persists information across sessions.")
  });
  assert.deepEqual(result.newClaims, []);
  assert.equal(result.knowledgeGain, "none");
  assert.equal(result.recommendation, "reject");
});

function coverageJson(input: {
  candidateId: string;
  coverage: "none" | "partial" | "full" | "conflicting";
  coveredBy?: string[];
  covered?: string[];
  uncovered?: string[];
  conflicts?: string[];
  pairwise?: Array<{ claimId: string; relation: "equivalent" | "existing_broader" | "candidate_broader" | "overlap" | "conflict" | "unrelated" }>;
  confidence?: number;
}): string {
  return JSON.stringify({
    coverages: [{
      candidateClaimId: input.candidateId,
      coreAspects: ["core"],
      coverage: input.coverage,
      coveredBy: input.coveredBy ?? [],
      coveredAspects: input.covered ?? [],
      uncoveredAspects: input.uncovered ?? [],
      conflictingAspects: input.conflicts ?? [],
      pairwise: (input.pairwise ?? []).map((pair) => ({
        ...pair,
        coveredAspects: pair.relation === "unrelated" ? [] : ["core"],
        conflictingAspects: pair.relation === "conflict" ? ["core"] : [],
        reasoning: "fixture"
      })),
      reasoning: "fixture coverage",
      confidence: input.confidence ?? 0.88
    }]
  });
}

async function compareCoverage(
  next: CandidateClaim,
  claims: ClaimRecord[],
  response: string
): Promise<ClaimComparison> {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const llm = { requestJsonObject: async () => response } as unknown as LlmService;
  const result = await new ClaimComparisonService(llm, (id) => byId.get(id)).compare([{
    candidate: next,
    matches: claims.map((claim) => ({ claimId: claim.id, score: 0.8, reasons: ["fixture"] }))
  }]);
  return result[0]!;
}

test("equivalent and existing-broader coverage map to reinforce", async () => {
  const known = existing("known", "Harness manages context, tools, and recovery.");
  const next = candidate("next", "Harness manages tool execution.");
  const result = await compareCoverage(next, [known], coverageJson({
    candidateId: next.id,
    coverage: "full",
    coveredBy: [known.id],
    covered: ["tool execution"],
    pairwise: [{ claimId: known.id, relation: "existing_broader" }]
  }));
  assert.equal(result.relation, "reinforce");
  assert.equal(result.coverage?.coverage, "full");
});

test("candidate-broader and multi-claim partial coverage map to refine", async () => {
  const context = existing("context", "Harness manages context.");
  const tools = existing("tools", "Harness organizes tool execution.");
  const next = candidate("next", "Harness manages context, tools, recovery, and cost budgets.");
  const result = await compareCoverage(next, [context, tools], coverageJson({
    candidateId: next.id,
    coverage: "partial",
    coveredBy: [context.id, tools.id],
    covered: ["context", "tools"],
    uncovered: ["recovery", "cost budgets"],
    pairwise: [
      { claimId: context.id, relation: "candidate_broader" },
      { claimId: tools.id, relation: "candidate_broader" }
    ]
  }));
  assert.equal(result.relation, "refine");
  assert.deepEqual(result.coverage?.coveredBy, ["context", "tools"]);
});

test("multiple claims can jointly provide full coverage", async () => {
  const context = existing("context", "Harness manages context.");
  const tools = existing("tools", "Harness organizes tool execution.");
  const recovery = existing("recovery", "Harness includes retry and failure recovery.");
  const next = candidate("next", "Harness manages context, tool execution, and failure recovery.");
  const result = await compareCoverage(next, [context, tools, recovery], coverageJson({
    candidateId: next.id,
    coverage: "full",
    coveredBy: [context.id, tools.id, recovery.id],
    covered: ["context", "tools", "recovery"],
    pairwise: [
      { claimId: context.id, relation: "overlap" },
      { claimId: tools.id, relation: "overlap" },
      { claimId: recovery.id, relation: "overlap" }
    ]
  }));
  assert.equal(result.relation, "reinforce");
});

test("genuine none coverage maps to add", async () => {
  const known = existing("known", "Harness manages tool execution.");
  const next = candidate("next", "Prompt versions should be tested with staged experiments.");
  const result = await compareCoverage(next, [known], coverageJson({
    candidateId: next.id,
    coverage: "none",
    uncovered: ["staged prompt experiments"]
  }));
  assert.equal(result.relation, "add");
  assert.equal(result.existingClaimId, undefined);
});

test("qualifier, negation, and numerical guards prevent false reinforce", async () => {
  const cases = [
    [candidate("q", "RAG always improves factual accuracy."), existing("qe", "RAG may improve factual accuracy.")],
    [candidate("n", "Episodic memory is no longer useful."), existing("ne", "Episodic memory remains useful.")],
    [candidate("x", "Model A pass rate is 92%."), existing("xe", "Model A pass rate is 80%.")]
  ] as const;
  for (const [next, known] of cases) {
    const result = await compareCoverage(next, [known], coverageJson({
      candidateId: next.id,
      coverage: "full",
      coveredBy: [known.id],
      covered: ["core"],
      pairwise: [{ claimId: known.id, relation: "equivalent" }]
    }));
    assert.equal(result.relation, "challenge");
    assert.equal(result.coverage?.coverage, "conflicting");
    assert.ok((result.debug?.guardsTriggered.length ?? 0) > 0);
  }
});

test("relation confidence cannot exceed candidate or coverage confidence", async () => {
  const known = existing("known", "Long-term memory persists across sessions.");
  const next = { ...candidate("next", "Agent long-term memory persists beyond a session."), confidence: 0.62 };
  const result = await compareCoverage(next, [known], coverageJson({
    candidateId: next.id,
    coverage: "full",
    coveredBy: [known.id],
    covered: ["persistence"],
    pairwise: [{ claimId: known.id, relation: "equivalent" }],
    confidence: 0.91
  }));
  assert.equal(result.confidence, 0.62);
});

test("invalid coverage retries once and never falls back to ADD", async () => {
  let calls = 0;
  const known = existing("known", "Known claim.");
  const next = candidate("next", "Candidate claim.");
  const llm = {
    requestJsonObject: async () => {
      calls += 1;
      return "not-json";
    }
  } as unknown as LlmService;
  const service = new ClaimComparisonService(llm, () => known);
  await assert.rejects(service.compare([{
    candidate: next,
    matches: [{ claimId: known.id, score: 0.9, reasons: [] }]
  }]), ClaimComparisonServiceError);
  assert.equal(calls, 2);
});

test("coverage comparison batches large sources so valid JSON stays below provider output limits", async () => {
  const candidates = Array.from({ length: 25 }, (_, index) =>
    candidate(`batch-${index + 1}`, `Genuinely new claim ${index + 1}.`)
  );
  let calls = 0;
  const llm = {
    requestJsonObject: async () => {
      const batch = candidates.slice(calls * 6, calls * 6 + 6);
      calls += 1;
      return JSON.stringify({
        coverages: batch.map((item) => ({
          candidateClaimId: item.id,
          coreAspects: [item.statement],
          coverage: "none",
          coveredBy: [],
          coveredAspects: [],
          uncoveredAspects: [item.statement],
          conflictingAspects: [],
          pairwise: [],
          reasoning: "No supplied claim covers this knowledge.",
          confidence: 0.8
        }))
      });
    }
  } as unknown as LlmService;
  const service = new ClaimComparisonService(llm, () => undefined);
  const result = await service.compare(candidates.map((item) => ({ candidate: item, matches: [] })));
  assert.equal(calls, 5);
  assert.equal(result.length, 25);
  assert.equal(result.every((item) => item.relation === "add"), true);
  assert.equal(service.getLastMetrics()?.llmCalls, 5);
});

test("coverage/relation inconsistency is rejected by deterministic mapping", () => {
  assert.equal(mapCoverageToRelation("full"), "reinforce");
  assert.equal(mapCoverageToRelation("partial"), "refine");
  assert.equal(mapCoverageToRelation("conflicting"), "challenge");
  assert.equal(mapCoverageToRelation("none"), "add");
  assert.throws(() => validateAddDecision({
    candidateClaimId: "c",
    coverage: "partial",
    coreAspects: ["core"],
    coveredBy: ["e"],
    coveredAspects: ["known"],
    uncoveredAspects: ["new"],
    conflictingAspects: [],
    pairwise: [],
    reasoning: "partial",
    confidence: 0.8
  }, "add"), ClaimValidationError);
});
