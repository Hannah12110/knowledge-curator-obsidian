import type { CandidateClaim, ClaimRecord } from "../src/types/claim";
import { ClaimRetrievalService, CLAIM_RETRIEVAL_VERSION } from "../src/services/claim-retrieval-service";

export function retrieveAuditRows(candidates: CandidateClaim[], claims: ClaimRecord[], topK = 5): Array<{
  candidate: CandidateClaim;
  topClaims: Array<{ id: string; statement: string; score: number; reasons: string[] }>;
}> {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const service = new ClaimRetrievalService(() => claims);
  return candidates.map((candidate) => ({
    candidate,
    topClaims: service.retrieve(candidate, topK, CLAIM_RETRIEVAL_VERSION).flatMap((match) => {
      const claim = byId.get(match.claimId);
      return claim === undefined ? [] : [{
        id: claim.id,
        statement: claim.statement,
        score: match.score,
        reasons: match.reasons
      }];
    })
  }));
}
