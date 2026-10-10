import type { CandidateClaim, ClaimRecord } from "../types/claim";
import type { ClaimGraphCandidatePair } from "../types/claim-graph";
import { buildClaimRetrievalSignals, scoreClaim } from "./claim-retrieval-service";
import { sha256Text } from "./content-hash";

export const CLAIM_GRAPH_MAX_CANDIDATES_PER_NODE = 8;
export const CLAIM_GRAPH_MAX_POSTING_SCAN = 32;
export const CLAIM_GRAPH_MIN_CANDIDATE_SCORE = 0.11;
export const CLAIM_GRAPH_MAX_TOTAL_PAIRS = 500;

export interface ClaimGraphCandidateMetrics {
  claims: number;
  invertedKeys: number;
  candidatePairs: number;
  rawScoredPairs: number;
  scoredPairs: number;
  candidatePairRatio: number;
  durationMs: number;
}

export interface ClaimGraphCandidateResult {
  pairs: ClaimGraphCandidatePair[];
  metrics: ClaimGraphCandidateMetrics;
}

/**
 * Sparse graph candidate generation. It reuses Retrieval v2 signals, builds an
 * inverted index once, and scores only bounded posting-list neighbors. This is
 * O(claims * bounded signals/candidates), not an all-pairs comparison.
 */
export class ClaimGraphCandidateService {
  async generate(claims: ClaimRecord[]): Promise<ClaimGraphCandidateResult> {
    const started = Date.now();
    const active = claims
      .filter((claim) => claim.status === "active" || claim.status === "disputed")
      .sort((left, right) => left.id.localeCompare(right.id));
    const byId = new Map(active.map((claim) => [claim.id, claim]));
    const signals = new Map(active.map((claim) => [claim.id, buildClaimRetrievalSignals(claim.statement)]));
    const inverted = new Map<string, string[]>();
    const normalized = new Map<string, string[]>();

    for (const claim of active) {
      const value = signals.get(claim.id);
      if (value === undefined) continue;
      pushIndex(normalized, value.normalized, claim.id);
      for (const key of signalKeys(claim, value)) pushIndex(inverted, key, claim.id);
    }

    const pairScores = new Map<string, ClaimGraphCandidatePair>();
    const rawScoredPairKeys = new Set<string>();
    let scoredPairs = 0;
    for (const claim of active) {
      const value = signals.get(claim.id);
      if (value === undefined) continue;
      const neighborVotes = new Map<string, number>();
      const exact = normalized.get(value.normalized) ?? [];
      for (const id of exact) if (id !== claim.id) neighborVotes.set(id, 100);
      for (const key of signalKeys(claim, value)) {
        const posting = inverted.get(key) ?? [];
        // Extremely common terms do not create a quadratic fan-out. The stable
        // bounded slice still gives each node a deterministic local candidate set.
        for (const id of boundedNeighbors(posting, claim.id)) {
          neighborVotes.set(id, (neighborVotes.get(id) ?? 0) + keyWeight(key));
        }
      }
      const neighbors = [...neighborVotes.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, CLAIM_GRAPH_MAX_CANDIDATES_PER_NODE * 3);
      const ranked: ClaimGraphCandidatePair[] = [];
      for (const [neighborId] of neighbors) {
        const neighbor = byId.get(neighborId);
        if (neighbor === undefined) continue;
        rawScoredPairKeys.add(canonicalClaimPairKey(claim.id, neighbor.id));
        scoredPairs += 1;
        const retrieval = scoreClaim(asCandidate(claim), neighbor);
        if (retrieval.score < CLAIM_GRAPH_MIN_CANDIDATE_SCORE &&
          claim.normalizedStatement !== neighbor.normalizedStatement) continue;
        const [leftClaimId, rightClaimId] = [claim.id, neighbor.id].sort();
        ranked.push({
          // Use the stable raw key during scoring; hash only the bounded final
          // candidate set so WebCrypto is never called for discarded pairs.
          pairId: canonicalClaimPairKey(leftClaimId, rightClaimId),
          leftClaimId,
          rightClaimId,
          score: retrieval.score,
          reasons: retrieval.reasons
        });
      }
      ranked.sort((left, right) => right.score - left.score || left.pairId.localeCompare(right.pairId));
      for (const pair of ranked.slice(0, CLAIM_GRAPH_MAX_CANDIDATES_PER_NODE)) {
        const previous = pairScores.get(pair.pairId);
        if (previous === undefined || pair.score > previous.score) pairScores.set(pair.pairId, pair);
      }
    }
    const orderedPairs = [...pairScores.values()].sort((left, right) =>
      right.score - left.score || left.pairId.localeCompare(right.pairId)
    );
    const maxPairs = Math.min(CLAIM_GRAPH_MAX_TOTAL_PAIRS, Math.max(20, active.length));
    const selectedPairs = selectCoveragePreservingPairs(orderedPairs, active.map((claim) => claim.id), maxPairs);
    const finalPairs = await Promise.all(selectedPairs.map(async (pair) => ({
      ...pair,
      pairId: `pair_${(await sha256Text(pair.pairId)).slice(0, 24)}`
    })));
    const boundedPairs = finalPairs.sort((left, right) =>
        right.score - left.score || left.pairId.localeCompare(right.pairId)
      ).slice(0, maxPairs);
    const allPairs = active.length * (active.length - 1) / 2;
    return {
      pairs: boundedPairs,
      metrics: {
        claims: active.length,
        invertedKeys: inverted.size,
        candidatePairs: boundedPairs.length,
        rawScoredPairs: rawScoredPairKeys.size,
        scoredPairs,
        candidatePairRatio: allPairs === 0 ? 0 : boundedPairs.length / allPairs,
        durationMs: Date.now() - started
      }
    };
  }
}

export function canonicalClaimPairKey(leftClaimId: string, rightClaimId: string): string {
  if (leftClaimId === rightClaimId) throw new Error("Claim Graph 不允许 self pair。");
  const [left, right] = [leftClaimId, rightClaimId].sort();
  return `${left}::${right}`;
}

function selectCoveragePreservingPairs(
  ordered: ClaimGraphCandidatePair[],
  claimIds: string[],
  limit: number
): ClaimGraphCandidatePair[] {
  const selected = new Map<string, ClaimGraphCandidatePair>();
  const bestByClaim = new Map<string, ClaimGraphCandidatePair>();
  for (const pair of ordered) {
    if (!bestByClaim.has(pair.leftClaimId)) bestByClaim.set(pair.leftClaimId, pair);
    if (!bestByClaim.has(pair.rightClaimId)) bestByClaim.set(pair.rightClaimId, pair);
  }
  for (const claimId of claimIds) {
    if (selected.size >= limit) break;
    const best = bestByClaim.get(claimId);
    if (best !== undefined) selected.set(best.pairId, best);
  }
  for (const pair of ordered) {
    if (selected.size >= limit) break;
    selected.set(pair.pairId, pair);
  }
  return [...selected.values()].sort((left, right) =>
    right.score - left.score || left.pairId.localeCompare(right.pairId)
  );
}

function signalKeys(claim: ClaimRecord, signals: ReturnType<typeof buildClaimRetrievalSignals>): string[] {
  const keys = new Set<string>();
  for (const value of signals.phrases) keys.add(`phrase:${value}`);
  for (const value of signals.aliases) keys.add(`alias:${value}`);
  for (const value of signals.acronyms) keys.add(`acronym:${value}`);
  for (const value of signals.tokens) if (value.length >= 2) keys.add(`token:${value}`);
  if (claim.topic !== undefined) {
    for (const value of buildClaimRetrievalSignals(claim.topic).tokens) keys.add(`topic:${value}`);
  }
  return [...keys];
}

function keyWeight(key: string): number {
  if (key.startsWith("alias:") || key.startsWith("acronym:")) return 5;
  if (key.startsWith("phrase:")) return 4;
  if (key.startsWith("topic:")) return 2;
  return 1;
}

function boundedNeighbors(posting: string[], current: string): string[] {
  const result: string[] = [];
  for (const id of posting) {
    if (id === current) continue;
    result.push(id);
    if (result.length >= CLAIM_GRAPH_MAX_POSTING_SCAN) break;
  }
  return result;
}

function pushIndex(index: Map<string, string[]>, key: string, id: string): void {
  const values = index.get(key);
  if (values === undefined) index.set(key, [id]);
  else values.push(id);
}

function asCandidate(claim: ClaimRecord): CandidateClaim {
  return {
    id: `graph_${claim.id}`,
    statement: claim.statement,
    normalizedStatement: claim.normalizedStatement,
    type: claim.type,
    topic: claim.topic,
    scope: claim.scope,
    qualifiers: claim.qualifiers,
    confidence: claim.confidence
  };
}
