import type {
  CandidateClaim,
  ClaimCoverageResult,
  ClaimRecord,
  ClaimRelation,
  ClaimType
} from "../src/types/claim";
import type { LlmMessage, LlmService } from "../src/services/llm-service";
import { normalizeClaim } from "../src/services/claim-identity";
import { scoreClaim } from "../src/services/claim-retrieval-service";
import { ComparisonCacheService } from "../src/services/comparison-cache-service";
import {
  ClaimComparisonService,
  type CandidateWithMatches,
  type ComparisonRunMetrics
} from "../src/services/claim-comparison-service";

interface FixtureCase {
  caseId: string;
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
  }>;
  coverageV2: Omit<ClaimCoverageResult, "candidateClaimId">;
  expected: {
    allowedRelations: ClaimRelation[];
  };
}

interface BenchmarkRow {
  source: string;
  mode: "cold" | "warm" | "partial-change";
  metrics: ComparisonRunMetrics;
  fastPathPrecision: number | null;
  relationDistribution: Record<string, number>;
}

export async function runComparisonBenchmark(input: {
  harness: FixtureCase[];
  agentMemory: FixtureCase[];
  conflict: FixtureCase[];
}): Promise<BenchmarkRow[]> {
  const rows: BenchmarkRow[] = [];
  rows.push(...await benchmarkSource("Harness fixed", input.harness, 30));
  rows.push(...await benchmarkSource("Agent Memory fixed", input.agentMemory, 30));
  rows.push(...await benchmarkSource("Conflict fixed", input.conflict, 8));
  return rows;
}

async function benchmarkSource(
  source: string,
  fixtures: FixtureCase[],
  targetCount: number
): Promise<BenchmarkRow[]> {
  const expanded = Array.from({ length: targetCount }, (_, index) => fixtures[index % fixtures.length]!);
  const records = new Map<string, ClaimRecord>();
  const coverageByCandidate = new Map<string, ClaimCoverageResult>();
  const expectedByCandidate = new Map<string, ClaimRelation[]>();
  const comparisonInput: CandidateWithMatches[] = expanded.map((fixture, index) => {
    const prefix = `${slug(source)}-${index + 1}`;
    const next: CandidateClaim = {
      ...fixture.candidate,
      id: `${prefix}-${fixture.candidate.id}`,
      normalizedStatement: normalizeClaim(fixture.candidate.statement),
      confidence: fixture.candidate.confidence ?? 0.9
    };
    const claims = fixture.existingClaims.map((item): ClaimRecord => ({
      ...item,
      id: `${prefix}-${item.id}`,
      normalizedStatement: normalizeClaim(item.statement),
      status: "active",
      confidence: 0.9,
      provenance: [{
        filePath: `KnowledgeCuratorRegression/wiki/${prefix}.md`,
        fileHash: `hash-${prefix}`,
        sourceKind: "wiki",
        accepted: true
      }],
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z"
    }));
    for (const claim of claims) records.set(claim.id, claim);
    const idMap = new Map(fixture.existingClaims.map((claim, claimIndex) => [claim.id, claims[claimIndex]!.id]));
    coverageByCandidate.set(next.id, {
      ...fixture.coverageV2,
      candidateClaimId: next.id,
      coreAspects: [...fixture.coverageV2.coreAspects],
      coveredBy: fixture.coverageV2.coveredBy.map((id) => idMap.get(id) ?? id),
      coveredAspects: [...fixture.coverageV2.coveredAspects],
      uncoveredAspects: [...fixture.coverageV2.uncoveredAspects],
      conflictingAspects: [...fixture.coverageV2.conflictingAspects],
      pairwise: fixture.coverageV2.pairwise.map((pair) => ({
        ...pair,
        claimId: idMap.get(pair.claimId) ?? pair.claimId,
        coveredAspects: [...pair.coveredAspects],
        conflictingAspects: [...pair.conflictingAspects]
      }))
    });
    expectedByCandidate.set(next.id, fixture.expected.allowedRelations);
    return {
      candidate: next,
      matches: claims.map((claim) => scoreClaim(next, claim))
    };
  });
  const cache = new ComparisonCacheService({}, async () => undefined);
  const llm = {
    requestJsonObject: async (messages: LlmMessage[]) => {
      // A small fixed delay exercises concurrency without spending provider quota.
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const candidates = payloadCandidates(messages);
      return JSON.stringify({
        coverages: candidates.map((candidate) => coverageByCandidate.get(candidate.id))
      });
    }
  } as unknown as LlmService;
  const service = new ClaimComparisonService(llm, (id) => records.get(id), {
    cache,
    getProviderContext: () => ({ provider: "benchmark-local", model: "fixture-model" })
  });
  const cold = await service.compare(comparisonInput);
  const coldMetrics = service.getLastMetrics()!;
  const warm = await service.compare(comparisonInput);
  const warmMetrics = service.getLastMetrics()!;
  const partialInput = comparisonInput.map((item, index) => index === 0 ? {
    ...item,
    candidate: {
      ...item.candidate,
      statement: `${item.candidate.statement} [partial-change]`,
      normalizedStatement: normalizeClaim(`${item.candidate.statement} [partial-change]`)
    }
  } : item);
  const partial = await service.compare(partialInput);
  const partialMetrics = service.getLastMetrics()!;
  return [
    row(source, "cold", coldMetrics, cold, expectedByCandidate),
    row(source, "warm", warmMetrics, warm, expectedByCandidate),
    row(source, "partial-change", partialMetrics, partial, expectedByCandidate)
  ];
}

function row(
  source: string,
  mode: "cold" | "warm" | "partial-change",
  metrics: ComparisonRunMetrics,
  comparisons: Array<{ candidateClaimId: string; relation: ClaimRelation; debug?: { executionMode: string } }>,
  expected: Map<string, ClaimRelation[]>
): BenchmarkRow {
  const fast = comparisons.filter((item) => item.debug?.executionMode === "fast_path");
  const correct = fast.filter((item) => expected.get(item.candidateClaimId)?.includes(item.relation)).length;
  return {
    source,
    mode,
    metrics,
    fastPathPrecision: fast.length === 0 ? null : correct / fast.length,
    relationDistribution: Object.fromEntries(
      comparisons.reduce((map, item) => {
        map.set(item.relation, (map.get(item.relation) ?? 0) + 1);
        return map;
      }, new Map<string, number>())
    )
  };
}

function payloadCandidates(messages: LlmMessage[]): CandidateClaim[] {
  const message = [...messages].reverse().find((item) => item.content.includes("Input (only Candidate"));
  if (message === undefined) throw new Error("Comparison benchmark could not find prompt payload.");
  const marker = "Input (only Candidate + Top K Existing Claims):\n";
  const offset = message.content.indexOf(marker);
  if (offset < 0) throw new Error("Comparison benchmark payload marker is missing.");
  const payload = JSON.parse(message.content.slice(offset + marker.length)) as Array<{ candidate: CandidateClaim }>;
  return payload.map((item) => item.candidate);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}
