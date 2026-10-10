import test from "node:test";
import assert from "node:assert/strict";
import type { ClaimGraphClassification } from "../src/types/claim-graph";
import type { RelationCalibrationMetrics } from "../src/services/claim-graph-calibration-service";
import {
  evaluateModelChoiceGate,
  relationErrorTaxonomy,
  selectCriticalPairIds,
  summarizePredictionStability
} from "../src/services/claim-graph-model-choice-service";

test("model choice hard gate requires every frozen quality threshold", () => {
  const metrics = passingMetrics();
  assert.equal(evaluateModelChoiceGate(metrics).passed, true);
  metrics.perRelationPrecision.refines!.rate = .79;
  assert.equal(evaluateModelChoiceGate(metrics).passed, false);
});

test("model choice gate preserves duplicate and sampled unrelated safety", () => {
  const metrics = passingMetrics();
  metrics.duplicateFalsePositives = 1;
  assert.equal(evaluateModelChoiceGate(metrics).checks.duplicateSafety, false);
  metrics.duplicateFalsePositives = 0;
  metrics.sampledUnrelatedFalseNegativeRate.numerator = 3;
  assert.equal(evaluateModelChoiceGate(metrics).checks.sampledUnrelatedFalseNegatives, false);
});

test("stability requires identical ordered inputs and reports relation/direction consistency", () => {
  const a = prediction("p", "supports", "left_to_right");
  const b = prediction("p", "supports", "right_to_left");
  const summary = summarizePredictionStability([[a], [b]]);
  assert.equal(summary.relationConsistency, 1);
  assert.equal(summary.directionConsistency, 0);
  assert.equal(summary.predictionConsistency, 0);
  assert.throws(() => summarizePredictionStability([[a], [prediction("q", "supports", "left_to_right")]]), /same ordered/u);
});

test("error taxonomy separates existence, relation-boundary, duplicate and direction errors", () => {
  const humans = new Map([
    ["fn", { humanRelation: "supports", humanDirection: "a_to_b" }],
    ["fp", { humanRelation: "unrelated", humanDirection: "not_applicable" }],
    ["mix", { humanRelation: "refines", humanDirection: "b_to_a" }],
    ["dup", { humanRelation: "supports", humanDirection: "a_to_b" }],
    ["dir", { humanRelation: "supports", humanDirection: "a_to_b" }]
  ]);
  const output = relationErrorTaxonomy(humans, [
    prediction("fn", "none", "symmetric", "unrelated"),
    prediction("fp", "supports", "left_to_right", "related"),
    prediction("mix", "supports", "left_to_right", "related"),
    prediction("dup", "duplicate", "symmetric", "related"),
    prediction("dir", "supports", "right_to_left", "related")
  ]);
  assert.equal(output.RELATION_EXISTENCE_FALSE_NEGATIVE, 1);
  assert.equal(output.RELATION_EXISTENCE_FALSE_POSITIVE, 1);
  assert.equal(output.SUPPORTS_VS_REFINES, 1);
  assert.equal(output.DUPLICATE_OVERMERGE, 1);
  assert.equal(output.DIRECTION_ERROR, 1);
});

test("critical subset selection is deterministic and puts frozen errors first", () => {
  const humans = new Map([
    ["a", { humanRelation: "supports", humanDirection: "a_to_b" }],
    ["b", { humanRelation: "unrelated", humanDirection: "not_applicable" }],
    ["c", { humanRelation: "refines", humanDirection: "b_to_a" }]
  ]);
  const baseline = [prediction("a", "supports", "left_to_right"), prediction("b", "supports", "left_to_right"), prediction("c", "refines", "right_to_left")];
  assert.deepEqual(selectCriticalPairIds(["c", "b", "a"], humans, baseline, 2), ["b", "c"]);
});

function prediction(pairId: string, relation: ClaimGraphClassification["relation"], direction: ClaimGraphClassification["direction"], relationExistence: ClaimGraphClassification["relationExistence"] = relation === "none" ? "unrelated" : "related"): ClaimGraphClassification {
  return { pairId, relation, direction, relationExistence, confidence: .9, reasoning: "test", evidenceClaimIds: relation === "none" ? [] : ["a"] };
}
function m(n: number, d: number) { return { numerator: n, denominator: d, rate: d === 0 ? null : n / d, smallN: d < 30 }; }
function passingMetrics(): RelationCalibrationMetrics {
  return {
    edgePrecision: m(40, 43), relationAccuracy: m(35, 43), directionAccuracy: m(30, 32),
    relationExistence: { truePositive: 45, falseNegative: 2, trueNegative: 8, falsePositive: 1, precision: m(45, 46), recall: m(45, 47), accuracy: m(53, 56) },
    perRelationPrecision: { duplicate: m(1, 1), supports: m(15, 18), refines: m(17, 20), contradicts: m(1, 1), depends_on: m(1, 1), unrelated: m(0, 0) },
    sampledUnrelatedFalseNegativeRate: m(2, 13), sampledUnrelatedNewFalsePositives: 1, duplicateFalsePositives: 0,
    confusionMatrix: {}, directionConfusionMatrix: {}, reviewed: { edges: 43, unrelated: 13 }, compressionEligible: false,
    gate: { edgePrecision: false, relationAccuracy: false, directionAccuracy: false, duplicatePrecision: false, supportsPrecision: false, refinesPrecision: false, relationExistenceAccuracy: false, unrelatedFalsePositiveSafety: false, passed: false }
  };
}
