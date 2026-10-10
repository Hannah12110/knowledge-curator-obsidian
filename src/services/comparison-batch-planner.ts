import type { ClaimRecord } from "../types/claim";
import type { CandidateWithMatches } from "./claim-comparison-service";

export const COMPARISON_BATCH_LIMITS = {
  maxCandidates: 6,
  // Six ordinary candidates remain below this budget; unusually long Top-K
  // context is split before it approaches the provider's JSON output limit.
  maxEstimatedCost: 20_000,
  perCandidateOutputChars: 1_250,
  batchEnvelopeChars: 700
} as const;

export function estimateComparisonBatchCost(
  item: CandidateWithMatches,
  getClaim: (id: string) => ClaimRecord | undefined
): number {
  const candidateChars = JSON.stringify({
    statement: item.candidate.statement,
    type: item.candidate.type,
    topic: item.candidate.topic,
    scope: item.candidate.scope,
    qualifiers: item.candidate.qualifiers
  }).length;
  const existingChars = item.matches.reduce((total, match) => {
    const claim = getClaim(match.claimId);
    if (claim === undefined) return total;
    return total + JSON.stringify({
      statement: claim.statement,
      type: claim.type,
      topic: claim.topic,
      scope: claim.scope,
      qualifiers: claim.qualifiers,
      provenance: claim.provenance.map((item) => ({ filePath: item.filePath, heading: item.heading }))
    }).length;
  }, 0);
  return candidateChars + existingChars + COMPARISON_BATCH_LIMITS.perCandidateOutputChars;
}

export function planComparisonBatches(
  input: CandidateWithMatches[],
  getClaim: (id: string) => ClaimRecord | undefined
): CandidateWithMatches[][] {
  const batches: CandidateWithMatches[][] = [];
  let current: CandidateWithMatches[] = [];
  let currentCost = COMPARISON_BATCH_LIMITS.batchEnvelopeChars;
  for (const item of input) {
    const cost = estimateComparisonBatchCost(item, getClaim);
    const exceedsCount = current.length >= COMPARISON_BATCH_LIMITS.maxCandidates;
    const exceedsBudget = current.length > 0 && currentCost + cost > COMPARISON_BATCH_LIMITS.maxEstimatedCost;
    if (exceedsCount || exceedsBudget) {
      batches.push(current);
      current = [];
      currentCost = COMPARISON_BATCH_LIMITS.batchEnvelopeChars;
    }
    current.push(item);
    currentCost += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
