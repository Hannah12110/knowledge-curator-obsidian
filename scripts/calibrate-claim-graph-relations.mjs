import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "datasets", "graph-quality");
await loadLocalEnvironment();
const vaultRoot = resolveConfiguredPath(argument("--vault") ?? process.env.TEST_VAULT?.trim());
if (!vaultRoot) throw new Error("TEST_VAULT 未配置，请使用 --vault <path>。");
const [manifest, edges, unrelated, orphans, annotations, settings] = await Promise.all([
  loadDatasetFile("evaluation-manifest.json"), loadDatasetFile("edge-review.json"),
  loadDatasetFile("unrelated-review.json"), loadDatasetFile("orphan-review.json"),
  loadDatasetFile("annotations.json"), loadJson(path.join(vaultRoot, ".obsidian/plugins/knowledge-curator/data.json"))
]);
const dataset = { manifest, edges: edges.records, unrelated: unrelated.records, orphans: orphans.records };
const [heldOutV3, heldOutV4] = await Promise.all([
  loadJson(path.join(projectRoot, "KnowledgeCuratorRegression", "claim-graph-calibration", "relation-policy-v3.json")),
  loadJson(path.join(projectRoot, "KnowledgeCuratorRegression", "claim-graph-calibration", "relation-policy-v4.json"))
]);
const heldOutFixture = { version: "claim-graph-relations-v4-held-out-combined-v1", cases: [...heldOutV3.cases, ...heldOutV4.cases] };
for (const value of [edges, unrelated, orphans, annotations]) {
  if (value.datasetFingerprint !== manifest.datasetFingerprint) throw new Error("Frozen calibration benchmark fingerprint mismatch.");
}
if (!settings.llmApiKey?.trim()) throw new Error("DeepSeek API Key 未配置。");
if (!String(settings.llmBaseUrl).includes("deepseek")) throw new Error("Calibration Provider 必须是 DeepSeek。");
const graphSnapshotPath = resolveGraphSnapshotPath(manifest);
const baselineRunRoot = await latestPromptV3Run(manifest.datasetFingerprint);
const promptV4RunRoot = await latestPromptV4Run(manifest.datasetFingerprint);
const [baselinePredictionFile, baselineMetadata] = await Promise.all([
  loadJson(path.join(baselineRunRoot, "predictions.json")),
  loadJson(path.join(baselineRunRoot, "run-metadata.json"))
]);
const [promptV4PredictionFile, promptV4Metadata] = await Promise.all([
  loadJson(path.join(promptV4RunRoot, "predictions.json")), loadJson(path.join(promptV4RunRoot, "run-metadata.json"))
]);
if (!Array.isArray(baselinePredictionFile.candidate) ||
  baselineMetadata.candidatePromptVersion !== "claim-graph-relation-prompt-v3" ||
  baselineMetadata.candidateRelationPolicyVersion !== "claim-graph-relations-v2") {
  throw new Error("Prompt v3 frozen calibration baseline is invalid.");
}
const protectedFiles = [
  ...["evaluation-manifest.json", "edge-review.json", "unrelated-review.json", "orphan-review.json", "annotations.json"].map((name) => path.join(datasetRoot, name)),
  graphSnapshotPath,
  path.join(vaultRoot, ".knowledge-agent/claim-store/store.json"),
  path.join(vaultRoot, ".knowledge-agent/claim-graph/store.json")
];
const before = await hashes(protectedFiles);
const runtime = await loadRuntime();
const result = await runtime.replayFrozenRelationCalibration(
  settings, dataset, annotations, baselinePredictionFile.candidate, promptV4PredictionFile.candidate
);
const heldOut = await runtime.replayHeldOutRelationFixtures(settings, heldOutFixture);
const after = await hashes(protectedFiles);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Calibration replay modified a protected frozen or Vault artifact.");
const runId = `${new Date().toISOString().replaceAll(":", "-")}-${manifest.datasetFingerprint.slice(0, 8)}`;
const runRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "calibration", "relation-v5", runId);
await mkdir(runRoot, { recursive: true });
const metadata = {
  runId, generatedAt: new Date().toISOString(), datasetFingerprint: manifest.datasetFingerprint,
  graphFingerprint: manifest.graphFingerprint, claimStoreFingerprint: manifest.claimStoreFingerprint,
  model: settings.llmModel, temperature: 0.1,
  baselineRunId: baselineMetadata.runId,
  promptV4RunId: promptV4Metadata.runId,
  baselinePromptVersion: "claim-graph-relation-prompt-v3",
  baselineRelationPolicyVersion: "claim-graph-relations-v2",
  promptV4Version: "claim-graph-relation-prompt-v4",
  promptV4RelationPolicyVersion: "claim-graph-relations-v3",
  candidatePromptVersion: "claim-graph-relation-prompt-v5",
  candidateRelationPolicyVersion: "claim-graph-relations-v4",
  inputPairIds: result.inputPairIds,
  heldOutPairIds: heldOut.cases.map((item) => item.id),
  providerCalls: result.executionMetrics.providerCalls + heldOut.executionMetrics.providerCalls,
  retryCalls: result.executionMetrics.retryCalls + heldOut.executionMetrics.retryCalls, failedPairs: [],
  writes: { graphStore: 0, frozenGraph: 0, dataset: 0, annotations: 0, claimStore: 0, markdown: 0 }
};
const comparison = compare(result.promptV4Metrics, result.candidateMetrics);
const errorCases = buildErrorCases(dataset, annotations, result.candidatePredictions);
await Promise.all([
  write("predictions.json", { promptV3: result.baselinePredictions, promptV4: result.promptV4Predictions, promptV5: result.candidatePredictions }),
  write("semantic-deltas.json", result.candidatePredictions.map((item) => ({ pairId: item.pairId, semanticDelta: item.semanticDelta, duplicateEligible: item.duplicateEligible, semanticRoles: item.semanticRoles, direction: item.direction }))),
  write("metrics.json", { promptV3: result.baselineMetrics, promptV4: result.promptV4Metrics, promptV5: result.candidateMetrics, comparison }),
  write("confusion-matrix.json", { promptV3: result.baselineMetrics.confusionMatrix, promptV4: result.promptV4Metrics.confusionMatrix, promptV5: result.candidateMetrics.confusionMatrix, deltaV4ToV5: comparison.confusionDelta }),
  write("duplicate-audit.json", result.candidatePredictions.filter((item) => item.relation === "duplicate" || item.duplicateEligible)),
  write("direction-audit.json", result.candidatePredictions.filter((item) => ["supports", "refines", "depends_on"].includes(item.relation)).map((item) => ({ pairId: item.pairId, relation: item.relation, semanticRoles: item.semanticRoles, deterministicDirection: item.direction }))),
  write("error-cases.json", errorCases),
  write("held-out-results.json", heldOut),
  write("run-metadata.json", metadata),
  writeFile(path.join(runRoot, "report.md"), render(metadata, result, comparison, heldOut), "utf8")
]);
console.log(renderConsole(metadata, result, comparison, heldOut, runRoot));

async function write(name, value) { await writeFile(path.join(runRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
async function loadDatasetFile(name) { return await loadJson(path.join(datasetRoot, name)); }
async function loadJson(file) { return JSON.parse(await readFile(file, "utf8")); }
async function hashes(files) { return Object.fromEntries(await Promise.all(files.map(async (file) => [file, createHash("sha256").update(await readFile(file)).digest("hex")]))); }
function compare(baseline, candidate) {
  const metrics = ["edgePrecision", "relationAccuracy", "directionAccuracy", "sampledUnrelatedFalseNegativeRate"];
  const delta = Object.fromEntries(metrics.map((key) => [key, (candidate[key].rate ?? 0) - (baseline[key].rate ?? 0)]));
  delta.relationExistenceAccuracy = (candidate.relationExistence.accuracy.rate ?? 0) -
    (baseline.relationExistence.accuracy.rate ?? 0);
  const keys = new Set([...Object.keys(baseline.confusionMatrix), ...Object.keys(candidate.confusionMatrix)]);
  const sampledFnImproved = (candidate.sampledUnrelatedFalseNegativeRate.rate ?? 1) <
    (baseline.sampledUnrelatedFalseNegativeRate.rate ?? 1);
  return {
    delta,
    sampledFnImproved,
    step42GatePassed: candidate.gate.passed && candidate.sampledUnrelatedFalseNegativeRate.numerator <= 2,
    confusionDelta: Object.fromEntries([...keys].sort().map((key) => [key, (candidate.confusionMatrix[key] ?? 0) - (baseline.confusionMatrix[key] ?? 0)]))
  };
}
function buildErrorCases(dataset, annotations, predictions) {
  const byId = new Map(predictions.map((item) => [item.pairId, item]));
  const records = [...dataset.edges, ...dataset.unrelated];
  return records.flatMap((record) => {
    const annotation = annotations.edge[record.reviewId] ?? annotations.unrelated[record.reviewId];
    const prediction = byId.get(record.reviewId);
    if (!annotation || !prediction) return [];
    const predicted = prediction.relation === "none" ? "unrelated" : prediction.relation;
    const direction = prediction.direction === "left_to_right" ? "a_to_b" : prediction.direction === "right_to_left" ? "b_to_a" : "not_applicable";
    if (predicted === annotation.humanRelation && (!isDirectional(predicted) || direction === annotation.humanDirection)) return [];
    return [{ reviewId: record.reviewId, claimA: record.claimA, claimB: record.claimB, predictedRelation: predicted, predictedDirection: direction, humanRelation: annotation.humanRelation, humanDirection: annotation.humanDirection, reviewerConfidence: annotation.reviewerConfidence, notes: annotation.notes }];
  });
}
function isDirectional(value) { return value === "supports" || value === "refines" || value === "depends_on"; }
function pct(metric) { return metric.rate === null ? "N/A" : `${(metric.rate * 100).toFixed(1)}% (${metric.numerator}/${metric.denominator})`; }
function row(name, baseline, candidate) { const delta = (candidate.rate ?? 0) - (baseline.rate ?? 0); return `| ${name} | ${pct(baseline)} | ${pct(candidate)} | ${(delta * 100).toFixed(1)} pp |`; }
function render(metadata, result, comparison, heldOut) {
  const b = result.promptV4Metrics, c = result.candidateMetrics;
  return `# Claim Graph Relation Calibration — Step 4.2\n\n## Run\n\n- Run ID: ${metadata.runId}\n- Model: ${metadata.model}\n- Temperature: ${metadata.temperature}\n- Dataset: ${metadata.datasetFingerprint}\n- Baseline: ${metadata.promptV4Version} / ${metadata.promptV4RelationPolicyVersion}\n- Candidate: ${metadata.candidatePromptVersion} / ${metadata.candidateRelationPolicyVersion}\n\n## Prompt v4 vs v5\n\n| Metric | v4 | v5 | Delta |\n|---|---:|---:|---:|\n${row("Edge Precision", b.edgePrecision, c.edgePrecision)}\n${row("Relation Accuracy", b.relationAccuracy, c.relationAccuracy)}\n${row("Direction Accuracy", b.directionAccuracy, c.directionAccuracy)}\n${row("Relation Existence Accuracy", b.relationExistence.accuracy, c.relationExistence.accuracy)}\n${row("Relation Existence Precision", b.relationExistence.precision, c.relationExistence.precision)}\n${row("Relation Existence Recall", b.relationExistence.recall, c.relationExistence.recall)}\n${row("Duplicate Precision", b.perRelationPrecision.duplicate, c.perRelationPrecision.duplicate)}\n${row("Supports Precision", b.perRelationPrecision.supports, c.perRelationPrecision.supports)}\n${row("Refines Precision", b.perRelationPrecision.refines, c.perRelationPrecision.refines)}\n${row("Sampled Unrelated FN", b.sampledUnrelatedFalseNegativeRate, c.sampledUnrelatedFalseNegativeRate)}\n\n## Held-out Fixtures\n\n- Passed: ${heldOut.passed}/${heldOut.total}\n- Failed: ${heldOut.total - heldOut.passed}\n\n## Safety Gates\n\n- Duplicate false positives: ${c.duplicateFalsePositives}\n- New false positives in reviewed unrelated: ${c.sampledUnrelatedNewFalsePositives}\n- compressionEligible: ${c.compressionEligible}\n- Step 4.2 Gate: ${comparison.step42GatePassed ? "PASS" : "FAIL"}\n\n## Execution\n\n- Frozen provider calls: ${result.executionMetrics.providerCalls}\n- Held-out provider calls: ${heldOut.executionMetrics.providerCalls}\n- Retries: ${metadata.retryCalls}\n- Failed pairs: 0\n- Protected artifacts changed: 0\n`;
}
function renderConsole(metadata, result, comparison, heldOut, runRoot) { return render(metadata, result, comparison, heldOut) + `\nArtifacts: ${path.relative(projectRoot, runRoot)}`; }
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function resolveConfiguredPath(value) { if (!value) return undefined; return path.resolve(projectRoot, value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value); }
function resolveGraphSnapshotPath(value) {
  const snapshotsRoot = path.resolve(projectRoot, "KnowledgeCuratorValidation", "snapshots", "graph-quality");
  const resolved = path.resolve(projectRoot, value.graphSnapshotPath);
  if (!resolved.startsWith(`${snapshotsRoot}${path.sep}`)) throw new Error("Frozen Graph Snapshot path is invalid.");
  return resolved;
}
async function loadRuntime() {
  const result = await build({ entryPoints: ["scripts/claim-graph-calibration-runtime.ts"], bundle: true, platform: "node", format: "esm", target: "node20", write: false, plugins: [{ name: "obsidian-headless-stub", setup(api) { api.onResolve({ filter: /^obsidian$/u }, () => ({ path: "obsidian", namespace: "stub" })); api.onLoad({ filter: /.*/u, namespace: "stub" }, () => ({ contents: "export async function requestUrl(){throw new Error('Injected transport required.')}" })); } }] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
async function latestPromptV3Run(datasetFingerprint) {
  const root = path.join(projectRoot, "KnowledgeCuratorValidation", "calibration", "relation-v2");
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((item) => item.isDirectory()).map((item) => item.name).sort().reverse();
  for (const entry of entries) {
    try {
      const metadata = await loadJson(path.join(root, entry, "run-metadata.json"));
      if (metadata.datasetFingerprint === datasetFingerprint &&
        metadata.candidatePromptVersion === "claim-graph-relation-prompt-v3") {
        return path.join(root, entry);
      }
    } catch {}
  }
  throw new Error("No matching Prompt v3 calibration baseline found.");
}
async function latestPromptV4Run(datasetFingerprint) {
  const root = path.join(projectRoot, "KnowledgeCuratorValidation", "calibration", "relation-v3");
  const entries = (await readdir(root, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort().reverse();
  for (const entry of entries) {
    try {
      const metadata = await loadJson(path.join(root, entry, "run-metadata.json"));
      if (metadata.datasetFingerprint === datasetFingerprint && metadata.candidatePromptVersion === "claim-graph-relation-prompt-v4") return path.join(root, entry);
    } catch {}
  }
  throw new Error("No matching Prompt v4 calibration baseline found.");
}
async function loadLocalEnvironment() {
  try { const contents = await readFile(path.join(projectRoot, ".env.local"), "utf8"); for (const raw of contents.split(/\r?\n/u)) { const line = raw.trim(); if (!line || line.startsWith("#")) continue; const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u); if (!match || process.env[match[1]] !== undefined) continue; let value = match[2].trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); process.env[match[1]] = value; } } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
