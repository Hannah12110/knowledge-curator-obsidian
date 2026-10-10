import assert from "node:assert/strict";
import test from "node:test";
import { parseFreshnessVerificationProposal, FreshnessVerificationValidationError } from "../src/services/freshness-verification-validator";
import type { RankedSearchResult } from "../src/types/verification";

const official: RankedSearchResult = {
  title: "Official API Documentation",
  url: "https://platform.openai.com/docs/api-reference/current",
  snippet: "The current API supports feature B.",
  publishedAt: "2026-09-01T00:00:00.000Z",
  domain: "platform.openai.com",
  score: { tier: 0, authority: 1, relevance: 1, recency: 1, primarySource: true, independence: 1, reason: "official" }
};
const community: RankedSearchResult = {
  title: "Community Post",
  url: "https://medium.com/example/post",
  snippet: "A claim from a blog.",
  domain: "medium.com",
  score: { tier: 3, authority: 0.45, relevance: 0.8, recency: 1, primarySource: false, independence: 1, reason: "community" }
};

for (const resolution of ["still_valid", "needs_refinement", "stale", "disputed", "insufficient_evidence"] as const) {
  test(`freshness verification validates ${resolution}`, () => {
    const evidence = resolution === "insufficient_evidence" ? [] : [evidenceJson(official, resolution === "stale" ? "neither" : "existing")];
    const result = parseFreshnessVerificationProposal({
      response: JSON.stringify({ resolution, conclusion: "结论", reasoning: "基于当前证据。", confidence: 0.8, evidence }),
      claimId: "claim-test",
      claimFingerprint: "a".repeat(64),
      statement: "Product X 当前只支持 Feature A。",
      allowedSources: [official]
    });
    assert.equal(result.resolution, resolution);
  });
}

test("freshness evidence URL must belong to current search allowlist", () => {
  assert.throws(() => parseFreshnessVerificationProposal({
    response: JSON.stringify({ resolution: "still_valid", conclusion: "x", reasoning: "x", confidence: 0.8, evidence: [{ ...evidenceJson(official, "existing"), url: "https://evil.example/fake" }] }),
    claimId: "c", claimFingerprint: "b".repeat(64), statement: "Current claim", allowedSources: [official]
  }), FreshnessVerificationValidationError);
});

test("Tier 3 evidence cannot mark a claim stale", () => {
  assert.throws(() => parseFreshnessVerificationProposal({
    response: JSON.stringify({ resolution: "stale", conclusion: "x", reasoning: "x", confidence: 0.8, evidence: [evidenceJson(community, "neither")] }),
    claimId: "c", claimFingerprint: "b".repeat(64), statement: "Current claim", allowedSources: [community]
  }), /Tier 0\/1/u);
});

test("historical scoped claim cannot be marked stale", () => {
  assert.throws(() => parseFreshnessVerificationProposal({
    response: JSON.stringify({ resolution: "stale", conclusion: "x", reasoning: "x", confidence: 0.8, evidence: [evidenceJson(official, "neither")] }),
    claimId: "c", claimFingerprint: "b".repeat(64), statement: "2024 年 Product X 支持 128K。", allowedSources: [official]
  }), /历史范围/u);
});

function evidenceJson(source: RankedSearchResult, supports: string) {
  const isOfficial = source.score.tier === 0;
  return { id: "e-1", title: source.title, url: source.url, sourceTier: source.score.tier, sourceType: isOfficial ? "official" : "community", supports, excerpt: source.snippet, reasoning: "direct", confidence: 0.9 };
}

