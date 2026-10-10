import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = path.join(root, "KnowledgeCuratorValidation/datasets/graph-quality");
const runRoot = path.join(root, "KnowledgeCuratorValidation/calibration/relation-v3/2026-10-06T03-24-24.068Z-f7f2427b");
const reportsRoot = path.join(root, "KnowledgeCuratorValidation/reports");
const [edges, unrelated, annotations, predictions, heldout, metadata, heldoutFixtures] = await Promise.all([
  read("edge-review.json"), read("unrelated-review.json"), read("annotations.json"),
  readAt(runRoot, "predictions.json"), readAt(runRoot, "held-out-results.json"), readAt(runRoot, "run-metadata.json"),
  readAt(path.join(root, "KnowledgeCuratorRegression/claim-graph-calibration"), "relation-policy-v3.json")
]);
const records = new Map([...edges.records, ...unrelated.records].map((item) => [item.reviewId, item]));
const predicted = new Map(predictions.candidate.map((item) => [item.pairId, item]));
const audited = [];
for (const [reviewId, annotation] of Object.entries({ ...annotations.edge, ...annotations.unrelated })) {
  if (annotation.humanRelation === "uncertain" || annotation.reviewerConfidence === "low") continue;
  const prediction = predicted.get(reviewId);
  const record = records.get(reviewId);
  if (!prediction || !record) continue;
  const relation = prediction.relation === "none" ? "unrelated" : prediction.relation;
  const direction = humanDirection(prediction.direction);
  const duplicateFp = relation === "duplicate" && annotation.humanRelation !== "duplicate";
  const directionError = isDirectional(relation) && relation === annotation.humanRelation && direction !== annotation.humanDirection;
  if (!duplicateFp && !directionError) continue;
  audited.push(entry(record, prediction, annotation, duplicateFp ? "SIGNAL_EXTRACTION_FAILURE" : "ROLE_ASSIGNMENT_FAILURE"));
}
const fixtureById = new Map(heldoutFixtures.cases.map((item) => [item.id, item]));
for (const item of heldout.cases.filter((item) => !item.pass)) {
  const fixture = fixtureById.get(item.id);
  const epistemic = /epistemic/i.test(item.id ?? "");
  const prerequisite = /prerequisite/i.test(item.id ?? "") || item.expectedRelation === "depends_on";
  if (!epistemic && !prerequisite) continue;
  audited.push({
    reviewId: `heldout:${item.id}`,
    claimA: { statement: fixture?.left ?? "" },
    claimB: { statement: fixture?.right ?? "" },
    predictedRelation: item.predictedRelation,
    predictedDirection: item.predictedDirection,
    humanRelation: item.expectedRelation,
    humanDirection: humanDirection(item.expectedDirection),
    modelSignals: item.prediction?.decisionSignals ?? [],
    duplicateBlockingSignals: item.prediction?.duplicateBlockingSignals ?? [],
    modelConfidence: item.prediction?.confidence ?? null,
    reviewerConfidence: "fixture",
    humanNotes: item.description ?? "Held-out calibration fixture.",
    rootCause: prerequisite ? "DIRECTION_SERIALIZATION_FAILURE" : "SIGNAL_EXTRACTION_FAILURE"
  });
}
const report = {
  version: "phase7.5-step4.2-v4-decision-architecture-audit-v1",
  generatedAt: new Date().toISOString(),
  sourceRunId: metadata.runId,
  promptVersion: metadata.candidatePromptVersion,
  relationPolicyVersion: metadata.candidateRelationPolicyVersion,
  allowedRootCauses: ["SIGNAL_EXTRACTION_FAILURE", "DUPLICATE_DECISION_FAILURE", "RELATION_DECISION_FAILURE", "ROLE_ASSIGNMENT_FAILURE", "DIRECTION_SERIALIZATION_FAILURE", "AMBIGUOUS_CASE"],
  summary: countBy(audited, (item) => item.rootCause),
  records: audited,
  findings: {
    duplicate: "Prompt v4 let the model both extract asymmetry signals and make the duplicate decision; four false positives reported no blocker despite material qualifier, mechanism, or epistemic differences.",
    direction: "Four frozen-edge errors are semantic role assignment errors. The held-out prerequisite case reasoned about the prerequisite correctly but serialized the opposite arrow.",
    architecture: "Separate semantic-delta extraction from deterministic duplicate eligibility, and semantic role assignment from deterministic direction mapping."
  }
};
await writeFile(path.join(reportsRoot, "relation-v4-decision-architecture-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(reportsRoot, "relation-v4-decision-architecture-audit.md"), render(report));
console.log(`Prompt v4 decision architecture audit: ${audited.length} cases\n${Object.entries(report.summary).map(([k,v]) => `${k}: ${v}`).join("\n")}`);

function entry(record, prediction, annotation, rootCause) {
  return { reviewId: record.reviewId, claimA: record.claimA, claimB: record.claimB,
    predictedRelation: prediction.relation === "none" ? "unrelated" : prediction.relation,
    predictedDirection: humanDirection(prediction.direction), humanRelation: annotation.humanRelation,
    humanDirection: annotation.humanDirection, modelSignals: prediction.decisionSignals ?? [],
    duplicateBlockingSignals: prediction.duplicateBlockingSignals ?? [], modelConfidence: prediction.confidence,
    reviewerConfidence: annotation.reviewerConfidence, humanNotes: annotation.notes, rootCause };
}
function humanDirection(value) { return value === "left_to_right" ? "a_to_b" : value === "right_to_left" ? "b_to_a" : value ?? "not_applicable"; }
function isDirectional(value) { return ["supports", "refines", "depends_on"].includes(value); }
function countBy(items, key) { const out = {}; for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1; return out; }
async function read(name) { return readAt(datasetRoot, name); }
async function readAt(folder, name) { return JSON.parse(await readFile(path.join(folder, name), "utf8")); }
function render(value) { return `# Relation v4 Decision Architecture Audit\n\n- Source run: ${value.sourceRunId}\n- Prompt: ${value.promptVersion}\n- Policy: ${value.relationPolicyVersion}\n- Audited failures: ${value.records.length}\n\n## Root Causes\n\n${Object.entries(value.summary).map(([k,v]) => `- ${k}: ${v}`).join("\n")}\n\n## Cases\n\n${value.records.map((x) => `### ${x.reviewId}\n\n- Claim A: ${x.claimA?.statement}\n- Claim B: ${x.claimB?.statement}\n- Predicted: ${x.predictedRelation} / ${x.predictedDirection}\n- Human: ${x.humanRelation} / ${x.humanDirection}\n- Signals: ${x.modelSignals.join(", ") || "none"}\n- Blockers: ${x.duplicateBlockingSignals.join(", ") || "none"}\n- Root cause: ${x.rootCause}\n- Notes: ${x.humanNotes || "none"}\n`).join("\n")}\n## Architecture Finding\n\n${value.findings.architecture}\n` }
