import test from "node:test";
import assert from "node:assert/strict";
import type {
  CandidateClaim,
  ClaimRecord,
  ClaimRetrievalFeatures,
  ClaimRetrievalMatch,
  ClaimType
} from "../src/types/claim";
import {
  ClaimComparisonFastPath,
  validateFastPathDecision
} from "../src/services/claim-comparison-fast-path";
import { normalizeClaim } from "../src/services/claim-identity";

const STRONG_FEATURES: ClaimRetrievalFeatures = {
  lexicalScore: 0.96,
  tokenOverlap: 0.96,
  phraseScore: 0.92,
  topicScore: 0.8,
  typeScore: 1,
  qualifierScore: 1,
  acronymScore: 0,
  aliasScore: 0,
  provenanceScore: 0.2,
  negationScore: 1,
  numericScore: 1,
  versionScore: 1
};
let candidateSequence = 0;

function candidate(
  statement: string,
  type: ClaimType = "fact",
  overrides: Partial<CandidateClaim> = {}
): CandidateClaim {
  return {
    id: overrides.id ?? `candidate-${candidateSequence += 1}`,
    statement,
    normalizedStatement: normalizeClaim(statement),
    type,
    confidence: 0.94,
    ...overrides
  };
}

function existing(
  id: string,
  statement: string,
  type: ClaimType = "fact",
  overrides: Partial<ClaimRecord> = {}
): ClaimRecord {
  return {
    id,
    statement,
    normalizedStatement: normalizeClaim(statement),
    type,
    status: "active",
    confidence: 0.93,
    provenance: [{
      filePath: `KnowledgeCuratorRegression/wiki/${id}.md`,
      fileHash: `${id}-hash`,
      sourceKind: "wiki",
      accepted: true
    }],
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    ...overrides
  };
}

function match(claimId: string, overrides: Partial<ClaimRetrievalMatch> = {}): ClaimRetrievalMatch {
  return {
    claimId,
    score: 0.97,
    reasons: ["controlled-regression"],
    features: STRONG_FEATURES,
    ...overrides
  };
}

function evaluate(next: CandidateClaim, claims: ClaimRecord[], matches?: ClaimRetrievalMatch[]) {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  return new ClaimComparisonFastPath((id) => byId.get(id)).evaluate({
    candidate: next,
    matches: matches ?? claims.map((claim) => match(claim.id))
  });
}

test("Fast Path exact and punctuation-equivalent claims safely reinforce", () => {
  for (const [left, right] of [
    ["Long-term memory persists across sessions.", "Long-term memory persists across sessions."],
    ["长期记忆，需要跨 Session 持久化。", "长期记忆需要跨 Session 持久化"]
  ]) {
    const known = existing("known", right);
    const result = evaluate(candidate(left), [known]);
    assert.equal(result?.coverage.coverage, "full");
    assert.deepEqual(result?.coverage.coveredBy, [known.id]);
  }
});

test("Fast Path handles controlled bilingual and acronym definition equivalents", () => {
  const cases = [
    [
      candidate("Long-term memory uses persistent storage across sessions.", "definition"),
      existing("memory", "长期记忆使用持久化存储跨会话保存信息。", "definition")
    ],
    [
      candidate("RAG means retrieval augmented generation.", "definition"),
      existing("rag", "检索增强生成（RAG）即 retrieval augmented generation。", "definition")
    ]
  ] as const;
  for (const [next, known] of cases) {
    const result = evaluate(next, [known]);
    assert.equal(result?.coverage.coverage, "full");
    assert.match(result?.guardsTriggered[0] ?? "", /alias|lexical|exact/u);
  }
});

test("Fast Path detects obvious numerical, negation, and qualifier conflicts", () => {
  const cases = [
    [candidate("Model A reaches 92% on Benchmark X.", "quantitative"), existing("number", "Model A reaches 80% on Benchmark X.", "quantitative")],
    [candidate("Episodic memory is no longer useful in modern agents."), existing("negation", "Episodic memory remains useful in modern agents.")],
    [candidate("RAG always improves factual accuracy."), existing("qualifier", "RAG may improve factual accuracy.")]
  ] as const;
  for (const [next, known] of cases) {
    const result = evaluate(next, [known]);
    assert.equal(result?.coverage.coverage, "conflicting");
    assert.match(result?.guardsTriggered[0] ?? "", /conflict/u);
  }
});

test("Fast Path falls back for broader, scoped, multi-claim, genuine-new, and uncertain cases", () => {
  const fallbackCases: Array<{ next: CandidateClaim; claims: ClaimRecord[]; matches?: ClaimRetrievalMatch[] }> = [
    {
      next: candidate("Harness manages context, tools, and failure recovery."),
      claims: [existing("broader", "Harness manages tools.")]
    },
    {
      next: candidate("Agent memory uses episodic taxonomy.", "fact", { scope: ["production"] }),
      claims: [existing("scope", "Agent memory uses episodic taxonomy.", "fact", { scope: ["research"] })]
    },
    {
      next: candidate("Harness manages context and tool execution."),
      claims: [existing("context", "Harness manages context."), existing("tools", "Harness manages tool execution.")],
      matches: [match("context", { score: 0.7 }), match("tools", { score: 0.69 })]
    },
    {
      next: candidate("Harness needs staged prompt-version experiments."),
      claims: [existing("unrelated", "Harness manages tool execution.")],
      matches: [match("unrelated", { score: 0.05, features: { ...STRONG_FEATURES, lexicalScore: 0.05, tokenOverlap: 0.05, phraseScore: 0 } })]
    },
    {
      next: candidate("A concrete framework uses retry queues for recovery."),
      claims: [existing("general", "Harness may contain failure recovery.")],
      matches: [match("general", { score: 0.52, features: { ...STRONG_FEATURES, lexicalScore: 0.5, tokenOverlap: 0.45, phraseScore: 0.3 } })]
    }
  ];
  for (const item of fallbackCases) {
    assert.equal(evaluate(item.next, item.claims, item.matches), null);
  }
});

test("Fast Path validation rejects incomplete or non-safe coverage", () => {
  assert.throws(() => validateFastPathDecision({
    candidateClaimId: "candidate",
    coverage: "partial",
    coreAspects: ["a"],
    coveredBy: ["known"],
    coveredAspects: ["a"],
    uncoveredAspects: ["b"],
    conflictingAspects: [],
    pairwise: [],
    reasoning: "partial",
    confidence: 0.8
  }), /只允许安全/u);
});
