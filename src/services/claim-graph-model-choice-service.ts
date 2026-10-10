import type { ClaimGraphClassification } from "../types/claim-graph";
import type { RelationCalibrationMetrics } from "./claim-graph-calibration-service";

export interface ModelChoiceGate {
  checks: Record<string, boolean>;
  passed: boolean;
}

export interface StabilitySummary {
  cases: number;
  runs: number;
  predictionConsistency: number | null;
  relationConsistency: number | null;
  directionConsistency: number | null;
}

export function evaluateModelChoiceGate(metrics: RelationCalibrationMetrics): ModelChoiceGate {
  const atLeast = (value: { rate: number | null }, threshold: number) =>
    value.rate !== null && value.rate >= threshold;
  const checks = {
    edgePrecision: atLeast(metrics.edgePrecision, .9),
    relationAccuracy: atLeast(metrics.relationAccuracy, .8),
    directionAccuracy: atLeast(metrics.directionAccuracy, .9),
    existenceAccuracy: atLeast(metrics.relationExistence.accuracy, .9),
    existencePrecision: atLeast(metrics.relationExistence.precision, .9),
    existenceRecall: atLeast(metrics.relationExistence.recall, .9),
    supportsPrecision: atLeast(metrics.perRelationPrecision.supports!, .75),
    refinesPrecision: atLeast(metrics.perRelationPrecision.refines!, .8),
    duplicateSafety: metrics.duplicateFalsePositives === 0,
    sampledUnrelatedFalseNegatives: metrics.sampledUnrelatedFalseNegativeRate.numerator !== null &&
      metrics.sampledUnrelatedFalseNegativeRate.numerator <= 2,
    sampledUnrelatedNewFalsePositives: metrics.sampledUnrelatedNewFalsePositives <= 1
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

export function summarizePredictionStability(
  runs: ClaimGraphClassification[][]
): StabilitySummary {
  if (runs.length === 0) return emptyStability(0);
  const ids = runs[0]!.map((item) => item.pairId);
  for (const run of runs) {
    if (run.length !== ids.length || run.some((item, index) => item.pairId !== ids[index])) {
      throw new Error("Stability runs must contain the same ordered pair IDs.");
    }
  }
  let predictionMatches = 0;
  let relationMatches = 0;
  let directionMatches = 0;
  for (let index = 0; index < ids.length; index += 1) {
    const items = runs.map((run) => run[index]!);
    if (same(items.map((item) => item.relation))) relationMatches += 1;
    if (same(items.map((item) => item.direction))) directionMatches += 1;
    if (same(items.map((item) => `${item.relation}|${item.direction}`))) predictionMatches += 1;
  }
  return {
    cases: ids.length,
    runs: runs.length,
    predictionConsistency: ratio(predictionMatches, ids.length),
    relationConsistency: ratio(relationMatches, ids.length),
    directionConsistency: ratio(directionMatches, ids.length)
  };
}

export function relationErrorTaxonomy(
  humanById: Map<string, { humanRelation: string; humanDirection: string }>,
  predictions: ClaimGraphClassification[]
): Record<string, number> {
  const result = {
    RELATION_EXISTENCE_FALSE_NEGATIVE: 0,
    RELATION_EXISTENCE_FALSE_POSITIVE: 0,
    SUPPORTS_VS_REFINES: 0,
    DUPLICATE_OVERMERGE: 0,
    WRONG_OTHER_RELATION: 0,
    DIRECTION_ERROR: 0
  };
  for (const prediction of predictions) {
    const human = humanById.get(prediction.pairId);
    if (human === undefined || human.humanRelation === "uncertain") continue;
    const predicted = prediction.relation === "none" ? "unrelated" : prediction.relation;
    const predictedExists = prediction.relationExistence === undefined
      ? predicted !== "unrelated"
      : prediction.relationExistence === "related";
    const humanExists = human.humanRelation !== "unrelated";
    if (!predictedExists && humanExists) result.RELATION_EXISTENCE_FALSE_NEGATIVE += 1;
    if (predictedExists && !humanExists) result.RELATION_EXISTENCE_FALSE_POSITIVE += 1;
    if ((predicted === "supports" && human.humanRelation === "refines") ||
      (predicted === "refines" && human.humanRelation === "supports")) {
      result.SUPPORTS_VS_REFINES += 1;
    } else if (predicted === "duplicate" && human.humanRelation !== "duplicate") {
      result.DUPLICATE_OVERMERGE += 1;
    } else if (predicted !== human.humanRelation) {
      result.WRONG_OTHER_RELATION += 1;
    } else if (isDirectional(predicted) && classifierDirection(prediction.direction) !== human.humanDirection) {
      result.DIRECTION_ERROR += 1;
    }
  }
  return result;
}

export function selectCriticalPairIds(
  reviewedIds: string[],
  humanById: Map<string, { humanRelation: string; humanDirection: string }>,
  baseline: ClaimGraphClassification[],
  maxReviewed = 20
): string[] {
  const byId = new Map(baseline.map((item) => [item.pairId, item]));
  const errors = reviewedIds.filter((id) => {
    const human = humanById.get(id);
    const prediction = byId.get(id);
    if (human === undefined || prediction === undefined) return false;
    const relation = prediction.relation === "none" ? "unrelated" : prediction.relation;
    return relation !== human.humanRelation ||
      (isDirectional(relation) && classifierDirection(prediction.direction) !== human.humanDirection);
  }).sort();
  const remaining = reviewedIds.filter((id) => !errors.includes(id)).sort((left, right) => {
    const a = humanById.get(left)?.humanRelation ?? "";
    const b = humanById.get(right)?.humanRelation ?? "";
    return a.localeCompare(b) || left.localeCompare(right);
  });
  return [...errors, ...remaining].slice(0, maxReviewed);
}

function emptyStability(runs: number): StabilitySummary {
  return { cases: 0, runs, predictionConsistency: null, relationConsistency: null, directionConsistency: null };
}
function same(values: unknown[]) { return values.every((value) => value === values[0]); }
function ratio(numerator: number, denominator: number) { return denominator === 0 ? null : numerator / denominator; }
function isDirectional(relation: string) { return relation === "supports" || relation === "refines" || relation === "depends_on"; }
function classifierDirection(value: ClaimGraphClassification["direction"]) {
  return value === "left_to_right" ? "a_to_b" : value === "right_to_left" ? "b_to_a" : value === "uncertain" ? "uncertain" : "not_applicable";
}
