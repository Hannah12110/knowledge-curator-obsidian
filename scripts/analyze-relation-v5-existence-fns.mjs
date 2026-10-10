import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = path.join(root, "KnowledgeCuratorValidation/calibration/relation-v5/2026-10-07T13-15-08.329Z-f7f2427b");
const reports = path.join(root, "KnowledgeCuratorValidation/reports");
const datasetRoot = path.join(root, "KnowledgeCuratorValidation/datasets/graph-quality");
const [predictions, errors, edges, unrelated, annotations] = await Promise.all([
  read(path.join(run, "predictions.json")), read(path.join(run, "error-cases.json")),
  read(path.join(datasetRoot, "edge-review.json")), read(path.join(datasetRoot, "unrelated-review.json")),
  read(path.join(datasetRoot, "annotations.json"))
]);
const v4 = new Map(predictions.promptV4.map((item) => [item.pairId, item]));
const v5 = new Map(predictions.promptV5.map((item) => [item.pairId, item]));
const records = new Map([...edges.records, ...unrelated.records].map((item) => [item.reviewId, item]));
const falseNegatives = errors.filter((item) => item.predictedRelation === "unrelated" && item.humanRelation !== "unrelated").map((item) => {
  const before = v4.get(item.reviewId);
  const after = v5.get(item.reviewId);
  const record = records.get(item.reviewId);
  const annotation = annotations.edge[item.reviewId] ?? annotations.unrelated[item.reviewId];
  const rootCause = classify(item, after);
  return {
    reviewId: item.reviewId, claimA: item.claimA, claimB: item.claimB,
    humanRelation: item.humanRelation, humanDirection: item.humanDirection,
    v4Relation: relation(before), v5Relation: relation(after),
    v4Signals: { relationExistence: before?.relationExistence, decisionSignals: before?.decisionSignals ?? [], duplicateBlockingSignals: before?.duplicateBlockingSignals ?? [], reasoning: before?.reasoning },
    v5Signals: { relationExistence: after?.relationExistence, semanticDelta: after?.semanticDelta, reasoning: after?.reasoning },
    retrievalScore: record?.retrievalScore ?? null,
    reviewerConfidence: annotation?.reviewerConfidence,
    humanNotes: annotation?.notes,
    whyV4Recognized: before?.relation === "none" ? "Prompt v4 also missed this bridge." : `Prompt v4 used ${before?.decisionSignals?.join(", ") || before?.relation} to keep the proposition-level bridge.`,
    whyV5Rejected: after?.reasoning ?? "Prompt v5 returned unrelated despite the annotated bridge.",
    rootCause
  };
});
if (falseNegatives.length !== 13) throw new Error(`Expected 13 Prompt v5 false negatives, got ${falseNegatives.length}.`);
const output = {
  version: "phase7.5-step4.3-v5-fn-audit-v1", generatedAt: new Date().toISOString(),
  sourceRunId: "2026-10-07T13-15-08.329Z-f7f2427b", total: falseNegatives.length,
  rootCauseDistribution: countBy(falseNegatives, (item) => item.rootCause), falseNegatives
};
await writeFile(path.join(reports, "relation-v5-existence-fn-audit.json"), `${JSON.stringify(output, null, 2)}\n`);
await writeFile(path.join(reports, "relation-v5-existence-fn-audit.md"), render(output));
console.log(`Prompt v5 existence FN audit: ${falseNegatives.length}\n${Object.entries(output.rootCauseDistribution).map(([k,v]) => `${k}: ${v}`).join("\n")}`);

function classify(item, prediction) {
  const text = `${item.claimA.statement} ${item.claimB.statement} ${item.notes ?? ""}`;
  if (item.humanRelation === "refines") return "DETAIL_REFINEMENT_MISSED";
  if (/机制|实现|反向评测|持续|工程实践|时间层级/u.test(text)) return "MECHANISM_SUPPORT_MISSED";
  if (/真实数据|数据显示|核查|证据|来源主张/u.test(text)) return "EVIDENCE_BRIDGE_MISSED";
  if (/失败|问题|不足|太少|风险|动因|必要性/u.test(text)) return "REASON_SUPPORT_MISSED";
  if (prediction?.semanticDelta?.sameCoreProposition === false) return "COMPARABILITY_TOO_STRICT";
  return "RELATION_THRESHOLD_TOO_STRICT";
}
function relation(value) { return value?.relation === "none" ? "unrelated" : value?.relation ?? "missing"; }
function countBy(items, fn) { const result = {}; for (const item of items) result[fn(item)] = (result[fn(item)] ?? 0) + 1; return result; }
async function read(file) { return JSON.parse(await readFile(file, "utf8")); }
function render(value) { return `# Prompt v5 Relation Existence False-Negative Audit\n\n- Source run: ${value.sourceRunId}\n- False negatives: ${value.total}\n\n## Root Cause Distribution\n\n${Object.entries(value.rootCauseDistribution).map(([k,v]) => `- ${k}: ${v}`).join("\n")}\n\n## Cases\n\n${value.falseNegatives.map((x) => `### ${x.reviewId}\n\n- Claim A: ${x.claimA.statement}\n- Claim B: ${x.claimB.statement}\n- Human: ${x.humanRelation} / ${x.humanDirection}\n- Prompt v4: ${x.v4Relation}; signals=${x.v4Signals.decisionSignals.join(", ") || "none"}\n- Prompt v5: ${x.v5Relation}; existence=${x.v5Signals.relationExistence}\n- Semantic delta: ${JSON.stringify(x.v5Signals.semanticDelta)}\n- Why v4 recognized: ${x.whyV4Recognized}\n- Why v5 rejected: ${x.whyV5Rejected}\n- Root cause: ${x.rootCause}\n- Human notes: ${x.humanNotes || "none"}\n`).join("\n")}\n` }
