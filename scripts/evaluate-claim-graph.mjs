import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "datasets", "graph-quality");
const reportRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "reports");
await loadLocalEnvironment();
const configuredVault = argument("--vault") ?? process.env.TEST_VAULT?.trim();
if (!configuredVault) throw new Error("TEST_VAULT 未配置，请使用 --vault <path>。");
const vaultRoot = resolveConfiguredPath(configuredVault);
const scope = await loadScope(vaultRoot);
const runtime = await loadRuntime();
const dataset = await loadDataset();
const graphSnapshotPath = resolveGraphSnapshotPath(dataset.manifest);
const before = await runtime.assertFrozenEvaluationCurrent(vaultRoot, scope, dataset.manifest, graphSnapshotPath);
const annotations = JSON.parse(await readFile(path.join(datasetRoot, "annotations.json"), "utf8"));
runtime.validateAnnotations(dataset, annotations, false);
const metrics = runtime.calculateGraphQualityMetrics(dataset, annotations, false);
const after = await runtime.assertFrozenEvaluationCurrent(vaultRoot, scope, dataset.manifest, graphSnapshotPath);
const safety = {
  llmCalls: 0, tavilyCalls: 0, knowledgePrAccepts: 0, compressionWrites: 0,
  markdownChanged: 0,
  claimStoreChanged: before.sourceHashes.claimStore !== after.sourceHashes.claimStore,
  graphStoreChanged: before.sourceHashes.graphStore !== after.sourceHashes.graphStore
};
if (safety.markdownChanged || safety.claimStoreChanged || safety.graphStoreChanged) throw new Error("Evaluation 期间源数据发生变化。");
const edgeQualified = edgeGate(metrics);
const report = {
  version: dataset.manifest.version,
  generatedAt: new Date().toISOString(),
  evaluationSnapshot: dataset.manifest,
  metrics,
  safety,
  limitations: [
    ...dataset.manifest.knownLimitations,
    "Unrelated 与 Orphan 指标来自确定性分层样本，不等同于全局 Recall。",
    "本报告是 PARTIAL_HUMAN_AUDIT：未审核记录不进入任何指标分母，也不视为正确或错误。",
    `Unrelated 仅审核 ${metrics.coverage.unrelated.reviewed}/${metrics.coverage.unrelated.total}，结果仅代表已审核子样本，不参与质量硬门槛。`,
    metrics.evaluationStatus.orphan === "NOT_EVALUATED"
      ? "Orphan 尚未开始人工审核，False Orphan Rate 与根因分解均不计算。"
      : "Orphan 指标只代表已审核子样本。",
    "小样本 Relation 必须同时查看 N，不能宣称 production-level accuracy。"
  ],
  recommendation: edgeQualified
    ? "Edge 全量审核满足参考门槛；Unrelated 仅作观察，Orphan 尚未评估。在补足召回/孤立审计前，不应宣称整体 Graph Quality 已达标。"
    : "Edge 全量审核未满足参考门槛，应先基于错误分类决定后续专项优化；本报告不自动修改 Retrieval 或 Relation Classifier。",
  pipelineResult: "PASS",
  graphQuality: edgeQualified ? "QUALIFIED" : "NEEDS_OPTIMIZATION",
  evaluationStatus: metrics.evaluationMode,
  humanAuditCoverage: metrics.evaluationMode === "COMPLETE_HUMAN_AUDIT" ? "COMPLETE" : "PARTIAL",
  edgeQuality: metrics.evaluationStatus.edge === "NOT_EVALUATED" ? "NOT_EVALUATED" : edgeQualified ? "PASS" : "NEEDS_OPTIMIZATION",
  unrelatedRecallQuality: metrics.evaluationStatus.unrelated === "NOT_EVALUATED" ? "NOT_EVALUATED" : "OBSERVATIONAL",
  orphanQuality: metrics.evaluationStatus.orphan === "NOT_EVALUATED" ? "NOT_EVALUATED" : "OBSERVATIONAL"
};
await mkdir(reportRoot, { recursive: true });
await Promise.all([
  writeFile(path.join(reportRoot, "graph-quality-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(path.join(reportRoot, "graph-quality-evaluation.md"), renderMarkdown(report), "utf8")
]);
printSummary(report);

function edgeGate(metrics) {
  const atLeast = (metric, value) => metric.rate !== null && metric.rate >= value;
  return atLeast(metrics.edgePrecision, .8) && atLeast(metrics.relationAccuracy, .8) &&
    atLeast(metrics.directionAccuracy, .8) && metrics.perRelationPrecision.duplicate.numerator === metrics.perRelationPrecision.duplicate.denominator &&
    metrics.errorTaxonomy.FALSE_POSITIVE_EDGE === 0;
}
function format(metric) { return metric.rate === null ? `N/A (${metric.numerator ?? "null"}/${metric.denominator}) · small-N=${metric.smallN}` : `${(metric.rate * 100).toFixed(1)}% (${metric.numerator}/${metric.denominator}) · small-N=${metric.smallN}`; }
function coverageLine(label, item) { return `- ${label}: ${item.reviewed}/${item.total} (${(item.coverage * 100).toFixed(1)}%)`; }
function printSummary(report) {
  const m = report.metrics;
  console.log([
    "Phase 7.5 Step 3 — Real Graph Quality Evaluation",
    "",
    "Human Review Coverage",
    coverageLine("Edge", m.coverage.edge),
    coverageLine("Unrelated", m.coverage.unrelated),
    coverageLine("Orphan", m.coverage.orphan),
    coverageLine("Total", m.coverage.total),
    "",
    `Edge Precision: ${format(m.edgePrecision)}`,
    `Relation Accuracy: ${format(m.relationAccuracy)}`,
    `Direction Accuracy: ${format(m.directionAccuracy)}`,
    ...Object.entries(m.perRelationPrecision).map(([key, value]) => `${key}: ${format(value)}`),
    "",
    `Sampled Unrelated False-Negative Rate: ${format(m.sampledUnrelatedFalseNegativeRate)}`,
    `Unrelated Recall Audit: ${report.unrelatedRecallQuality}`,
    `Orphan Audit: ${m.evaluationStatus.orphan}`,
    `False Orphan Rate: ${format(m.falseOrphanRate)}`,
    "",
    `Evaluation Status: ${report.evaluationStatus}`,
    `Step 3 Evaluation Pipeline: ${report.pipelineResult}`,
    `Human Audit Coverage: ${report.humanAuditCoverage}`,
    `Edge Quality: ${report.edgeQuality}`,
    `Report: ${path.relative(projectRoot, path.join(reportRoot, "graph-quality-evaluation.md"))}`
  ].join("\n"));
}
function renderMarkdown(report) {
  const m = report.metrics;
  return `# Phase 7.5 Step 3 — Real Graph Quality Evaluation\n\n## Evaluation Snapshot\n\n- Graph: ${report.evaluationSnapshot.graphFingerprint}\n- Built at: ${report.evaluationSnapshot.builtAt}\n- Claims / Edges: ${report.evaluationSnapshot.claimCount} / ${report.evaluationSnapshot.edgeCount}\n- Evaluation Mode: ${report.evaluationStatus}\n\n## Human Review Coverage\n\n${coverageLine("Edge", m.coverage.edge)}\n${coverageLine("Unrelated", m.coverage.unrelated)}\n${coverageLine("Orphan", m.coverage.orphan)}\n${coverageLine("Total", m.coverage.total)}\n\n- Edge Evaluation Status: ${m.evaluationStatus.edge}\n- Unrelated Evaluation Status: ${m.evaluationStatus.unrelated}\n- Orphan Evaluation Status: ${m.evaluationStatus.orphan}\n\n## Graph Quality\n\n- Edge Precision: ${format(m.edgePrecision)}\n- Relation Accuracy: ${format(m.relationAccuracy)}\n- Direction Accuracy: ${format(m.directionAccuracy)}\n\n## Per Relation\n\n${Object.entries(m.perRelationPrecision).map(([key, value]) => `- ${key}: ${format(value)}`).join("\n")}\n\n## False-Negative Audit\n\n- Sampled Unrelated False-Negative Rate: ${format(m.sampledUnrelatedFalseNegativeRate)}\n- Status: ${report.unrelatedRecallQuality}\n- Scope: reviewed subset only; not a global recall metric and not a hard gate.\n\n## Orphan Audit\n\n- Status: ${m.evaluationStatus.orphan}\n- False Orphan Rate: ${format(m.falseOrphanRate)}\n- Root Causes: ${JSON.stringify(m.rootCauses)}\n\n## Error Taxonomy\n\n${Object.entries(m.errorTaxonomy).map(([key, value]) => `- ${key}: ${value ?? "NOT_EVALUATED"}`).join("\n")}\n\n## Safety Audit\n\n${Object.entries(report.safety).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n## Limitations\n\n${report.limitations.map((item) => `- ${item}`).join("\n")}\n\n## Recommendation\n\n${report.recommendation}\n\n## Result\n\n- Step 3 Evaluation Pipeline: ${report.pipelineResult}\n- Human Audit Coverage: ${report.humanAuditCoverage}\n- Edge Quality: ${report.edgeQuality}\n- Unrelated Recall Quality: ${report.unrelatedRecallQuality}\n- Orphan Quality: ${report.orphanQuality}\n`;
}
async function loadDataset() {
  const [manifest, edge, unrelated, orphan] = await Promise.all(["evaluation-manifest.json", "edge-review.json", "unrelated-review.json", "orphan-review.json"].map(async (name) => JSON.parse(await readFile(path.join(datasetRoot, name), "utf8"))));
  return { manifest, edges: edge.records, unrelated: unrelated.records, orphans: orphan.records };
}
async function loadRuntime() {
  const result = await build({ entryPoints: ["scripts/claim-graph-evaluation-runtime.ts"], bundle: true, platform: "node", format: "esm", target: "node20", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
async function loadScope(root) {
  const settings = JSON.parse(await readFile(path.join(root, ".obsidian/plugins/knowledge-curator/data.json"), "utf8"));
  return { inboxFolder: settings.inboxFolder, wikiFolder: settings.wikiFolder, rawFolders: settings.rawFolders };
}
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function resolveConfiguredPath(value) { return path.resolve(projectRoot, value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value); }
function resolveGraphSnapshotPath(manifest) {
  if (typeof manifest.graphSnapshotPath !== "string" || manifest.graphSnapshotPath.length === 0) return undefined;
  const snapshotsRoot = path.resolve(projectRoot, "KnowledgeCuratorValidation", "snapshots", "graph-quality");
  const resolved = path.resolve(projectRoot, manifest.graphSnapshotPath);
  if (resolved !== snapshotsRoot && !resolved.startsWith(`${snapshotsRoot}${path.sep}`)) {
    throw new Error("Graph Quality Evaluation snapshot path is invalid.");
  }
  return resolved;
}
async function loadLocalEnvironment() {
  try {
    const contents = await readFile(path.join(projectRoot, ".env.local"), "utf8");
    for (const rawLine of contents.split(/\r?\n/u)) {
      const line = rawLine.trim(); if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u); if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
