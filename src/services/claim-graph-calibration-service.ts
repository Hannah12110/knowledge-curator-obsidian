import type { ClaimGraphClassification, ClaimGraphClassifierRelation } from "../types/claim-graph";
import type {
  EdgeReviewRecord,
  GraphQualityAnnotations,
  HumanDirection,
  HumanGraphRelation,
  MetricResult,
  UnrelatedReviewRecord
} from "../types/claim-graph-evaluation";

const DIRECTIONAL = new Set<HumanGraphRelation>(["supports", "refines", "depends_on"]);
const RELATIONS: HumanGraphRelation[] = [
  "duplicate", "supports", "refines", "contradicts", "depends_on", "unrelated"
];

export interface RelationCalibrationMetrics {
  edgePrecision: MetricResult;
  relationAccuracy: MetricResult;
  directionAccuracy: MetricResult;
  relationExistence: {
    truePositive: number;
    falseNegative: number;
    trueNegative: number;
    falsePositive: number;
    precision: MetricResult;
    recall: MetricResult;
    accuracy: MetricResult;
  };
  perRelationPrecision: Record<string, MetricResult>;
  sampledUnrelatedFalseNegativeRate: MetricResult;
  sampledUnrelatedNewFalsePositives: number;
  duplicateFalsePositives: number;
  confusionMatrix: Record<string, number>;
  directionConfusionMatrix: Record<string, number>;
  reviewed: { edges: number; unrelated: number };
  compressionEligible: boolean;
  gate: {
    edgePrecision: boolean;
    relationAccuracy: boolean;
    directionAccuracy: boolean;
    duplicatePrecision: boolean;
    supportsPrecision: boolean;
    refinesPrecision: boolean;
    relationExistenceAccuracy: boolean;
    unrelatedFalsePositiveSafety: boolean;
    passed: boolean;
  };
}

export function calculateRelationCalibrationMetrics(
  edges: EdgeReviewRecord[],
  unrelated: UnrelatedReviewRecord[],
  annotations: GraphQualityAnnotations,
  predictions: ClaimGraphClassification[],
  gateProfile: "step4_1" | "step4_2" = "step4_1"
): RelationCalibrationMetrics {
  const reviewedIds = new Set([
    ...Object.keys(annotations.edge), ...Object.keys(annotations.unrelated)
  ]);
  const byId = new Map<string, ClaimGraphClassification>();
  for (const prediction of predictions) {
    if (!reviewedIds.has(prediction.pairId) || byId.has(prediction.pairId)) {
      throw new Error(`Calibration prediction contains unknown or duplicate reviewId: ${prediction.pairId}`);
    }
    byId.set(prediction.pairId, prediction);
  }
  if (byId.size !== reviewedIds.size) {
    throw new Error(`Calibration replay is incomplete: expected ${reviewedIds.size}, received ${byId.size}.`);
  }
  const edgeCases = edges.flatMap((record) => validCase(record, annotations.edge[record.reviewId], byId));
  const unrelatedCases = unrelated.flatMap((record) => validCase(record, annotations.unrelated[record.reviewId], byId));
  const allCases = [...edgeCases, ...unrelatedCases];
  const edgePredictions = edgeCases.filter(({ predicted }) => predicted !== "unrelated" && predicted !== "uncertain");
  const exactEdges = edgeCases.filter(({ predicted, human }) => predicted === human);
  const directionCases = exactEdges.filter(({ human }) => DIRECTIONAL.has(human));
  const perRelationPrecision = Object.fromEntries(RELATIONS.map((relation) => {
    const cases = edgeCases.filter(({ predicted }) => predicted === relation);
    return [relation, metric(cases.filter(({ human }) => human === relation).length, cases.length)];
  }));
  const confusionMatrix = countBy(allCases, ({ predicted, human }) => `${predicted} -> ${human}`);
  const directionConfusionMatrix = countBy(directionCases, ({ predictedDirection, humanDirection }) =>
    `${predictedDirection} -> ${humanDirection}`
  );
  const duplicateCases = allCases.filter(({ predicted }) => predicted === "duplicate");
  const duplicateFalsePositives = duplicateCases.filter(({ human }) => human !== "duplicate").length;
  const sampledUnrelatedFalseNegativeRate = metric(unrelatedCases.filter(({ predictedExists, human }) =>
    !predictedExists && human !== "unrelated"
  ).length, unrelatedCases.length);
  const relationExistence = existenceMetrics(allCases);
  const result: RelationCalibrationMetrics = {
    edgePrecision: metric(edgePredictions.filter(({ human }) => human !== "unrelated").length, edgePredictions.length),
    relationAccuracy: metric(exactEdges.length, edgeCases.length),
    directionAccuracy: metric(directionCases.filter(({ predictedDirection, humanDirection }) =>
      predictedDirection === humanDirection
    ).length, directionCases.length),
    relationExistence,
    perRelationPrecision,
    sampledUnrelatedFalseNegativeRate,
    sampledUnrelatedNewFalsePositives: unrelatedCases.filter(({ predictedExists, human }) =>
      predictedExists && human === "unrelated"
    ).length,
    duplicateFalsePositives,
    confusionMatrix,
    directionConfusionMatrix,
    reviewed: { edges: edgeCases.length, unrelated: unrelatedCases.length },
    compressionEligible: false,
    gate: {
      edgePrecision: false, relationAccuracy: false, directionAccuracy: false,
      duplicatePrecision: false, supportsPrecision: false, refinesPrecision: false,
      relationExistenceAccuracy: false, unrelatedFalsePositiveSafety: false, passed: false
    }
  };
  result.gate.edgePrecision = atLeast(result.edgePrecision, .9);
  result.gate.relationAccuracy = atLeast(result.relationAccuracy, gateProfile === "step4_2" ? .8 : .75);
  result.gate.directionAccuracy = atLeast(result.directionAccuracy, .9);
  result.gate.duplicatePrecision = result.duplicateFalsePositives === 0 &&
    atLeast(result.perRelationPrecision.duplicate!, 1);
  result.gate.supportsPrecision = atLeast(result.perRelationPrecision.supports!, gateProfile === "step4_2" ? .75 : .7);
  result.gate.refinesPrecision = atLeast(result.perRelationPrecision.refines!, .8);
  result.gate.relationExistenceAccuracy = gateProfile === "step4_2"
    ? atLeast(result.relationExistence.accuracy, .9) && atLeast(result.relationExistence.precision, .9) && atLeast(result.relationExistence.recall, .9)
    : atLeast(result.relationExistence.accuracy, .8);
  result.gate.unrelatedFalsePositiveSafety = result.sampledUnrelatedNewFalsePositives <= 1;
  result.gate.passed = Object.entries(result.gate).filter(([key]) => key !== "passed").every(([, value]) => value);
  result.compressionEligible = result.duplicateFalsePositives === 0 &&
    atLeast(result.perRelationPrecision.duplicate!, 1) && atLeast(result.directionAccuracy, .9);
  return result;
}

function existenceMetrics(cases: Array<{ predictedExists: boolean; human: HumanGraphRelation }>) {
  const truePositive = cases.filter(({ predictedExists, human }) => predictedExists && human !== "unrelated").length;
  const falseNegative = cases.filter(({ predictedExists, human }) => !predictedExists && human !== "unrelated").length;
  const trueNegative = cases.filter(({ predictedExists, human }) => !predictedExists && human === "unrelated").length;
  const falsePositive = cases.filter(({ predictedExists, human }) => predictedExists && human === "unrelated").length;
  return {
    truePositive, falseNegative, trueNegative, falsePositive,
    precision: metric(truePositive, truePositive + falsePositive),
    recall: metric(truePositive, truePositive + falseNegative),
    accuracy: metric(truePositive + trueNegative, cases.length)
  };
}

export function baselineClassifications(
  edges: EdgeReviewRecord[],
  unrelated: UnrelatedReviewRecord[],
  annotations: GraphQualityAnnotations
): ClaimGraphClassification[] {
  const edgePredictions = edges.filter((record) => annotations.edge[record.reviewId] !== undefined).map((record) => ({
    pairId: record.reviewId,
    relation: record.predictedRelation,
    direction: humanToClassifierDirection(record.predictedDirection),
    confidence: record.modelConfidence,
    reasoning: record.modelEvidence.join(" ") || "Frozen baseline prediction.",
    evidenceClaimIds: [record.claimA.id, record.claimB.id]
  }));
  const unrelatedPredictions = unrelated.filter((record) => annotations.unrelated[record.reviewId] !== undefined).map((record) => ({
    pairId: record.reviewId,
    relation: "none" as const,
    direction: "symmetric" as const,
    confidence: 1,
    reasoning: "Frozen baseline unrelated classification.",
    evidenceClaimIds: []
  }));
  return [...edgePredictions, ...unrelatedPredictions];
}

function validCase(
  record: EdgeReviewRecord | UnrelatedReviewRecord,
  annotation: GraphQualityAnnotations["edge"][string] | undefined,
  predictions: Map<string, ClaimGraphClassification>
) {
  if (annotation === undefined || annotation.humanRelation === "uncertain" || annotation.reviewerConfidence === "low") return [];
  const prediction = predictions.get(record.reviewId);
  if (prediction === undefined) throw new Error(`Missing calibration prediction: ${record.reviewId}`);
  return [{
    record,
    predicted: classifierToHumanRelation(prediction.relation),
    predictedExists: prediction.relationExistence === undefined
      ? prediction.relation !== "none"
      : prediction.relationExistence === "related",
    human: annotation.humanRelation,
    predictedDirection: classifierToHumanDirection(prediction.relation, prediction.direction),
    humanDirection: annotation.humanDirection
  }];
}

function classifierToHumanRelation(relation: ClaimGraphClassifierRelation): HumanGraphRelation {
  return relation === "none" ? "unrelated" : relation;
}

function classifierToHumanDirection(
  relation: ClaimGraphClassifierRelation,
  direction: ClaimGraphClassification["direction"]
): HumanDirection {
  if (relation === "none" || relation === "duplicate" || relation === "contradicts") return "not_applicable";
  if (direction === "left_to_right") return "a_to_b";
  if (direction === "right_to_left") return "b_to_a";
  return "uncertain";
}

function humanToClassifierDirection(direction: HumanDirection): ClaimGraphClassification["direction"] {
  if (direction === "a_to_b") return "left_to_right";
  if (direction === "b_to_a") return "right_to_left";
  return "symmetric";
}

function metric(numerator: number, denominator: number): MetricResult {
  return { numerator, denominator, rate: denominator === 0 ? null : numerator / denominator, smallN: denominator < 30 };
}
function atLeast(value: MetricResult, threshold: number) { return value.rate !== null && value.rate >= threshold; }
function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const item of items) output[key(item)] = (output[key(item)] ?? 0) + 1;
  return output;
}
