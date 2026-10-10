import type { CandidateClaim, ClaimRecord } from "../src/types/claim";
import { normalizeClaim } from "../src/services/claim-identity";
import { ClaimRetrievalService } from "../src/services/claim-retrieval-service";

export interface RetrievalBenchmarkRow {
  claims: number;
  iterations: number;
  averageMs: number;
  p95Ms: number;
}

export function runRetrievalBenchmark(size: number, iterations: number): RetrievalBenchmarkRow {
  const claims = buildClaims(size);
  const service = new ClaimRetrievalService(() => claims);
  const candidates = buildCandidates(Math.max(iterations, 30));
  // Warm the immutable Existing Claim signal cache before measuring query CPU.
  service.retrieve(candidates[0]!, 5);
  const timings: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    service.retrieve(candidates[index % candidates.length]!, 5);
    timings.push(performance.now() - started);
  }
  timings.sort((left, right) => left - right);
  const averageMs = timings.reduce((sum, value) => sum + value, 0) / timings.length;
  const p95Index = Math.min(timings.length - 1, Math.ceil(timings.length * 0.95) - 1);
  return {
    claims: size,
    iterations,
    averageMs: round(averageMs),
    p95Ms: round(timings[p95Index] ?? 0)
  };
}

export function runThirtyClaimBatch(size: number): number {
  const claims = buildClaims(size);
  const service = new ClaimRetrievalService(() => claims);
  const candidates = buildCandidates(30);
  service.retrieve(candidates[0]!, 5);
  const started = performance.now();
  for (const candidate of candidates) service.retrieve(candidate, 5);
  return round(performance.now() - started);
}

function buildClaims(size: number): ClaimRecord[] {
  const now = "2026-09-26T00:00:00.000Z";
  const templates = [
    "Long-term agent memory persists information across session {n}.",
    "Retrieval augmented generation may improve factual grounding for dataset {n}.",
    "Offline benchmark {n} measures reproducible agent behavior.",
    "智能体长期记忆需要跨 Session 持久化，范围为任务 {n}。",
    "工具调用策略 {n} 应遵循最小权限原则。"
  ];
  return Array.from({ length: size }, (_, index) => {
    const statement = templates[index % templates.length]!.replace("{n}", String(index));
    return {
      id: `benchmark-claim-${index}`,
      statement,
      normalizedStatement: normalizeClaim(statement),
      type: index % 5 === 2 ? "method" : "fact",
      topic: index % 5 === 2 ? "Agent Evaluation" : index % 5 === 1 ? "RAG" : "Agent Memory",
      status: "active",
      confidence: 0.9,
      provenance: [{
        filePath: `Benchmark/wiki/${index}.md`,
        fileHash: `hash-${index}`,
        heading: index % 5 === 2 ? "Evaluation" : "Memory",
        sourceKind: "wiki",
        accepted: true
      }],
      createdAt: now,
      updatedAt: now
    };
  });
}

function buildCandidates(size: number): CandidateClaim[] {
  return Array.from({ length: size }, (_, index) => {
    const statement = index % 3 === 0
      ? `Long-term memory stores information beyond session ${index}.`
      : index % 3 === 1
        ? `RAG 可以提升数据集 ${index} 的事实依据。`
        : `Agent evaluation benchmark ${index} should be reproducible.`;
    return {
      id: `benchmark-candidate-${index}`,
      statement,
      normalizedStatement: normalizeClaim(statement),
      type: index % 3 === 2 ? "method" : "fact",
      topic: index % 3 === 2 ? "Agent Evaluation" : index % 3 === 1 ? "RAG" : "Agent Memory",
      confidence: 0.9
    };
  });
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
