import type { ClaimRecord } from "../src/types/claim";
import { normalizeClaim } from "../src/services/claim-identity";
import { ClaimGraphCandidateService } from "../src/services/claim-graph-candidate-service";

export async function runClaimGraphBenchmark(size = 1_000, iterations = 5) {
  const claims = makeClaims(size);
  const service = new ClaimGraphCandidateService();
  const durations: number[] = [];
  let pairs = 0;
  let scoredPairs = 0;
  for (let index = 0; index < iterations; index += 1) {
    const result = await service.generate(claims);
    durations.push(result.metrics.durationMs);
    pairs = result.metrics.candidatePairs;
    scoredPairs = result.metrics.scoredPairs;
  }
  const sorted = [...durations].sort((left, right) => left - right);
  return {
    claims: size,
    iterations,
    candidatePairs: pairs,
    scoredPairs,
    allPairs: size * (size - 1) / 2,
    pairRatio: pairs / (size * (size - 1) / 2),
    avgMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
  };
}

function makeClaims(size: number): ClaimRecord[] {
  const topics = ["Agent Memory", "RAG", "Harness", "Evaluation", "API", "Knowledge Graph"];
  return Array.from({ length: size }, (_, index) => {
    const topic = topics[index % topics.length] ?? "AI";
    const statement = index % 20 === 0
      ? `Long-term memory persists across session for agent variant ${index}.`
      : `${topic} claim ${index} describes component version v${index % 17} with metric ${index % 97}%.`;
    return {
      id: `benchmark-claim-${index}`,
      statement,
      normalizedStatement: normalizeClaim(statement),
      type: index % 5 === 0 ? "quantitative" : "fact",
      topic,
      status: "active",
      confidence: 0.9,
      provenance: [{ filePath: `Benchmark/${index}.md`, fileHash: String(index).padStart(64, "0"), sourceKind: "wiki" }],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z"
    };
  });
}
