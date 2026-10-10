import type { ClaimRecord } from "../src/types/claim";
import type { ClaimGraphCandidatePair } from "../src/types/claim-graph";
import type { ClaimGraphClassification } from "../src/types/claim-graph";
import type {
  GraphQualityAnnotations,
  GraphQualityEvaluationDataset,
  ReviewClaimRef
} from "../src/types/claim-graph-evaluation";
import type { KnowledgeCuratorSettings } from "../src/types/settings";
import {
  calculateRelationCalibrationMetrics,
  baselineClassifications
} from "../src/services/claim-graph-calibration-service";
import { ClaimGraphRelationService } from "../src/services/claim-graph-relation-service";
import { CLAIM_GRAPH_RELATION_PROMPT_V5, type ClaimGraphRelationPromptVersion } from "../src/services/claim-graph-relation-service";
import { LlmService, type LlmTransport } from "../src/services/llm-service";
import { validateAnnotations } from "../src/services/claim-graph-evaluation-service";
export {
  evaluateModelChoiceGate,
  relationErrorTaxonomy,
  selectCriticalPairIds,
  summarizePredictionStability
} from "../src/services/claim-graph-model-choice-service";

export interface CalibrationTransportCall {
  durationMs: number;
  status: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface CalibrationTransportTelemetry {
  calls: CalibrationTransportCall[];
}

export async function replayFrozenRelationCalibration(
  settings: KnowledgeCuratorSettings,
  dataset: GraphQualityEvaluationDataset,
  annotations: GraphQualityAnnotations,
  frozenPromptV3Predictions?: ClaimGraphClassification[],
  frozenPromptV4Predictions?: ClaimGraphClassification[],
  promptVersion: ClaimGraphRelationPromptVersion = CLAIM_GRAPH_RELATION_PROMPT_V5,
  telemetry?: CalibrationTransportTelemetry
) {
  validateAnnotations(dataset, annotations, false);
  const reviewed = [
    ...dataset.edges.filter((record) => annotations.edge[record.reviewId] !== undefined),
    ...dataset.unrelated.filter((record) => annotations.unrelated[record.reviewId] !== undefined)
  ];
  const claims = new Map<string, ClaimRecord>();
  const pairs: ClaimGraphCandidatePair[] = reviewed.map((record) => {
    addClaim(claims, record.claimA);
    addClaim(claims, record.claimB);
    return {
      pairId: record.reviewId,
      leftClaimId: record.claimA.id,
      rightClaimId: record.claimB.id,
      score: "retrievalScore" in record ? record.retrievalScore : 1,
      reasons: ["frozen-human-review-replay"]
    };
  });
  const baseline = frozenPromptV3Predictions ?? baselineClassifications(dataset.edges, dataset.unrelated, annotations);
  const baselineMetrics = calculateRelationCalibrationMetrics(dataset.edges, dataset.unrelated, annotations, baseline);
  const promptV4 = frozenPromptV4Predictions ?? baseline;
  const promptV4Metrics = calculateRelationCalibrationMetrics(dataset.edges, dataset.unrelated, annotations, promptV4);
  const service = new ClaimGraphRelationService(
    new LlmService(() => settings, createFetchTransport(telemetry)),
    promptVersion
  );
  const candidate = await service.classifyReviewedPairs(pairs, claims);
  if (candidate.failedPairs.length > 0) {
    throw new Error(`Calibration replay failed closed for pairs: ${candidate.failedPairs.join(", ")}`);
  }
  const candidateMetrics = calculateRelationCalibrationMetrics(
    dataset.edges, dataset.unrelated, annotations, candidate.classifications, "step4_2"
  );
  return {
    inputPairIds: pairs.map((pair) => pair.pairId),
    baselinePredictions: baseline,
    promptV4Predictions: promptV4,
    candidatePredictions: candidate.classifications,
    baselineMetrics,
    promptV4Metrics,
    candidateMetrics,
    executionMetrics: candidate.metrics
  };
}

export async function replayHeldOutRelationFixtures(
  settings: KnowledgeCuratorSettings,
  fixture: { cases: Array<{ id: string; left: string; right: string; relation: string; direction: string }> },
  promptVersion: ClaimGraphRelationPromptVersion = CLAIM_GRAPH_RELATION_PROMPT_V5,
  telemetry?: CalibrationTransportTelemetry
) {
  const claims = new Map<string, ClaimRecord>();
  const pairs: ClaimGraphCandidatePair[] = fixture.cases.map((item) => {
    const leftId = `heldout_${item.id}_left`;
    const rightId = `heldout_${item.id}_right`;
    addSyntheticClaim(claims, leftId, item.left);
    addSyntheticClaim(claims, rightId, item.right);
    return { pairId: item.id, leftClaimId: leftId, rightClaimId: rightId, score: 1, reasons: ["held-out-relation-policy-v3"] };
  });
  const service = new ClaimGraphRelationService(
    new LlmService(() => settings, createFetchTransport(telemetry)),
    promptVersion
  );
  const result = await service.classifyReviewedPairs(pairs, claims);
  if (result.failedPairs.length > 0) throw new Error(`Held-out replay failed closed: ${result.failedPairs.join(", ")}`);
  const expected = new Map(fixture.cases.map((item) => [item.id, item]));
  const cases = result.classifications.map((prediction) => {
    const target = expected.get(prediction.pairId)!;
    const predictedRelation = prediction.relation === "none" ? "unrelated" : prediction.relation;
    const predictedDirection = prediction.direction === "left_to_right" ? "a_to_b" :
      prediction.direction === "right_to_left" ? "b_to_a" : prediction.direction === "uncertain" ? "uncertain" : "not_applicable";
    return { id: prediction.pairId, expectedRelation: target.relation, expectedDirection: target.direction, predictedRelation, predictedDirection, prediction, pass: predictedRelation === target.relation && predictedDirection === target.direction };
  });
  return { total: cases.length, passed: cases.filter((item) => item.pass).length, cases, executionMetrics: result.metrics };
}

function addClaim(claims: Map<string, ClaimRecord>, ref: ReviewClaimRef) {
  if (claims.has(ref.id)) return;
  claims.set(ref.id, {
    id: ref.id,
    statement: ref.statement,
    normalizedStatement: ref.statement.trim().toLocaleLowerCase(),
    type: isClaimType(ref.claimType) ? ref.claimType : "fact",
    topic: ref.topic,
    status: "active",
    confidence: 1,
    provenance: [{ filePath: ref.sourcePath, fileHash: "0".repeat(64), sourceKind: "wiki" }],
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z"
  });
}

function addSyntheticClaim(claims: Map<string, ClaimRecord>, id: string, statement: string) {
  claims.set(id, {
    id, statement, normalizedStatement: statement.trim().toLocaleLowerCase(), type: "fact",
    status: "active", confidence: 1,
    provenance: [{ filePath: `HeldOut/${id}.md`, fileHash: "0".repeat(64), sourceKind: "wiki" }],
    createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z"
  });
}

function isClaimType(value: string | undefined): value is ClaimRecord["type"] {
  return value === "definition" || value === "fact" || value === "causal" || value === "quantitative" ||
    value === "method" || value === "experiential" || value === "predictive" || value === "opinion";
}

function createFetchTransport(telemetry?: CalibrationTransportTelemetry): LlmTransport {
  return async (url, headers, body) => {
    const started = performance.now();
    let status: number | null = null;
    try {
      const response = await fetch(url, { method: "POST", headers, body });
      status = response.status;
      let json: unknown;
      try { json = await response.json(); } catch { json = undefined; }
      recordTelemetry(telemetry, performance.now() - started, status, json);
      return { status: response.status, json };
    } catch (error: unknown) {
      recordTelemetry(telemetry, performance.now() - started, status, undefined);
      throw error;
    }
  };
}

function recordTelemetry(
  telemetry: CalibrationTransportTelemetry | undefined,
  durationMs: number,
  status: number | null,
  json: unknown
): void {
  if (telemetry === undefined) return;
  const root = record(json);
  const usage = record(root?.usage);
  telemetry.calls.push({
    durationMs: Math.round(durationMs),
    status,
    inputTokens: integer(usage?.prompt_tokens),
    outputTokens: integer(usage?.completion_tokens),
    totalTokens: integer(usage?.total_tokens)
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
