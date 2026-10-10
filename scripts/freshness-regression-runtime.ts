import type { ClaimRecord } from "../src/types/claim";
import { FreshnessRiskService } from "../src/services/freshness-risk-service";
import { parseFreshnessVerificationProposal } from "../src/services/freshness-verification-validator";
import type { RankedSearchResult, SourceTier } from "../src/types/verification";

export async function evaluateRiskCase(input: any) {
  const claim: ClaimRecord = {
    id: input.caseId,
    statement: input.statement,
    normalizedStatement: input.statement.toLowerCase(),
    type: input.type,
    status: input.status ?? "active",
    confidence: 0.9,
    provenance: [{ filePath: "KnowledgeCuratorRegression/wiki/Freshness.md", fileHash: "a".repeat(64), sourceKind: "wiki", accepted: true }],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z"
  };
  return await new FreshnessRiskService().assess({ claim, sourceModified: Date.UTC(2024, 0, 1), previousResolution: input.previousResolution, now: new Date("2026-09-27T00:00:00.000Z") });
}

export function evaluateVerificationCase(input: any) {
  const source = rankedSource(input.tier);
  const evidence = input.resolution === "insufficient_evidence" ? [] : [{
    id: "e1", title: source.title, url: source.url, sourceTier: source.score.tier,
    sourceType: input.tier === 0 ? "official" : input.tier === 1 ? "research" : input.tier === 2 ? "repository" : "community",
    supports: input.resolution === "stale" ? "neither" : "existing",
    reasoning: "fixture evidence", confidence: 0.9
  }];
  const statement = input.historical ? "2024 年 Product X 支持 128K。" : "Product X 当前支持 128K。";
  const result = parseFreshnessVerificationProposal({
    response: JSON.stringify({ resolution: input.resolution, conclusion: "fixture conclusion", reasoning: "fixture reasoning", confidence: 0.85, evidence }),
    claimId: input.caseId, claimFingerprint: "b".repeat(64), statement,
    allowedSources: input.resolution === "insufficient_evidence" ? [] : [source], verifiedAt: "2026-09-27T00:00:00.000Z"
  });
  return {
    resolution: result.resolution,
    unsafeReplace: result.resolution !== "stale" && maintenanceChangeType(result.resolution) === "replace"
  };
}

function maintenanceChangeType(resolution: string): string | null {
  if (resolution === "stale") return "replace";
  if (resolution === "needs_refinement") return "refine";
  return null;
}

function rankedSource(tier: SourceTier): RankedSearchResult {
  const map: Record<number, { url: string; type: string }> = {
    0: { url: "https://platform.openai.com/docs/current", type: "official" },
    1: { url: "https://research.example.edu/report", type: "research" },
    2: { url: "https://github.com/example/project", type: "repository" },
    3: { url: "https://medium.com/example/post", type: "community" },
    4: { url: "https://facebook.com/example/post", type: "community" }
  };
  const selected = map[tier]!;
  return {
    title: `Fixture source tier ${tier}`, url: selected.url, domain: new URL(selected.url).hostname,
    score: { tier, authority: 1 - tier * 0.2, relevance: 1, recency: 1, primarySource: tier <= 1, independence: 1, reason: "fixture" }
  };
}
