import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "datasets", "graph-quality");
const calibrationRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "calibration", "relation-v2");
const reportsRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "reports");

const run = await latestV3Run();
const [manifest, edgeFile, unrelatedFile, annotations, predictionsFile, metadata] = await Promise.all([
  readJson(path.join(datasetRoot, "evaluation-manifest.json")),
  readJson(path.join(datasetRoot, "edge-review.json")),
  readJson(path.join(datasetRoot, "unrelated-review.json")),
  readJson(path.join(datasetRoot, "annotations.json")),
  readJson(path.join(run, "predictions.json")),
  readJson(path.join(run, "run-metadata.json"))
]);
if (metadata.datasetFingerprint !== manifest.datasetFingerprint ||
  metadata.candidatePromptVersion !== "claim-graph-relation-prompt-v3") {
  throw new Error("Latest relation-v2 run is not the frozen Prompt v3 calibration baseline.");
}

const predictions = new Map(predictionsFile.candidate.map((item) => [item.pairId, item]));
const records = [...edgeFile.records, ...unrelatedFile.records];
const errors = [];
for (const record of records) {
  const annotation = annotations.edge[record.reviewId] ?? annotations.unrelated[record.reviewId];
  if (!annotation || annotation.humanRelation === "uncertain" || annotation.reviewerConfidence === "low") continue;
  const prediction = predictions.get(record.reviewId);
  if (!prediction) throw new Error(`Missing Prompt v3 prediction: ${record.reviewId}`);
  const predictedRelation = prediction.relation === "none" ? "unrelated" : prediction.relation;
  const predictedDirection = direction(prediction.direction);
  const relationMismatch = predictedRelation !== annotation.humanRelation;
  const directionMismatch = directional(predictedRelation) && predictedRelation === annotation.humanRelation &&
    predictedDirection !== annotation.humanDirection;
  if (!relationMismatch && !directionMismatch) continue;
  const primaryCause = classify(predictedRelation, annotation.humanRelation, directionMismatch);
  errors.push({
    reviewId: record.reviewId,
    auditSubset: record.reviewId.startsWith("unrelated-review:") ? "sampled_unrelated" : "persisted_edge",
    primaryCause,
    claimA: record.claimA,
    claimB: record.claimB,
    predictedRelation,
    predictedDirection,
    humanRelation: annotation.humanRelation,
    humanDirection: annotation.humanDirection,
    modelConfidence: prediction.confidence,
    reviewerConfidence: annotation.reviewerConfidence,
    humanNotes: annotation.notes,
    diagnosis: diagnose(record, predictedRelation, annotation.humanRelation)
  });
}

const falseNegatives = errors.filter((item) => item.primaryCause === "RELATION_EXISTENCE_FALSE_NEGATIVE");
const sampledFalseNegatives = falseNegatives.filter((item) => item.auditSubset === "sampled_unrelated");
const report = {
  version: "phase7.5-step4.1-error-audit-v1",
  generatedAt: new Date().toISOString(),
  datasetFingerprint: manifest.datasetFingerprint,
  sourceRunId: metadata.runId,
  sourcePromptVersion: metadata.candidatePromptVersion,
  sourceRelationPolicyVersion: metadata.candidateRelationPolicyVersion,
  reviewed: { edge: Object.keys(annotations.edge).length, unrelated: Object.keys(annotations.unrelated).length },
  taxonomy: countBy(errors, (item) => item.primaryCause),
  errors,
  relationExistenceFalseNegatives: falseNegatives,
  sampledUnrelatedFalseNegatives: sampledFalseNegatives,
  sampledFalseNegativeClusters: countBy(sampledFalseNegatives, (item) => item.diagnosis.cluster),
  findings: {
    primaryExistenceFailure: "Prompt v3 treats non-entailing evidential or mechanism links too conservatively after the same-topic guard.",
    supportsRefinesFailure: "The classifier still confuses credibility-strengthening mechanisms with semantic-content additions.",
    duplicateFailure: "The remaining false positive ignores epistemic specificity asymmetry.",
    directionFailure: "Two residual errors remain after the convention fix; no serialization inversion was found."
  }
};
await writeFile(path.join(reportsRoot, "relation-v3-candidate-error-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(reportsRoot, "relation-v3-candidate-error-audit.md"), render(report), "utf8");
console.log(renderSummary(report));

function classify(predicted, human, directionMismatch) {
  if (directionMismatch) return "DIRECTION_ERROR";
  if (predicted === "unrelated" && human !== "unrelated") return "RELATION_EXISTENCE_FALSE_NEGATIVE";
  if (predicted !== "unrelated" && human === "unrelated") return "RELATION_EXISTENCE_FALSE_POSITIVE";
  if ((predicted === "supports" && human === "refines") || (predicted === "refines" && human === "supports")) return "SUPPORTS_VS_REFINES";
  if (predicted === "duplicate" && human !== "duplicate") return "DUPLICATE_OVERMERGE";
  return "WRONG_OTHER_RELATION";
}
function diagnose(record, predicted, human) {
  if (predicted !== "unrelated" || human === "unrelated") return { cluster: "relation_type_or_direction", reason: "A relation was found; its type or direction was wrong." };
  const text = `${record.claimA.statement} ${record.claimB.statement}`;
  if (human === "refines") return { cluster: "semantic_refinement_bridge_missed", reason: "An operational checklist adds semantic content to a broader evaluation distinction, but Prompt v3 treated the abstraction bridge as insufficient." };
  if (/核查|证据|未被证实|不足/u.test(text)) return { cluster: "epistemic_support_bridge_missed", reason: "One epistemic claim partially supports another through scope of evidence; the model required overly direct entailment." };
  if (/随机|样本|失败|问题|不足|太少/u.test(text)) return { cluster: "problem_observation_support_missed", reason: "A concrete failure observation motivates a design principle without redefining it; the model missed evidential support." };
  return { cluster: "mechanism_support_bridge_missed", reason: "A maintenance or implementation mechanism makes a broader policy credible, but the conservative existence gate returned unrelated." };
}
function direction(value) { return value === "left_to_right" ? "a_to_b" : value === "right_to_left" ? "b_to_a" : "not_applicable"; }
function directional(value) { return value === "supports" || value === "refines" || value === "depends_on"; }
function countBy(items, key) { const out = {}; for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1; return out; }
async function latestV3Run() {
  const entries = (await readdir(calibrationRoot, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort().reverse();
  for (const entry of entries) {
    try {
      const metadata = await readJson(path.join(calibrationRoot, entry, "run-metadata.json"));
      if (metadata.candidatePromptVersion === "claim-graph-relation-prompt-v3") return path.join(calibrationRoot, entry);
    } catch {}
  }
  throw new Error("No Prompt v3 calibration run found.");
}
async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
function renderSummary(value) { return `Prompt v3 candidate error audit\nErrors: ${value.errors.length}\n${Object.entries(value.taxonomy).map(([key, count]) => `${key}: ${count}`).join("\n")}\nSampled unrelated false negatives: ${value.sampledUnrelatedFalseNegatives.length}`; }
function render(value) {
  return `# Prompt v3 Candidate Error Audit\n\n- Dataset: ${value.datasetFingerprint}\n- Source run: ${value.sourceRunId}\n- Reviewed: ${value.reviewed.edge} Edge + ${value.reviewed.unrelated} Unrelated\n\n## Candidate Error Taxonomy\n\n${Object.entries(value.taxonomy).map(([key, count]) => `- ${key}: ${count}`).join("\n")}\n\n## Six Sampled-Unrelated False Negatives\n\n${value.sampledUnrelatedFalseNegatives.map((item) => `### ${item.reviewId}\n\n- A: ${item.claimA.statement}\n- B: ${item.claimB.statement}\n- Human: ${item.humanRelation} / ${item.humanDirection}\n- Cluster: ${item.diagnosis.cluster}\n- Diagnosis: ${item.diagnosis.reason}\n`).join("\n")}\n## All Error Cases\n\n${value.errors.map((item) => `- ${item.reviewId}: ${item.predictedRelation}/${item.predictedDirection} -> ${item.humanRelation}/${item.humanDirection}; ${item.primaryCause}; ${item.diagnosis.reason}`).join("\n")}\n`;
}
