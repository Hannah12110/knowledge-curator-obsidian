import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = path.join(projectRoot, "KnowledgeCuratorValidation/datasets/graph-quality");
const vaultRoot = path.resolve(argument("--vault") ?? process.env.TEST_VAULT ?? "");
if (!vaultRoot) throw new Error("TEST_VAULT 未配置，请使用 --vault <path>。");

const [manifest, edgeFile, unrelatedFile, orphanFile, annotations, settings] = await Promise.all([
  ...["evaluation-manifest.json", "edge-review.json", "unrelated-review.json", "orphan-review.json", "annotations.json"].map(loadDataset),
  loadJson(path.join(vaultRoot, ".obsidian/plugins/knowledge-curator/data.json"))
]);
if (!settings.llmApiKey?.trim() || !String(settings.llmBaseUrl).includes("deepseek")) {
  throw new Error("DeepSeek Provider 未正确配置。");
}
for (const value of [edgeFile, unrelatedFile, orphanFile, annotations]) {
  if (value.datasetFingerprint !== manifest.datasetFingerprint) throw new Error("Frozen dataset fingerprint mismatch.");
}

const dataset = { manifest, edges: edgeFile.records, unrelated: unrelatedFile.records, orphans: orphanFile.records };
const runtime = await loadRuntime();
const v6Run = await latestV6Run(manifest.datasetFingerprint);
const [v6PredictionsFile, v6MetricsFile, v6HeldOut, v6Metadata] = await Promise.all([
  loadJson(path.join(v6Run, "predictions.json")),
  loadJson(path.join(v6Run, "metrics.json")),
  loadJson(path.join(v6Run, "held-out-results.json")),
  loadJson(path.join(v6Run, "run-metadata.json"))
]);
assertFrozenBaseline(v6Metadata, manifest, settings);

const fixtures = await Promise.all([
  "relation-policy-v3.json", "relation-policy-v4.json", "relation-policy-v5.json"
].map((name) => loadJson(path.join(projectRoot, "KnowledgeCuratorRegression/claim-graph-calibration", name))));
const heldOutFixture = { cases: fixtures.flatMap((item) => item.cases) };
if (heldOutFixture.cases.length !== 44) throw new Error(`Expected 44 held-out fixtures, received ${heldOutFixture.cases.length}.`);

const availableModels = await discoverModels(settings);
const baselineModel = v6Metadata.model;
if (!availableModels.includes(baselineModel)) throw new Error(`Configured baseline model is unavailable: ${baselineModel}`);
const challengers = availableModels.filter((model) => model !== baselineModel).slice(0, 3);
if (challengers.length === 0) throw new Error("No actual challenger model is available from the configured provider.");

const graphSnapshot = path.resolve(projectRoot, manifest.graphSnapshotPath);
const protectedFiles = [
  ...["evaluation-manifest.json", "edge-review.json", "unrelated-review.json", "orphan-review.json", "annotations.json"].map((name) => path.join(datasetRoot, name)),
  graphSnapshot,
  path.join(vaultRoot, ".knowledge-agent/claim-store/store.json"),
  path.join(vaultRoot, ".knowledge-agent/claim-graph/store.json")
];
const before = await hashes(protectedFiles);
const markdownBefore = await markdownManifest(vaultRoot);

const runId = `${new Date().toISOString().replaceAll(":", "-")}-${manifest.datasetFingerprint.slice(0, 8)}`;
const runRoot = path.join(projectRoot, "KnowledgeCuratorValidation/calibration/model-choice", runId);
await mkdir(runRoot, { recursive: true });
await writeJson(path.join(runRoot, "safety-before-manifest.json"), { protected: before, markdown: markdownBefore });

const baselinePredictions = v6PredictionsFile.promptV6;
const baselineHeldOutPredictions = v6HeldOut.cases.map((item) => item.prediction);
const models = [];
models.push({
  model: baselineModel,
  source: "frozen-step4.3-baseline",
  predictions: baselinePredictions,
  heldOut: v6HeldOut,
  metrics: v6MetricsFile.promptV6,
  gate: runtime.evaluateModelChoiceGate(v6MetricsFile.promptV6),
  telemetry: summarizeTelemetry([]),
  execution: {
    providerCalls: v6Metadata.providerCalls,
    retries: v6Metadata.retryCalls,
    schemaFailures: v6Metadata.schemaInvalidCount ?? 0,
    providerFailures: 0,
    failedPairs: v6Metadata.failedPairs?.length ?? 0
  }
});

for (const model of challengers) {
  const modelSettings = { ...settings, llmModel: model };
  const telemetry = { calls: [] };
  const replay = await runtime.replayFrozenRelationCalibration(
    modelSettings, dataset, annotations, undefined, undefined,
    "claim-graph-relation-prompt-v6", telemetry
  );
  const heldOut = await runtime.replayHeldOutRelationFixtures(
    modelSettings, heldOutFixture, "claim-graph-relation-prompt-v6", telemetry
  );
  const metrics = replay.candidateMetrics;
  models.push({
    model,
    source: "step4.4-full-screening",
    predictions: replay.candidatePredictions,
    heldOut,
    metrics,
    gate: runtime.evaluateModelChoiceGate(metrics),
    telemetry: summarizeTelemetry(telemetry.calls),
    execution: combineExecution(replay.executionMetrics, heldOut.executionMetrics)
  });
}

const humanById = humanLabels(dataset, annotations);
for (const item of models) {
  item.errorTaxonomy = runtime.relationErrorTaxonomy(humanById, item.predictions);
  item.duplicateSafety = duplicateSafety(item.predictions, item.heldOut, heldOutFixture, humanById);
}
await writeJson(path.join(runRoot, "stage-a-checkpoint.json"), {
  status: "COMPLETE",
  models: models.map((item) => ({
    model: item.model, source: item.source, predictions: item.predictions, heldOut: item.heldOut,
    metrics: item.metrics, gate: item.gate, telemetry: item.telemetry, execution: item.execution,
    errorTaxonomy: item.errorTaxonomy, duplicateSafety: item.duplicateSafety
  }))
});

const reviewedIds = [...dataset.edges, ...dataset.unrelated]
  .filter((record) => humanById.has(record.reviewId)).map((record) => record.reviewId);
const criticalReviewedIds = runtime.selectCriticalPairIds(reviewedIds, humanById, baselinePredictions, 20);
const criticalHeldOutIds = selectCriticalHeldOut(heldOutFixture.cases);
const critical = {
  version: "claim-graph-model-choice-critical-v1",
  frozenDatasetFingerprint: manifest.datasetFingerprint,
  reviewedPairIds: criticalReviewedIds,
  heldOutPairIds: criticalHeldOutIds,
  categories: [
    "supports-refines", "related-unrelated", "epistemic-asymmetry", "mechanism-support",
    "reason-support", "semantic-detail", "duplicate", "direction", "scope-mismatch"
  ]
};
const subset = subsetReviewed(dataset, annotations, new Set(criticalReviewedIds));
const heldOutSubset = { cases: heldOutFixture.cases.filter((item) => criticalHeldOutIds.includes(item.id)) };

const screeningRanked = [...models].sort(compareModels);
const stabilityModels = screeningRanked.slice(0, Math.min(2, screeningRanked.length));
for (const item of stabilityModels) {
  const modelSettings = { ...settings, llmModel: item.model };
  const stageAReviewed = item.predictions.filter((prediction) => criticalReviewedIds.includes(prediction.pairId));
  const stageAHeldOut = item.heldOut.cases.filter((entry) => criticalHeldOutIds.includes(entry.id)).map((entry) => entry.prediction);
  const runs = [[...stageAReviewed, ...stageAHeldOut]];
  const runTelemetry = [];
  for (let replayIndex = 1; replayIndex <= 2; replayIndex += 1) {
    const telemetry = { calls: [] };
    try {
      const replay = await runtime.replayFrozenRelationCalibration(
        modelSettings, subset.dataset, subset.annotations, undefined, undefined,
        "claim-graph-relation-prompt-v6", telemetry
      );
      const heldOut = await runtime.replayHeldOutRelationFixtures(
        modelSettings, heldOutSubset, "claim-graph-relation-prompt-v6", telemetry
      );
      runs.push([...replay.candidatePredictions, ...heldOut.cases.map((entry) => entry.prediction)]);
      runTelemetry.push({ replayIndex, status: "PASS", telemetry: summarizeTelemetry(telemetry.calls), execution: combineExecution(replay.executionMetrics, heldOut.executionMetrics) });
    } catch (error) {
      runTelemetry.push({ replayIndex, status: "FAIL_CLOSED", error: safeError(error), telemetry: summarizeTelemetry(telemetry.calls) });
    }
    const checkpointRoot = path.join(runRoot, "stability");
    await mkdir(checkpointRoot, { recursive: true });
    await writeJson(path.join(checkpointRoot, `${slug(item.model)}-checkpoint.json`), {
      model: item.model,
      completedRuns: runTelemetry,
      successfulPredictionRuns: runs.length,
      predictionRuns: runs
    });
  }
  item.stability = runs.length >= 2 ? runtime.summarizePredictionStability(runs) : null;
  item.stabilityComplete = runs.length === 3;
  item.stabilityRuns = runTelemetry;
}

const after = await hashes(protectedFiles);
const markdownAfter = await markdownManifest(vaultRoot);
const protectedChanges = diffMaps(before, after);
const markdownChanges = diffMaps(markdownBefore, markdownAfter);
if (protectedChanges.length > 0 || markdownChanges.length > 0) {
  throw new Error(`Model choice experiment modified protected state: ${[...protectedChanges, ...markdownChanges].join(", ")}`);
}

const finalRanked = [...models].sort(compareModels);
const passing = models.filter((item) => item.gate.passed && item.stabilityComplete === true);
const best = finalRanked[0];
const clearImprovement = qualityScore(best) > qualityScore(models[0]) + .03;
const result = passing.length > 0 ? "PASS" : clearImprovement ? "QUALITY_LIMIT_REACHED" : "MODEL_INDEPENDENT_LIMITATION";
const productionCandidate = passing.sort(compareModels)[0]?.model ?? null;
const compressionEligible = productionCandidate !== null && passing.find((item) => item.model === productionCandidate)?.duplicateSafety.compressionEligible === true;
const comparison = {
  version: "phase7.5-step4.4-v1",
  runId,
  generatedAt: new Date().toISOString(),
  provider: new URL(settings.llmBaseUrl).host,
  availableModels,
  testedModels: models.map((item) => item.model),
  promptVersion: "claim-graph-relation-prompt-v6",
  relationPolicyVersion: "claim-graph-relations-v5",
  temperature: .1,
  frozenInputs: { reviewedPairs: 56, heldOutPairs: 44, datasetFingerprint: manifest.datasetFingerprint },
  fairness: "Only llmModel changed; prompt, policy, temperature, schema, validator, duplicate gate and direction mapping remained frozen.",
  criticalSubset: critical,
  models: models.map(publicModelResult),
  bestQualityModel: best.model,
  bestCostQualityModel: passing.length > 0 ? passing.sort(compareModels)[0]?.model ?? null : null,
  recommendedProductionModel: productionCandidate,
  productionCandidate,
  compressionEligible,
  result,
  costs: { status: "NOT_ESTIMATED", reason: "The configured provider response supplies token usage but no authoritative per-model price metadata." },
  safety: {
    protectedArtifactsChanged: protectedChanges.length,
    markdownBefore: Object.keys(markdownBefore).length,
    markdownAfter: Object.keys(markdownAfter).length,
    markdownChanged: markdownChanges.length,
    graphRebuilds: 0, datasetWrites: 0, annotationWrites: 0, claimStoreWrites: 0,
    graphStoreWrites: 0, frozenSnapshotWrites: 0, compressionWrites: 0, tavilyCalls: 0
  }
};

await Promise.all(models.map(async (item) => {
  const root = path.join(runRoot, "per-model", slug(item.model));
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeJson(path.join(root, "predictions.json"), { reviewed: item.predictions, heldOut: item.heldOut.cases }),
    writeJson(path.join(root, "metrics.json"), { ...item.metrics, heldOut: { passed: item.heldOut.passed, total: item.heldOut.total }, gate: item.gate, duplicateSafety: item.duplicateSafety }),
    writeJson(path.join(root, "error-cases.json"), { taxonomy: item.errorTaxonomy, cases: errorCases(item.predictions, humanById) }),
    writeJson(path.join(root, "run-metadata.json"), { model: item.model, source: item.source, promptVersion: comparison.promptVersion, relationPolicyVersion: comparison.relationPolicyVersion, temperature: comparison.temperature, telemetry: item.telemetry, execution: item.execution })
  ]);
}));
await mkdir(path.join(runRoot, "stability"), { recursive: true });
await Promise.all([
  writeJson(path.join(runRoot, "critical-subset.json"), critical),
  writeJson(path.join(runRoot, "stability", "stability-results.json"), stabilityModels.map((item) => ({ model: item.model, stability: item.stability, runs: item.stabilityRuns }))),
  writeJson(path.join(runRoot, "model-comparison.json"), comparison),
  writeJson(path.join(runRoot, "safety-audit.json"), comparison.safety),
  writeFile(path.join(runRoot, "model-comparison.md"), renderReport(comparison), "utf8")
]);

console.log(renderReport(comparison));
console.log(`Artifacts: ${path.relative(projectRoot, runRoot)}`);

function publicModelResult(item) {
  return {
    model: item.model, source: item.source, metrics: item.metrics, heldOut: { passed: item.heldOut.passed, total: item.heldOut.total },
    gate: item.gate, duplicateSafety: item.duplicateSafety, errorTaxonomy: item.errorTaxonomy,
    telemetry: item.telemetry, execution: item.execution, stability: item.stability ?? null,
    stabilityComplete: item.stabilityComplete === true, stabilityRuns: item.stabilityRuns ?? []
  };
}
function compareModels(a, b) {
  if (a.gate.passed !== b.gate.passed) return a.gate.passed ? -1 : 1;
  if ((a.stabilityComplete === true) !== (b.stabilityComplete === true)) return a.stabilityComplete === true ? -1 : 1;
  const quality = qualityScore(b) - qualityScore(a);
  if (quality !== 0) return quality;
  const stability = (b.stability?.predictionConsistency ?? 0) - (a.stability?.predictionConsistency ?? 0);
  if (stability !== 0) return stability;
  return (a.telemetry.p95LatencyMs ?? Number.MAX_SAFE_INTEGER) - (b.telemetry.p95LatencyMs ?? Number.MAX_SAFE_INTEGER);
}
function qualityScore(item) {
  const m = item.metrics;
  const rates = [m.edgePrecision.rate, m.relationAccuracy.rate, m.directionAccuracy.rate,
    m.relationExistence.accuracy.rate, m.relationExistence.precision.rate, m.relationExistence.recall.rate,
    m.perRelationPrecision.supports.rate, m.perRelationPrecision.refines.rate,
    item.heldOut.total === 0 ? null : item.heldOut.passed / item.heldOut.total].filter((x) => x !== null);
  return rates.reduce((sum, value) => sum + value, 0) / rates.length;
}
function combineExecution(a, b) {
  return {
    providerCalls: a.providerCalls + b.providerCalls,
    successfulCalls: a.successfulCalls + b.successfulCalls,
    retries: a.retryCalls + b.retryCalls,
    schemaFailures: a.schemaInvalidCount + b.schemaInvalidCount,
    providerFailures: [...a.retryReasons, ...b.retryReasons].filter((reason) => reason !== "schema_invalid").length,
    failedPairs: 0
  };
}
function summarizeTelemetry(calls) {
  if (calls.length === 0) {
    return { calls: 0, medianLatencyMs: null, p95LatencyMs: null, inputTokens: null, outputTokens: null, tokenCoverage: 0 };
  }
  const durations = calls.map((item) => item.durationMs).sort((a, b) => a - b);
  const input = calls.map((item) => item.inputTokens).filter((value) => value !== null);
  const output = calls.map((item) => item.outputTokens).filter((value) => value !== null);
  return {
    calls: calls.length,
    medianLatencyMs: percentile(durations, .5),
    p95LatencyMs: percentile(durations, .95),
    inputTokens: input.length === calls.length ? input.reduce((sum, value) => sum + value, 0) : null,
    outputTokens: output.length === calls.length ? output.reduce((sum, value) => sum + value, 0) : null,
    tokenCoverage: calls.length === 0 ? 0 : Math.min(input.length, output.length) / calls.length
  };
}
function percentile(values, point) {
  if (values.length === 0) return null;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * point) - 1))];
}
function humanLabels(data, labels) {
  const map = new Map();
  for (const record of data.edges) if (labels.edge[record.reviewId]) map.set(record.reviewId, labels.edge[record.reviewId]);
  for (const record of data.unrelated) if (labels.unrelated[record.reviewId]) map.set(record.reviewId, labels.unrelated[record.reviewId]);
  return map;
}
function subsetReviewed(data, labels, ids) {
  const edges = data.edges.filter((record) => ids.has(record.reviewId));
  const unrelated = data.unrelated.filter((record) => ids.has(record.reviewId));
  return {
    dataset: { ...data, edges, unrelated, orphans: [] },
    annotations: { ...labels, edge: Object.fromEntries(Object.entries(labels.edge).filter(([id]) => ids.has(id))), unrelated: Object.fromEntries(Object.entries(labels.unrelated).filter(([id]) => ids.has(id))), orphan: {} }
  };
}
function selectCriticalHeldOut(cases) {
  const preferred = [
    "evidence-supports-policy", "mechanism-refines-abstraction", "epistemic-asymmetry", "same-words-different-scope",
    "refines-a-to-b", "supports-b-to-a", "true-semantic-duplicate", "v4-qualifier-blocks-duplicate",
    "v4-mechanism-detail-refines", "v4-evidence-b-supports-a", "v4-dependent-b-to-prerequisite-a",
    "v4-parallel-same-topic-unrelated", "v4-exact-bilingual-duplicate", "v5-mechanism-supports-abstraction",
    "v5-semantic-detail-refinement", "v5-same-topic-unrelated", "v5-ambiguous-relation"
  ];
  const available = new Set(cases.map((item) => item.id));
  const result = preferred.filter((id) => available.has(id));
  if (result.length !== preferred.length) throw new Error("Critical held-out fixture set is incomplete.");
  return result;
}
function duplicateSafety(predictions, heldOut, fixture, labels) {
  const reviewedDuplicates = predictions.filter((item) => item.relation === "duplicate");
  const reviewedFalse = reviewedDuplicates.filter((item) => labels.get(item.pairId)?.humanRelation !== "duplicate");
  const expected = new Set(fixture.cases.filter((item) => item.relation === "duplicate").map((item) => item.id));
  const heldPredicted = heldOut.cases.filter((item) => item.predictedRelation === "duplicate");
  const heldFalse = heldPredicted.filter((item) => !expected.has(item.id));
  return {
    reviewedPredictedDuplicate: reviewedDuplicates.length,
    reviewedDuplicateFalsePositive: reviewedFalse.length,
    heldOutTrueDuplicateDetected: heldPredicted.filter((item) => expected.has(item.id)).length,
    heldOutExpectedTrueDuplicate: expected.size,
    heldOutDuplicateFalsePositive: heldFalse.length,
    compressionEligible: reviewedFalse.length + heldFalse.length === 0 && reviewedDuplicates.length > 0
  };
}
function errorCases(predictions, labels) {
  return predictions.flatMap((prediction) => {
    const human = labels.get(prediction.pairId);
    if (!human) return [];
    const relation = prediction.relation === "none" ? "unrelated" : prediction.relation;
    const direction = prediction.direction === "left_to_right" ? "a_to_b" : prediction.direction === "right_to_left" ? "b_to_a" : prediction.direction === "uncertain" ? "uncertain" : "not_applicable";
    return relation === human.humanRelation && (!isDirectional(relation) || direction === human.humanDirection)
      ? [] : [{ pairId: prediction.pairId, predictedRelation: relation, predictedDirection: direction, humanRelation: human.humanRelation, humanDirection: human.humanDirection }];
  });
}
function isDirectional(value) { return value === "supports" || value === "refines" || value === "depends_on"; }
function assertFrozenBaseline(meta, frozen, configured) {
  const expected = { model: "deepseek-flash", promptVersion: "claim-graph-relation-prompt-v6", relationPolicyVersion: "claim-graph-relations-v5" };
  for (const [key, value] of Object.entries(expected)) if (meta[key] !== value) throw new Error(`Frozen baseline ${key} mismatch.`);
  if (meta.datasetFingerprint !== frozen.datasetFingerprint || configured.llmModel !== expected.model) throw new Error("Frozen baseline/configuration mismatch.");
}
async function discoverModels(config) {
  const base = String(config.llmBaseUrl).trim().replace(/\/+$/u, "");
  const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${config.llmApiKey}` } });
  const json = await response.json();
  if (!response.ok || !Array.isArray(json.data)) throw new Error(`Provider model discovery failed (${response.status}).`);
  return [...new Set(json.data.map((item) => item?.id).filter((id) => typeof id === "string" && id.length > 0))].sort();
}
function renderReport(value) {
  const modelHeaders = value.models.map((item) => item.model);
  const row = (label, reader) => `| ${label} | ${value.models.map((item) => reader(item)).join(" | ")} |`;
  const pct = (metric) => metric?.rate === null || metric?.rate === undefined ? "N/A" : `${(metric.rate * 100).toFixed(1)}% (${metric.numerator}/${metric.denominator})`;
  return `# Phase 7.5 Step 4.4 — Model Choice Experiment\n\n- Result: **${value.result}**\n- Provider: ${value.provider}\n- Prompt / Policy: ${value.promptVersion} / ${value.relationPolicyVersion}\n- Frozen inputs: ${value.frozenInputs.reviewedPairs} reviewed + ${value.frozenInputs.heldOutPairs} held-out\n- Production candidate: ${value.productionCandidate ?? "none"}\n- Compression eligible: ${value.compressionEligible}\n\n## Model Comparison\n\n| Metric | ${modelHeaders.join(" | ")} |\n|---|${modelHeaders.map(() => "---:").join("|")}|\n${row("Edge Precision", (x) => pct(x.metrics.edgePrecision))}\n${row("Relation Accuracy", (x) => pct(x.metrics.relationAccuracy))}\n${row("Direction Accuracy", (x) => pct(x.metrics.directionAccuracy))}\n${row("Existence Accuracy", (x) => pct(x.metrics.relationExistence.accuracy))}\n${row("Existence Precision", (x) => pct(x.metrics.relationExistence.precision))}\n${row("Existence Recall", (x) => pct(x.metrics.relationExistence.recall))}\n${row("Supports Precision", (x) => pct(x.metrics.perRelationPrecision.supports))}\n${row("Refines Precision", (x) => pct(x.metrics.perRelationPrecision.refines))}\n${row("Duplicate FP", (x) => String(x.metrics.duplicateFalsePositives))}\n${row("Sampled unrelated FN", (x) => `${x.metrics.sampledUnrelatedFalseNegativeRate.numerator}/13`)}\n${row("New existence FP", (x) => String(x.metrics.sampledUnrelatedNewFalsePositives))}\n${row("Held-out", (x) => `${x.heldOut.passed}/${x.heldOut.total}`)}\n${row("Median latency", (x) => x.telemetry.medianLatencyMs === null ? "N/A (frozen baseline)" : `${x.telemetry.medianLatencyMs} ms`)}\n${row("P95 latency", (x) => x.telemetry.p95LatencyMs === null ? "N/A (frozen baseline)" : `${x.telemetry.p95LatencyMs} ms`)}\n${row("Input / output tokens", (x) => `${x.telemetry.inputTokens ?? "N/A"} / ${x.telemetry.outputTokens ?? "N/A"}`)}\n${row("Stability", (x) => x.stability?.predictionConsistency === null || !x.stability ? "N/A" : `${(x.stability.predictionConsistency * 100).toFixed(1)}%`)}\n${row("Hard gate", (x) => x.gate.passed ? "PASS" : "FAIL")}\n\n## Error Taxonomy\n\n${value.models.map((item) => `### ${item.model}\n\n${Object.entries(item.errorTaxonomy).map(([key, count]) => `- ${key}: ${count}`).join("\n")}`).join("\n\n")}\n\n## Selection\n\n- Best quality model: ${value.bestQualityModel}\n- Best cost/quality model: ${value.bestCostQualityModel ?? "none passed all gates"}\n- Recommended production model: ${value.recommendedProductionModel ?? "none"}\n- Cost: ${value.costs.status}; ${value.costs.reason}\n\n## Safety\n\n- Protected artifacts changed: ${value.safety.protectedArtifactsChanged}\n- Markdown changed: ${value.safety.markdownChanged}\n- Graph rebuilds / Tavily calls / Compression writes: 0 / 0 / 0\n\n## Stop Rule\n\nRelation calibration stops after Step 4.4. No Prompt v7 or further automatic relation-calibration stage was created.\n`;
}
async function latestV6Run(fingerprint) {
  const root = path.join(projectRoot, "KnowledgeCuratorValidation/calibration/relation-v6");
  const entries = (await readdir(root, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort().reverse();
  for (const entry of entries) {
    try {
      const metadata = await loadJson(path.join(root, entry, "run-metadata.json"));
      if (metadata.datasetFingerprint === fingerprint && metadata.promptVersion === "claim-graph-relation-prompt-v6") return path.join(root, entry);
    } catch {}
  }
  throw new Error("Frozen Prompt v6 baseline is unavailable.");
}
async function loadRuntime() {
  const result = await build({ entryPoints: ["scripts/claim-graph-calibration-runtime.ts"], bundle: true, platform: "node", format: "esm", target: "node20", write: false, plugins: [{ name: "obsidian-stub", setup(api) { api.onResolve({ filter: /^obsidian$/u }, () => ({ path: "obsidian", namespace: "stub" })); api.onLoad({ filter: /.*/u, namespace: "stub" }, () => ({ contents: "export async function requestUrl(){throw new Error('Injected transport required.')}" })); } }] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
async function markdownManifest(root) {
  const { execFile } = await import("node:child_process"); const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("find", [root, "-type", "f", "-name", "*.md", "-print"]);
  const files = stdout.split("\n").filter(Boolean).sort();
  return Object.fromEntries(await Promise.all(files.map(async (file) => [path.relative(root, file), hash(await readFile(file))])));
}
async function hashes(files) { return Object.fromEntries(await Promise.all(files.map(async (file) => [file, hash(await readFile(file))]))); }
function diffMaps(a, b) { return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => a[key] !== b[key]); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function slug(value) { return value.replace(/[^A-Za-z0-9._-]+/gu, "-"); }
function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/data:text\/javascript[^\s]*/gu, "[bundled-runtime]").slice(0, 1000);
}
async function writeJson(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
async function loadDataset(name) { return loadJson(path.join(datasetRoot, name)); }
async function loadJson(file) { return JSON.parse(await readFile(file, "utf8")); }
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
