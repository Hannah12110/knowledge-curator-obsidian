import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVerificationResult,
  parseVerificationProposal,
  VerificationValidationError
} from "../src/services/verification-validator";
import type { RankedSearchResult } from "../src/types/verification";

const SOURCES: RankedSearchResult[] = [{
  title: "Agent Memory Official Documentation",
  url: "https://openai.com/docs/agent-memory",
  snippet: "Two taxonomies describe different dimensions.",
  domain: "openai.com",
  score: {
    tier: 0,
    authority: 1,
    relevance: 0.9,
    primarySource: true,
    independence: 1,
    reason: "official"
  }
}];

function proposal(resolution: "supersede" | "refine" | "unresolved") {
  return {
    resolution,
    conclusion: "两种分类描述不同维度。",
    reasoning: "官方证据同时描述了两种维度。",
    confidence: 0.88,
    evidence: [{
      id: "evidence-1",
      title: SOURCES[0]!.title,
      url: SOURCES[0]!.url,
      sourceTier: 0,
      sourceType: "official",
      supports: "both",
      excerpt: "Two taxonomies describe different dimensions.",
      reasoning: "同时支持两种分类。",
      confidence: 0.91
    }]
  };
}

for (const resolution of ["supersede", "refine", "unresolved"] as const) {
  test(`validates ${resolution} verification output`, () => {
    const parsed = parseVerificationProposal(JSON.stringify(proposal(resolution)), SOURCES);
    const result = buildVerificationResult("conflict-1", parsed, "2026-09-25T00:00:00.000Z");
    assert.equal(result.resolution, resolution);
    assert.equal(result.status, "verified");
    assert.equal(result.evidence.length, 1);
  });
}

test("rejects invalid JSON, confidence, URL, tier, and empty evidence", () => {
  assert.throws(
    () => parseVerificationProposal("not-json", SOURCES),
    VerificationValidationError
  );
  assert.throws(
    () => parseVerificationProposal(JSON.stringify({ ...proposal("refine"), confidence: 2 }), SOURCES),
    /0～1/u
  );
  const badUrl = proposal("refine");
  badUrl.evidence[0]!.url = "https://untrusted.example/invented";
  assert.throws(() => parseVerificationProposal(JSON.stringify(badUrl), SOURCES), /不在搜索结果/u);
  const badTier = proposal("refine");
  badTier.evidence[0]!.sourceTier = 3;
  assert.throws(() => parseVerificationProposal(JSON.stringify(badTier), SOURCES), /来源策略/u);
  assert.throws(
    () => parseVerificationProposal(JSON.stringify({ ...proposal("refine"), evidence: [] }), SOURCES),
    /1～5/u
  );
});
