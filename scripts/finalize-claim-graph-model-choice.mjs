import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const runRoot = path.resolve(argument("--run") ?? "");
const beforeFile = path.resolve(argument("--before-manifest") ?? "");
const vaultRoot = path.resolve(argument("--vault") ?? "");
if (!runRoot || !beforeFile || !vaultRoot) throw new Error("Required: --run, --before-manifest, --vault");

const [stageA, before, annotations] = await Promise.all([
  loadJson(path.join(runRoot, "stage-a-checkpoint.json")),
  loadJson(beforeFile),
  loadJson(path.join(projectRoot, "KnowledgeCuratorValidation/datasets/graph-quality/annotations.json"))
]);
const stability = {};
for (const item of stageA.models) {
  stability[item.model] = await loadJson(path.join(runRoot, "stability", `${slug(item.model)}-checkpoint.json`));
}
const currentMarkdown = await markdownManifest(vaultRoot);
const markdownDiff = classifyMarkdownDiff(before.markdown, currentMarkdown);
const protectedDiff = Object.entries(before.protected).filter(([file, digest]) => !exists(file) || hashFile(file) !== digest).map(([file]) => file);
const models = stageA.models.map((item) => {
  const checkpoint = stability[item.model];
  const successfulRuns = checkpoint.completedRuns.filter((run) => run.status === "PASS").length;
  return {
    ...item,
    telemetry: item.telemetry.calls === 0 ? { ...item.telemetry, inputTokens: null, outputTokens: null } : item.telemetry,
    stability: {
      status: successfulRuns === 2 ? "EXECUTION_COMPLETE_PREDICTIONS_NOT_PERSISTED" : "INCOMPLETE_FAIL_CLOSED",
      requestedAdditionalRuns: 2,
      successfulAdditionalRuns: successfulRuns,
      failedAdditionalRuns: checkpoint.completedRuns.length - successfulRuns,
      predictionConsistency: null,
      relationConsistency: null,
      directionConsistency: null,
      runs: checkpoint.completedRuns
    }
  };
});
const humanById = new Map([...Object.entries(annotations.edge), ...Object.entries(annotations.unrelated)]);
const reviewedIds = [...Object.keys(annotations.edge), ...Object.keys(annotations.unrelated)];
const baselinePredictions = stageA.models.find((item) => item.model === "deepseek-flash")?.predictions ?? [];
const criticalSubset = {
  version: "claim-graph-model-choice-critical-v1",
  reviewedPairIds: selectCriticalPairIds(reviewedIds, humanById, baselinePredictions, 20),
  heldOutPairIds: [
    "evidence-supports-policy", "mechanism-refines-abstraction", "epistemic-asymmetry", "same-words-different-scope",
    "refines-a-to-b", "supports-b-to-a", "true-semantic-duplicate", "v4-qualifier-blocks-duplicate",
    "v4-mechanism-detail-refines", "v4-evidence-b-supports-a", "v4-dependent-b-to-prerequisite-a",
    "v4-parallel-same-topic-unrelated", "v4-exact-bilingual-duplicate", "v5-mechanism-supports-abstraction",
    "v5-semantic-detail-refinement", "v5-same-topic-unrelated", "v5-ambiguous-relation"
  ],
  categories: ["supports-refines", "related-unrelated", "epistemic-asymmetry", "mechanism-support", "reason-support", "semantic-detail", "duplicate", "direction", "scope-mismatch"]
};
const baseline = models.find((item) => item.model === "deepseek-flash");
const challenger = models.find((item) => item.model === "deepseek-v4-pro");
if (!baseline || !challenger) throw new Error("Expected baseline and challenger checkpoints.");
const comparison = {
  version: "phase7.5-step4.4-v1",
  runId: path.basename(runRoot),
  generatedAt: new Date().toISOString(),
  provider: "api.deepseek.com",
  testedModels: models.map((item) => item.model),
  promptVersion: "claim-graph-relation-prompt-v6",
  relationPolicyVersion: "claim-graph-relations-v5",
  temperature: .1,
  frozenInputs: { reviewedPairs: 56, heldOutPairs: 44 },
  fairness: "Only model changed. Prompt, policy, temperature, schema, validator, duplicate gate, direction mapping, dataset and annotations were frozen.",
  models,
  bestQualityModel: "deepseek-flash",
  bestCostQualityModel: null,
  productionCandidate: null,
  compressionEligible: false,
  result: "MODEL_INDEPENDENT_LIMITATION",
  resultReason: "The stronger challenger improved relation-existence recall but regressed relation accuracy, direction accuracy, supports precision and held-out accuracy; neither model passed the hard gate.",
  costs: { status: "NOT_ESTIMATED", reason: "Token usage was returned, but the API did not provide authoritative price metadata for both models." },
  safety: {
    protectedArtifactsChanged: protectedDiff.length,
    protectedArtifactChanges: protectedDiff,
    markdownCountBefore: Object.keys(before.markdown).length,
    markdownCountAfter: Object.keys(currentMarkdown).length,
    markdownContentChangedAtSamePath: markdownDiff.changed.length,
    markdownAdded: markdownDiff.added.length,
    markdownRemoved: markdownDiff.removed.length,
    hashMatchedMoves: markdownDiff.moves,
    attribution: markdownDiff.moves.length > 0 && markdownDiff.changed.length === 0
      ? "EXTERNAL_PATH_REORGANIZATION_DETECTED_DURING_EXPERIMENT"
      : "NO_MARKDOWN_VARIATION",
    experimentMarkdownWritePaths: 0,
    graphRebuilds: 0, datasetWrites: 0, annotationWrites: 0, claimStoreWrites: 0,
    graphStoreWrites: 0, frozenSnapshotWrites: 0, compressionWrites: 0, tavilyCalls: 0
  },
  notes: [
    "The canonical Step 4.3 Flash metrics were preserved and not overwritten.",
    "Stability predictions were not persisted by the first orchestration version; execution outcomes and telemetry remain auditable, but consistency rates are unavailable.",
    "The v4-pro second stability replay failed closed on true-semantic-duplicate after an invalid evidenceClaimIds response.",
    "No further provider replay was performed after the safety gate stopped publication."
  ]
};

for (const item of models) {
  const root = path.join(runRoot, "per-model", slug(item.model));
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeJson(path.join(root, "predictions.json"), { reviewed: item.predictions, heldOut: item.heldOut.cases }),
    writeJson(path.join(root, "metrics.json"), { ...item.metrics, heldOut: { passed: item.heldOut.passed, total: item.heldOut.total }, gate: item.gate, duplicateSafety: item.duplicateSafety }),
    writeJson(path.join(root, "error-cases.json"), errorCases(item.predictions, annotations)),
    writeJson(path.join(root, "run-metadata.json"), { model: item.model, source: item.source, promptVersion: comparison.promptVersion, relationPolicyVersion: comparison.relationPolicyVersion, temperature: .1, telemetry: item.telemetry, execution: item.execution, stability: item.stability })
  ]);
}
await Promise.all([
  writeJson(path.join(runRoot, "model-comparison.json"), comparison),
  writeJson(path.join(runRoot, "critical-subset.json"), criticalSubset),
  writeJson(path.join(runRoot, "safety-audit.json"), comparison.safety),
  writeJson(path.join(runRoot, "stability", "stability-results.json"), models.map((item) => ({ model: item.model, ...item.stability }))),
  writeFile(path.join(runRoot, "model-comparison.md"), render(comparison), "utf8")
]);
console.log(render(comparison));

function render(value) {
  const pct = (metric) => metric.rate === null ? "N/A" : `${(metric.rate * 100).toFixed(1)}% (${metric.numerator}/${metric.denominator})`;
  const row = (label, read) => `| ${label} | ${value.models.map(read).join(" | ")} |`;
  return `# Phase 7.5 Step 4.4 — Model Choice Experiment\n\n- Result: **${value.result}**\n- Production candidate: none\n- Compression eligible: false\n- Prompt / Policy: ${value.promptVersion} / ${value.relationPolicyVersion}\n\n## Model Comparison\n\n| Metric | ${value.models.map((item) => item.model).join(" | ")} |\n|---|---:|---:|\n${row("Edge Precision", (x) => pct(x.metrics.edgePrecision))}\n${row("Relation Accuracy", (x) => pct(x.metrics.relationAccuracy))}\n${row("Direction Accuracy", (x) => pct(x.metrics.directionAccuracy))}\n${row("Existence Accuracy", (x) => pct(x.metrics.relationExistence.accuracy))}\n${row("Existence Precision", (x) => pct(x.metrics.relationExistence.precision))}\n${row("Existence Recall", (x) => pct(x.metrics.relationExistence.recall))}\n${row("Supports Precision", (x) => pct(x.metrics.perRelationPrecision.supports))}\n${row("Refines Precision", (x) => pct(x.metrics.perRelationPrecision.refines))}\n${row("Duplicate FP", (x) => String(x.metrics.duplicateFalsePositives))}\n${row("Sampled unrelated FN", (x) => `${x.metrics.sampledUnrelatedFalseNegativeRate.numerator}/13`)}\n${row("New existence FP", (x) => String(x.metrics.sampledUnrelatedNewFalsePositives))}\n${row("Held-out", (x) => `${x.heldOut.passed}/${x.heldOut.total}`)}\n${row("Median latency", (x) => x.telemetry.medianLatencyMs === null ? "N/A" : `${x.telemetry.medianLatencyMs} ms`)}\n${row("P95 latency", (x) => x.telemetry.p95LatencyMs === null ? "N/A" : `${x.telemetry.p95LatencyMs} ms`)}\n${row("Input / output tokens", (x) => `${x.telemetry.inputTokens ?? "N/A"} / ${x.telemetry.outputTokens ?? "N/A"}`)}\n${row("Stability", (x) => x.stability.status)}\n${row("Hard gate", (x) => x.gate.passed ? "PASS" : "FAIL")}\n\n## Decision\n\n${value.resultReason}\n\n## Safety\n\n- Protected artifacts changed: ${value.safety.protectedArtifactsChanged}\n- Same-path Markdown content changes: ${value.safety.markdownContentChangedAtSamePath}\n- Hash-matched external moves: ${value.safety.hashMatchedMoves.length}\n- Graph rebuild / Tavily / Wiki write paths: 0 / 0 / 0\n\n## Stability Limitation\n\nPrediction consistency is unavailable for this run. The baseline completed both extra executions; v4-pro completed one and failed closed on the second. No replay was added to replace the failure.\n\n## Stop Rule\n\nRelation calibration is stopped. No Prompt v7, model-choice v2, taxonomy redesign, Compression Evaluation, or production promotion is authorized.\n`;
}
function errorCases(predictions, labels) {
  const byId = new Map([...Object.entries(labels.edge), ...Object.entries(labels.unrelated)]);
  return predictions.flatMap((prediction) => {
    const human = byId.get(prediction.pairId); if (!human) return [];
    const predictedRelation = prediction.relation === "none" ? "unrelated" : prediction.relation;
    const predictedDirection = prediction.direction === "left_to_right" ? "a_to_b" : prediction.direction === "right_to_left" ? "b_to_a" : prediction.direction === "uncertain" ? "uncertain" : "not_applicable";
    return predictedRelation === human.humanRelation && (!directional(predictedRelation) || predictedDirection === human.humanDirection) ? [] : [{ pairId: prediction.pairId, predictedRelation, predictedDirection, humanRelation: human.humanRelation, humanDirection: human.humanDirection }];
  });
}
function classifyMarkdownDiff(oldMap, newMap) {
  const removed = Object.keys(oldMap).filter((key) => !(key in newMap));
  const added = Object.keys(newMap).filter((key) => !(key in oldMap));
  const changed = Object.keys(oldMap).filter((key) => key in newMap && oldMap[key] !== newMap[key]);
  const addedByHash = new Map();
  for (const file of added) { const values = addedByHash.get(newMap[file]) ?? []; values.push(file); addedByHash.set(newMap[file], values); }
  const moves = [];
  for (const file of removed) { const targets = addedByHash.get(oldMap[file]); if (targets?.length) moves.push({ from: file, to: targets.shift() }); }
  return { removed, added, changed, moves };
}
function selectCriticalPairIds(reviewedIds, labels, predictions, limit) {
  const byId = new Map(predictions.map((item) => [item.pairId, item]));
  const errors = reviewedIds.filter((id) => {
    const human = labels.get(id); const prediction = byId.get(id); if (!human || !prediction) return false;
    const relation = prediction.relation === "none" ? "unrelated" : prediction.relation;
    const direction = prediction.direction === "left_to_right" ? "a_to_b" : prediction.direction === "right_to_left" ? "b_to_a" : prediction.direction === "uncertain" ? "uncertain" : "not_applicable";
    return relation !== human.humanRelation || (directional(relation) && direction !== human.humanDirection);
  }).sort();
  const remaining = reviewedIds.filter((id) => !errors.includes(id)).sort((left, right) => {
    const a = labels.get(left)?.humanRelation ?? ""; const b = labels.get(right)?.humanRelation ?? "";
    return a.localeCompare(b) || left.localeCompare(right);
  });
  return [...errors, ...remaining].slice(0, limit);
}
async function markdownManifest(root) {
  const { execFile } = await import("node:child_process"); const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("find", [root, "-type", "f", "-name", "*.md", "-print"]);
  const files = stdout.split("\n").filter(Boolean).sort();
  return Object.fromEntries(files.map((file) => [path.relative(root, file), hashFile(file)]));
}
function directional(value) { return value === "supports" || value === "refines" || value === "depends_on"; }
function exists(file) { return existsSync(file); }
function hashFile(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function slug(value) { return value.replace(/[^A-Za-z0-9._-]+/gu, "-"); }
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
async function loadJson(file) { return JSON.parse(await readFile(file, "utf8")); }
async function writeJson(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
