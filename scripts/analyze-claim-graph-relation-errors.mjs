import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "datasets", "graph-quality");
const reportRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "reports");
const [manifest, edgeFile, unrelatedFile, annotations] = await Promise.all([
  load("evaluation-manifest.json"), load("edge-review.json"), load("unrelated-review.json"), load("annotations.json")
]);
for (const value of [edgeFile, unrelatedFile, annotations]) {
  if (value.datasetFingerprint !== manifest.datasetFingerprint) throw new Error("Evaluation Dataset fingerprint mismatch.");
}

const validEdges = edgeFile.records.flatMap((record) => {
  const annotation = annotations.edge[record.reviewId];
  return annotation === undefined || annotation.humanRelation === "uncertain" || annotation.reviewerConfidence === "low"
    ? [] : [{ record, annotation }];
});
const validUnrelated = unrelatedFile.records.flatMap((record) => {
  const annotation = annotations.unrelated[record.reviewId];
  return annotation === undefined || annotation.humanRelation === "uncertain" || annotation.reviewerConfidence === "low"
    ? [] : [{ record, annotation }];
});
const confusion = group(validEdges, ({ record, annotation }) => `${record.predictedRelation} -> ${annotation.humanRelation}`);
const directional = validEdges.filter(({ record, annotation }) =>
  ["supports", "refines", "depends_on"].includes(record.predictedRelation) && record.predictedRelation === annotation.humanRelation
);
const directionConfusion = group(directional, ({ record, annotation }) => `${record.predictedDirection} -> ${annotation.humanDirection}`);
const unrelatedHumanLabels = group(validUnrelated, ({ annotation }) => annotation.humanRelation);
const cases = validEdges.map(({ record, annotation }) => ({
  reviewId: record.reviewId,
  claimA: record.claimA,
  claimB: record.claimB,
  predictedRelation: record.predictedRelation,
  predictedDirection: record.predictedDirection,
  humanRelation: annotation.humanRelation,
  humanDirection: annotation.humanDirection,
  modelConfidence: record.modelConfidence,
  reviewerConfidence: annotation.reviewerConfidence,
  humanNotes: annotation.notes,
  relationMatch: record.predictedRelation === annotation.humanRelation,
  directionMatch: !["supports", "refines", "depends_on"].includes(record.predictedRelation) ||
    record.predictedRelation !== annotation.humanRelation || record.predictedDirection === annotation.humanDirection
}));
const report = {
  version: "phase7.5-step4-error-analysis-v1",
  generatedAt: new Date().toISOString(),
  datasetFingerprint: manifest.datasetFingerprint,
  graphFingerprint: manifest.graphFingerprint,
  claimStoreFingerprint: manifest.claimStoreFingerprint,
  reviewed: { edges: validEdges.length, unrelated: validUnrelated.length },
  confusionMatrix: confusion,
  directionConfusionMatrix: directionConfusion,
  unrelatedHumanLabels,
  cases,
  findings: {
    serializationConvention: "Graph edge fromClaimId -> toClaimId means source/supporting/refining/dependency-side Claim -> target/base Claim.",
    serializationMismatchDetected: false,
    supportsPredictedAsRefinesByHuman: count(confusion, "supports -> refines"),
    directionReversals: count(directionConfusion, "a_to_b -> b_to_a"),
    duplicateFalsePositives: validEdges.filter(({ record, annotation }) => record.predictedRelation === "duplicate" && annotation.humanRelation !== "duplicate").length,
    sampledUnrelatedFalseNegatives: validUnrelated.filter(({ annotation }) => annotation.humanRelation !== "unrelated").length
  }
};
await mkdir(reportRoot, { recursive: true });
await Promise.all([
  writeFile(path.join(reportRoot, "claim-graph-relation-error-analysis.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(path.join(reportRoot, "claim-graph-relation-error-analysis.md"), render(report), "utf8")
]);
console.log(`Baseline relation error analysis: ${validEdges.length} edges, ${validUnrelated.length} unrelated reviews.`);
console.log(`supports -> refines: ${report.findings.supportsPredictedAsRefinesByHuman}`);
console.log(`direction reversals: ${report.findings.directionReversals}`);
console.log(`duplicate false positives: ${report.findings.duplicateFalsePositives}`);
console.log(`sampled unrelated false negatives: ${report.findings.sampledUnrelatedFalseNegatives}`);

async function load(name) { return JSON.parse(await readFile(path.join(datasetRoot, name), "utf8")); }
function group(items, key) {
  const output = {};
  for (const item of items) {
    const value = key(item);
    output[value] ??= { count: 0, reviewIds: [] };
    output[value].count += 1;
    output[value].reviewIds.push(item.record?.reviewId ?? item.annotation?.reviewId ?? "");
  }
  return output;
}
function count(groups, key) { return groups[key]?.count ?? 0; }
function render(value) {
  const matrix = Object.entries(value.confusionMatrix).sort().map(([key, item]) => `- ${key}: ${item.count} (${item.reviewIds.join(", ")})`).join("\n");
  const directions = Object.entries(value.directionConfusionMatrix).sort().map(([key, item]) => `- ${key}: ${item.count}`).join("\n");
  const details = value.cases.map((item) => [
    `### ${item.reviewId}`,
    `- Claim A: ${item.claimA.statement}`,
    `- Claim B: ${item.claimB.statement}`,
    `- Predicted: ${item.predictedRelation} / ${item.predictedDirection}`,
    `- Human: ${item.humanRelation} / ${item.humanDirection}`,
    `- Model confidence: ${item.modelConfidence}`,
    `- Reviewer confidence: ${item.reviewerConfidence}`,
    `- Human notes: ${item.humanNotes || "(none)"}`
  ].join("\n")).join("\n\n");
  return `# Claim Graph Relation Error Analysis\n\n## Frozen Baseline\n\n- Dataset: ${value.datasetFingerprint}\n- Graph: ${value.graphFingerprint}\n- Edge reviews: ${value.reviewed.edges}\n- Unrelated reviews: ${value.reviewed.unrelated}\n\n## Relation Confusion Matrix\n\n${matrix}\n\n## Direction Error Analysis\n\n- Convention: ${value.findings.serializationConvention}\n- Serialization mismatch detected: ${value.findings.serializationMismatchDetected}\n${directions}\n\n## Key Findings\n\n- supports -> refines: ${value.findings.supportsPredictedAsRefinesByHuman}\n- Direction reversals: ${value.findings.directionReversals}\n- Duplicate false positives: ${value.findings.duplicateFalsePositives}\n- Sampled unrelated false negatives: ${value.findings.sampledUnrelatedFalseNegatives}\n\n## All Edge Cases\n\n${details}\n`;
}
