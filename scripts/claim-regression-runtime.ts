import type {
  CandidateClaim,
  ClaimRetrievalDebug,
  ClaimRecord,
  ClaimType
} from "../src/types/claim";
import type { LlmService } from "../src/services/llm-service";
import { normalizeClaim } from "../src/services/claim-identity";
import {
  CLAIM_RETRIEVAL_V1,
  CLAIM_RETRIEVAL_VERSION,
  ClaimRetrievalService
} from "../src/services/claim-retrieval-service";
import {
  CLAIM_COMPARISON_V1,
  ClaimComparisonService
} from "../src/services/claim-comparison-service";

export interface ClaimRegressionInput {
  candidate: {
    id: string;
    statement: string;
    type: ClaimType;
    topic?: string;
    scope?: string[];
    qualifiers?: string[];
  };
  existingClaims: Array<{
    id: string;
    statement: string;
    type: ClaimType;
    topic?: string;
    scope?: string[];
    qualifiers?: string[];
  }>;
  topK?: number;
}

export async function evaluateClaimCase(
  input: ClaimRegressionInput,
  providerComparison: Record<string, unknown>
): Promise<{
  retrievedClaimIds: string[];
  v1RetrievedClaimIds: string[];
  relation: string;
  retrievalDebug: ClaimRetrievalDebug;
}> {
  const now = "2026-09-25T00:00:00.000Z";
  const existingClaims: ClaimRecord[] = input.existingClaims.map((claim) => ({
    ...claim,
    normalizedStatement: normalizeClaim(claim.statement),
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
    ...input.candidate,
    normalizedStatement: normalizeClaim(input.candidate.statement),
    confidence: 0.9
  };
  const claimsById = new Map(existingClaims.map((claim) => [claim.id, claim]));
  const retrieval = new ClaimRetrievalService(() => existingClaims);
  const v1Matches = retrieval.retrieve(candidate, input.topK ?? 5, CLAIM_RETRIEVAL_V1);
  const v2Result = retrieval.retrieveWithDebug(
    candidate,
    input.topK ?? 5,
    CLAIM_RETRIEVAL_VERSION
  );
  const matches = v2Result.matches;
  const llm = {
    requestJsonObject: async () => JSON.stringify({
      comparisons: [{
        candidateClaimId: candidate.id,
        candidateStatement: candidate.statement,
        ...providerComparison
      }]
    })
  } as unknown as LlmService;
  const comparisons = await new ClaimComparisonService(
    llm,
    (id) => claimsById.get(id)
  ).compare([{ candidate, matches }], CLAIM_COMPARISON_V1);
  return {
    retrievedClaimIds: matches.map((match) => match.claimId),
    v1RetrievedClaimIds: v1Matches.map((match) => match.claimId),
    relation: comparisons[0]?.relation ?? "missing",
    retrievalDebug: v2Result.debug
  };
}
