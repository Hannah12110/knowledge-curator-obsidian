import type {
  CandidateClaim,
  ClaimComparison,
  ClaimCoverageResult,
  ClaimRecord,
  ClaimType
} from "../src/types/claim";
import type { LlmService } from "../src/services/llm-service";
import { normalizeClaim } from "../src/services/claim-identity";
import {
  CLAIM_COMPARISON_V1,
  CLAIM_COMPARISON_VERSION,
  ClaimComparisonService
} from "../src/services/claim-comparison-service";

export interface FixedComparisonCase {
  caseId: string;
  category: string;
  candidate: {
    id: string;
    statement: string;
    type: ClaimType;
    topic?: string;
    scope?: string[];
    qualifiers?: string[];
    confidence?: number;
  };
  existingClaims: Array<{
    id: string;
    statement: string;
    type: ClaimType;
    topic?: string;
    scope?: string[];
    qualifiers?: string[];
    score?: number;
  }>;
  comparisonV1: Record<string, unknown>;
  coverageV2: Omit<ClaimCoverageResult, "candidateClaimId">;
  expected: {
    allowedRelations: string[];
    allowedCoverage: string[];
    mustNotBe?: string[];
    knownClaim: boolean;
    excludeFromGate?: boolean;
    taxonomy?: string;
  };
}

export async function evaluateFixedComparisonCase(fixture: FixedComparisonCase): Promise<{
  v1: ClaimComparison;
  v2: ClaimComparison;
}> {
  const now = "2026-09-26T00:00:00.000Z";
  const existingClaims: ClaimRecord[] = fixture.existingClaims.map((claim) => ({
    id: claim.id,
    statement: claim.statement,
    normalizedStatement: normalizeClaim(claim.statement),
    type: claim.type,
    topic: claim.topic,
    scope: claim.scope,
    qualifiers: claim.qualifiers,
    status: "active",
    confidence: 0.9,
    provenance: [{
      filePath: `KnowledgeCuratorRegression/wiki/${claim.id}.md`,
      fileHash: `hash-${claim.id}`,
      sourceKind: "wiki",
      accepted: true
    }],
    createdAt: now,
    updatedAt: now
  }));
  const candidate: CandidateClaim = {
    ...fixture.candidate,
    normalizedStatement: normalizeClaim(fixture.candidate.statement),
    confidence: fixture.candidate.confidence ?? 0.9
  };
  const byId = new Map(existingClaims.map((claim) => [claim.id, claim]));
  const matches = fixture.existingClaims.map((claim, index) => ({
    claimId: claim.id,
    score: claim.score ?? Math.max(0.1, 0.9 - index * 0.1),
    reasons: ["fixed comparison fixture"]
  }));
  const v1Llm = {
    requestJsonObject: async () => JSON.stringify({
      comparisons: [{
        candidateClaimId: candidate.id,
        candidateStatement: candidate.statement,
        ...fixture.comparisonV1
      }]
    })
  } as unknown as LlmService;
  const v2Llm = {
    requestJsonObject: async () => JSON.stringify({
      coverages: [{
        candidateClaimId: candidate.id,
        ...fixture.coverageV2
      }]
    })
  } as unknown as LlmService;
  const input = [{ candidate, matches }];
  const v1 = await new ClaimComparisonService(v1Llm, (id) => byId.get(id))
    .compare(input, CLAIM_COMPARISON_V1);
  const v2 = await new ClaimComparisonService(v2Llm, (id) => byId.get(id))
    .compare(input, CLAIM_COMPARISON_VERSION);
  return { v1: v1[0]!, v2: v2[0]! };
}
