import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { ClaimRecord } from "../src/types/claim";
import type { ClaimGraphClassification, ClaimGraphCandidatePair } from "../src/types/claim-graph";
import type { GraphQualityAnnotations, GraphQualityEvaluationDataset } from "../src/types/claim-graph-evaluation";
import {
  baselineClassifications,
  calculateRelationCalibrationMetrics
} from "../src/services/claim-graph-calibration-service";
import {
  buildClaimGraphRelationMessages,
  CLAIM_GRAPH_RELATION_PROMPT_V2,
  CLAIM_GRAPH_RELATION_PROMPT_V3,
  CLAIM_GRAPH_RELATION_PROMPT_V4
  ,CLAIM_GRAPH_RELATION_PROMPT_V5
  ,CLAIM_GRAPH_RELATION_PROMPT_V6
} from "../src/services/claim-graph-relation-service";
import { directionFromRoles, isDuplicateEligible, parseClaimGraphClassifications } from "../src/services/claim-graph-validator";

test("relation prompt v3 makes supports versus refines operational", () => {
  const prompt = messages(CLAIM_GRAPH_RELATION_PROMPT_V3);
  assert.match(prompt, /增强可信度选 supports/u);
  assert.match(prompt, /增加定义、范围、机制或实现内容选 refines/u);
  assert.match(prompt, /删除 source 后 target 含义仍完整/u);
});
test("relation prompt v3 defines source to target direction explicitly", () => {
  const prompt = messages(CLAIM_GRAPH_RELATION_PROMPT_V3);
  assert.match(prompt, /证据\/原因\/观察 -> 被支撑的结论/u);
  assert.match(prompt, /更具体、增加信息的 Claim -> 更一般的 base Claim/u);
  assert.match(prompt, /right_to_left/u);
});
test("relation prompt v3 preserves high-precision duplicate and proposition-level unrelated", () => {
  const prompt = messages(CLAIM_GRAPH_RELATION_PROMPT_V3);
  assert.match(prompt, /删除任一 Claim 不损失独立知识/u);
  assert.match(prompt, /相同 topic、source、entity 或 claim type 不足以建立关系/u);
});
test("relation prompt v2 remains available for frozen baseline replay", () => {
  const prompt = messages(CLAIM_GRAPH_RELATION_PROMPT_V2);
  assert.match(prompt, /duplicate=核心命题等价/u);
  assert.doesNotMatch(prompt, /Stage 2 direction decision/u);
});
test("relation prompt v4 uses existence-first and asymmetry-first decisions", () => {
  const prompt = messages(CLAIM_GRAPH_RELATION_PROMPT_V4);
  assert.match(prompt, /Stage 1 relation existence/u);
  assert.match(prompt, /不要把 RELATED 限制为逻辑蕴含/u);
  assert.match(prompt, /duplicate 使用 asymmetry-first/u);
  assert.match(prompt, /epistemic asymmetry/u);
  assert.match(prompt, /semantic-content test/u);
  assert.match(prompt, /evidential-strength test/u);
  assert.match(prompt, /decisionSignals 枚举仅限：semantic_equivalence/u);
  assert.match(prompt, /duplicateBlockingSignals 枚举仅限：qualifier_asymmetry/u);
});
test("relation prompt v4 preserves the established source to target direction convention", () => {
  const prompt = messages(CLAIM_GRAPH_RELATION_PROMPT_V4);
  assert.match(prompt, /source -> target\/base/u);
  assert.match(prompt, /证据\/原因 -> 结论/u);
});
test("relation validator rejects symmetric direction for directional relations", () => {
  assert.throws(() => parse("supports", "symmetric"), /必须明确/u);
});
test("relation validator rejects directional output for symmetric relations", () => {
  assert.throws(() => parse("duplicate", "left_to_right"), /必须使用 symmetric/u);
  assert.throws(() => parse("none", "right_to_left"), /必须使用 symmetric/u);
});
test("relation validator requires bounded decision signals for prompt v4", () => {
  const allowed = new Map([["p", { leftClaimId: "a", rightClaimId: "b" }]]);
  assert.throws(() => parseClaimGraphClassifications(JSON.stringify({ relations: [{ pairId: "p", relation: "supports", direction: "left_to_right", confidence: .9, reasoning: "test", evidenceClaimIds: ["a"] }] }), allowed, { requireDecisionSignals: true }), /必须包含/u);
  const result = parseClaimGraphClassifications(JSON.stringify({ relations: [{ pairId: "p", relationExistence: "related", relation: "supports", direction: "left_to_right", confidence: .9, reasoning: "test", decisionSignals: ["evidence_or_reason"], duplicateBlockingSignals: ["scope_asymmetry"], evidenceClaimIds: ["a"] }] }), allowed, { requireDecisionSignals: true });
  assert.deepEqual(result[0]?.decisionSignals, ["evidence_or_reason"]);
});
test("relation validator blocks duplicate when specificity asymmetry is declared", () => {
  const allowed = new Map([["p", { leftClaimId: "a", rightClaimId: "b" }]]);
  assert.throws(() => parseClaimGraphClassifications(JSON.stringify({ relations: [{ pairId: "p", relationExistence: "related", relation: "duplicate", direction: "symmetric", confidence: .9, reasoning: "test", decisionSignals: ["semantic_equivalence"], duplicateBlockingSignals: ["epistemic_asymmetry"], evidenceClaimIds: ["a"] }] }), allowed, { requireDecisionSignals: true }), /不得判为 duplicate/u);
});
test("prompt v5 separates semantic delta and roles from deterministic direction", () => {
  const prompt = messages(CLAIM_GRAPH_RELATION_PROMPT_V5);
  assert.match(prompt, /先提取语义差异/u);
  assert.match(prompt, /不要直接输出方向/u);
  assert.match(prompt, /sameCoreProposition/u);
});
test("duplicate eligibility is deterministic and rejects every asymmetry", () => {
  const delta = { sameCoreProposition: true as const, uniqueInformationA: [], uniqueInformationB: [], asymmetry: { qualifier: false, scope: false, epistemicStrength: false, number: false, time: false, mechanism: false, scenario: false, condition: false, implementationDetail: false } };
  assert.equal(isDuplicateEligible(delta), true);
  assert.equal(isDuplicateEligible({ ...delta, asymmetry: { ...delta.asymmetry, epistemicStrength: true } }), false);
  assert.equal(isDuplicateEligible({ ...delta, uniqueInformationB: ["detail"] }), false);
});
test("semantic roles deterministically map every directional relation", () => {
  assert.equal(directionFromRoles("supports", { supportingClaim: "A", supportedClaim: "B" }), "left_to_right");
  assert.equal(directionFromRoles("refines", { detailClaim: "B", baseClaim: "A" }), "right_to_left");
  assert.equal(directionFromRoles("depends_on", { dependentClaim: "A", prerequisiteClaim: "B" }), "left_to_right");
  assert.equal(directionFromRoles("supports", { supportingClaim: "uncertain", supportedClaim: "uncertain" }), "uncertain");
});
test("prompt v5 parser vetoes ineligible duplicate and ignores model direction", () => {
  const allowed = new Map([["p", { leftClaimId: "a", rightClaimId: "b" }]]);
  const base = { pairId: "p", relationExistence: "related", confidence: .9, reasoning: "x", evidenceClaimIds: ["a"], semanticRoles: { supportingClaim: "B", supportedClaim: "A" }, semanticDelta: { sameCoreProposition: true, uniqueInformationA: [], uniqueInformationB: [], asymmetry: { qualifier: false, scope: false, epistemicStrength: false, number: false, time: false, mechanism: false, scenario: false, condition: false, implementationDetail: false } } };
  const parsed = parseClaimGraphClassifications(JSON.stringify({ relations: [{ ...base, relation: "supports", direction: "left_to_right" }] }), allowed, { requireDecisionArchitecture: true });
  assert.equal(parsed[0]?.direction, "right_to_left");
  assert.throws(() => parseClaimGraphClassifications(JSON.stringify({ relations: [{ ...base, relation: "duplicate", semanticDelta: { ...base.semanticDelta, uniqueInformationA: ["new"] } }] }), allowed, { requireDecisionArchitecture: true }), /duplicate gate/u);
});
test("prompt v6 adds relation bridge while retaining the frozen decision architecture", () => {
  const prompt = messages(CLAIM_GRAPH_RELATION_PROMPT_V6);
  assert.match(prompt, /relationBridge/u);
  assert.match(prompt, /不是严格逻辑蕴含，不等于 unrelated/u);
  assert.match(prompt, /deterministic duplicate eligibility/u);
  assert.match(prompt, /不得放宽或重新定义/u);
});
test("prompt v6 validator accepts partial support bridge and rejects inconsistent existence", () => {
  const allowed = new Map([["p", { leftClaimId: "a", rightClaimId: "b" }]]);
  const delta = { sameCoreProposition: false, uniqueInformationA: ["observation"], uniqueInformationB: ["principle"], asymmetry: { qualifier: false, scope: false, epistemicStrength: false, number: false, time: false, mechanism: true, scenario: false, condition: false, implementationDetail: false } };
  const item = { pairId: "p", relationExistence: "related", relationBridge: "reason", semanticDelta: delta, relation: "supports", semanticRoles: { supportingClaim: "A", supportedClaim: "B" }, confidence: .8, reasoning: "failure observation supports mitigation", evidenceClaimIds: ["a", "b"] };
  const parsed = parseClaimGraphClassifications(JSON.stringify({ relations: [item] }), allowed, { requireDecisionArchitecture: true, requireRelationBridge: true });
  assert.equal(parsed[0]?.direction, "left_to_right");
  assert.equal(parsed[0]?.relationBridge, "reason");
  assert.throws(() => parseClaimGraphClassifications(JSON.stringify({ relations: [{ ...item, relationExistence: "unrelated" }] }), allowed, { requireDecisionArchitecture: true, requireRelationBridge: true }), /不一致/u);
});
test("prompt v6 preserves uncertain relation existence without inventing direction", () => {
  const allowed = new Map([["p", { leftClaimId: "a", rightClaimId: "b" }]]);
  const item = { pairId: "p", relationExistence: "uncertain", relationBridge: "uncertain", semanticDelta: { sameCoreProposition: false, uniqueInformationA: [], uniqueInformationB: [], asymmetry: { qualifier: false, scope: false, epistemicStrength: false, number: false, time: false, mechanism: false, scenario: false, condition: false, implementationDetail: false } }, relation: "uncertain", semanticRoles: {}, confidence: .5, reasoning: "bridge is ambiguous", evidenceClaimIds: ["a", "b"] };
  const parsed = parseClaimGraphClassifications(JSON.stringify({ relations: [item] }), allowed, { requireDecisionArchitecture: true, requireRelationBridge: true });
  assert.equal(parsed[0]?.direction, "uncertain");
});
test("calibration metrics count duplicate false positives across reviewed samples", () => {
  const { dataset, annotations } = fixture();
  const predictions = baselineClassifications(dataset.edges, dataset.unrelated, annotations);
  predictions[0]!.relation = "duplicate";
  const metrics = calculateRelationCalibrationMetrics(dataset.edges, dataset.unrelated, annotations, predictions);
  assert.equal(metrics.duplicateFalsePositives, 1);
  assert.equal(metrics.compressionEligible, false);
});
test("calibration metrics keep sampled unrelated false negatives observational", () => {
  const { dataset, annotations } = fixture();
  const predictions = baselineClassifications(dataset.edges, dataset.unrelated, annotations);
  const metrics = calculateRelationCalibrationMetrics(dataset.edges, dataset.unrelated, annotations, predictions);
  assert.deepEqual(metrics.sampledUnrelatedFalseNegativeRate, { numerator: 1, denominator: 2, rate: .5, smallN: true });
});
test("calibration metrics expose relation existence confusion separately", () => {
  const { dataset, annotations } = fixture();
  const predictions = baselineClassifications(dataset.edges, dataset.unrelated, annotations);
  const metrics = calculateRelationCalibrationMetrics(dataset.edges, dataset.unrelated, annotations, predictions);
  assert.deepEqual(metrics.relationExistence, {
    truePositive: 1, falseNegative: 1, trueNegative: 1, falsePositive: 0,
    precision: { numerator: 1, denominator: 1, rate: 1, smallN: true },
    recall: { numerator: 1, denominator: 2, rate: .5, smallN: true },
    accuracy: { numerator: 2, denominator: 3, rate: 2 / 3, smallN: true }
  });
});
test("calibration replay fails closed on missing or unknown predictions", () => {
  const { dataset, annotations } = fixture();
  assert.throws(() => calculateRelationCalibrationMetrics(dataset.edges, dataset.unrelated, annotations, []), /incomplete/u);
  const predictions = baselineClassifications(dataset.edges, dataset.unrelated, annotations);
  predictions.push({ ...predictions[0]!, pairId: "unknown" });
  assert.throws(() => calculateRelationCalibrationMetrics(dataset.edges, dataset.unrelated, annotations, predictions), /unknown/u);
});
test("relation calibration regression fixture contains ten general held-out cases", async () => {
  const fixture = JSON.parse(await readFile("KnowledgeCuratorRegression/claim-graph-calibration/relation-policy-v2.json", "utf8"));
  assert.equal(fixture.cases.length, 10);
  assert.equal(new Set(fixture.cases.map((item: { id: string }) => item.id)).size, 10);
  assert.ok(fixture.cases.every((item: { id: string }) => !item.id.includes("claim_")));
});
test("relation policy v3 contains twenty distinct held-out generalization fixtures", async () => {
  const fixture = JSON.parse(await readFile("KnowledgeCuratorRegression/claim-graph-calibration/relation-policy-v3.json", "utf8"));
  assert.equal(fixture.cases.length, 20);
  assert.equal(new Set(fixture.cases.map((item: { id: string }) => item.id)).size, 20);
  assert.ok(fixture.cases.every((item: { id: string }) => !item.id.includes("claim_")));
  assert.deepEqual(new Set(fixture.cases.map((item: { relation: string }) => item.relation)), new Set(["unrelated", "supports", "refines", "contradicts", "depends_on", "duplicate"]));
});
test("relation policy v4 adds fourteen architecture held-out fixtures", async () => {
  const fixture = JSON.parse(await readFile("KnowledgeCuratorRegression/claim-graph-calibration/relation-policy-v4.json", "utf8"));
  assert.equal(fixture.cases.length, 14);
  assert.equal(new Set(fixture.cases.map((item: { id: string }) => item.id)).size, 14);
});
test("relation policy v5 adds ten existence held-out fixtures", async () => {
  const fixture = JSON.parse(await readFile("KnowledgeCuratorRegression/claim-graph-calibration/relation-policy-v5.json", "utf8"));
  assert.equal(fixture.cases.length, 10);
  assert.ok(fixture.cases.every((item: { id: string }) => item.id.startsWith("v5-")));
});

function messages(version: typeof CLAIM_GRAPH_RELATION_PROMPT_V2 | typeof CLAIM_GRAPH_RELATION_PROMPT_V3 | typeof CLAIM_GRAPH_RELATION_PROMPT_V4 | typeof CLAIM_GRAPH_RELATION_PROMPT_V5 | typeof CLAIM_GRAPH_RELATION_PROMPT_V6) {
  return buildClaimGraphRelationMessages([pair()], new Map([["a", claim("a", "A")], ["b", claim("b", "B")]]), version)
    .map((item) => item.content).join("\n");
}
function parse(relation: string, direction: string) {
  return parseClaimGraphClassifications(JSON.stringify({ relations: [{ pairId: "p", relation, direction, confidence: .9, reasoning: "test", evidenceClaimIds: relation === "none" ? [] : ["a"] }] }), new Map([["p", { leftClaimId: "a", rightClaimId: "b" }]]));
}
function claim(id: string, statement: string): ClaimRecord { return { id, statement, normalizedStatement: statement.toLowerCase(), type: "fact", status: "active", confidence: 1, provenance: [{ filePath: `Wiki/${id}.md`, fileHash: "0".repeat(64), sourceKind: "wiki" }], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }; }
function pair(): ClaimGraphCandidatePair { return { pairId: "p", leftClaimId: "a", rightClaimId: "b", score: 1, reasons: ["test"] }; }
function fixture(): { dataset: GraphQualityEvaluationDataset; annotations: GraphQualityAnnotations } {
  const claimA = { id: "a", statement: "A", sourcePath: "Wiki/A.md" };
  const claimB = { id: "b", statement: "B", sourcePath: "Wiki/B.md" };
  const manifest = { datasetFingerprint: "f", claimIds: ["a", "b"] } as GraphQualityEvaluationDataset["manifest"];
  const edges = [{ reviewId: "edge", edgeId: "e", claimA, claimB, predictedRelation: "supports", predictedDirection: "a_to_b", modelConfidence: .8, modelEvidence: ["x"], humanRelation: null, humanDirection: null, reviewerConfidence: null, notes: "" }] as GraphQualityEvaluationDataset["edges"];
  const unrelated = [{ reviewId: "u1", pairId: "u1", claimA, claimB, retrievalScore: .8, retrievalRank: 1, stratum: "high", humanRelation: null, humanDirection: null, reviewerConfidence: null, notes: "" }, { reviewId: "u2", pairId: "u2", claimA, claimB, retrievalScore: .7, retrievalRank: 2, stratum: "medium", humanRelation: null, humanDirection: null, reviewerConfidence: null, notes: "" }] as GraphQualityEvaluationDataset["unrelated"];
  const annotations = { version: "phase7.5-step3-v1", datasetFingerprint: "f", updatedAt: "2026-01-01T00:00:00.000Z", edge: { edge: annotation("supports", "a_to_b") }, unrelated: { u1: annotation("supports", "a_to_b"), u2: annotation("unrelated", "not_applicable") }, orphan: {} } as GraphQualityAnnotations;
  return { dataset: { manifest, edges, unrelated, orphans: [] }, annotations };
}
function annotation(humanRelation: string, humanDirection: string) { return { humanRelation, humanDirection, reviewerConfidence: "high", notes: "", submittedAt: "2026-01-01T00:00:00.000Z" }; }
