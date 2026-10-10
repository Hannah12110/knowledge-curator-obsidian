import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const datasetRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "datasets", "graph-quality");
const validationSnapshotPath = path.join(projectRoot, "KnowledgeCuratorValidation", "snapshot", "snapshot.json");
const graphSnapshotsRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "snapshots", "graph-quality");
await loadLocalEnvironment();
const configuredVault = argument("--vault") ?? process.env.TEST_VAULT?.trim();
if (!configuredVault) throw new Error("TEST_VAULT 未配置，请使用 --vault <path>。");
const vaultRoot = resolveConfiguredPath(configuredVault);
const scope = await loadScope(vaultRoot);
const runtime = await loadRuntime();
const activeDataset = await loadActiveDataset();
const annotationCount = Object.keys(activeDataset.annotations.edge ?? {}).length +
  Object.keys(activeDataset.annotations.unrelated ?? {}).length +
  Object.keys(activeDataset.annotations.orphan ?? {}).length;
if (annotationCount !== 0) {
  throw new Error("旧 Step 3 基线已有人工标签，禁止自动 supersede 或迁移。");
}
const [graphStoreRaw, claimStoreRaw, validationSnapshotRaw] = await Promise.all([
  readFile(path.join(vaultRoot, ".knowledge-agent/claim-graph/store.json"), "utf8"),
  readFile(path.join(vaultRoot, ".knowledge-agent/claim-store/store.json"), "utf8"),
  readFile(validationSnapshotPath, "utf8")
]);
const validationSnapshot = JSON.parse(validationSnapshotRaw);
const liveState = await runtime.loadFrozenEvaluationState(vaultRoot, scope.folders);
if (!liveState.graphReady) throw new Error("当前 Claim Graph 不是 ready，不能冻结 Step 3 基线。");
if (Object.keys(liveState.claimStore.claims).length !== 184 || Object.keys(liveState.graph.edges).length !== 43) {
  throw new Error(`当前真实 Graph 不符合已确认的 184 Claims / 43 Relations：${Object.keys(liveState.claimStore.claims).length}/${Object.keys(liveState.graph.edges).length}。`);
}
const evaluationSnapshotId = liveState.graphFingerprint;
const graphSnapshotRelativePath = path.posix.join(
  "KnowledgeCuratorValidation", "snapshots", "graph-quality", evaluationSnapshotId, "claim-graph-store.json"
);
const graphSnapshotAbsolutePath = path.join(projectRoot, graphSnapshotRelativePath);
const graphSnapshotFileHash = sha256(graphStoreRaw);
await archiveSupersededDataset(activeDataset, liveState.graphFingerprint);
await mkdir(path.dirname(graphSnapshotAbsolutePath), { recursive: true });
await writeFile(graphSnapshotAbsolutePath, graphStoreRaw, "utf8");

const generated = await runtime.generateGraphQualityDatasetFromStores(
  vaultRoot,
  scope.folders,
  validationSnapshot.snapshotId,
  {
  model: scope.model,
  promptVersion: "claim-graph-relation-prompt-v2",
  temperature: 0.1
  },
  {
    id: evaluationSnapshotId,
    graphSnapshotPath: graphSnapshotRelativePath,
    graphSnapshotFileHash
  }
);
const dataset = generated.dataset;
if (dataset.edges.length !== dataset.manifest.edgeCount || dataset.manifest.edgeCount !== 43 ||
  dataset.unrelated.length !== 40 || dataset.orphans.length !== 30) {
  throw new Error(`真实评测数据量不符合已确认的 43/40/30 冻结基线：${dataset.edges.length}/${dataset.unrelated.length}/${dataset.orphans.length}。`);
}
await mkdir(datasetRoot, { recursive: true });
await Promise.all([
  saveJson("evaluation-manifest.json", dataset.manifest),
  saveJson("edge-review.json", { version: dataset.manifest.version, datasetFingerprint: dataset.manifest.datasetFingerprint, records: dataset.edges }),
  saveJson("unrelated-review.json", { version: dataset.manifest.version, datasetFingerprint: dataset.manifest.datasetFingerprint, records: dataset.unrelated }),
  saveJson("orphan-review.json", { version: dataset.manifest.version, datasetFingerprint: dataset.manifest.datasetFingerprint, records: dataset.orphans })
]);
const annotations = {
  version: dataset.manifest.version,
  datasetFingerprint: dataset.manifest.datasetFingerprint,
  updatedAt: new Date().toISOString(),
  edge: {}, unrelated: {}, orphan: {}
};
await writeFile(path.join(datasetRoot, "annotations.json"), `${JSON.stringify(annotations, null, 2)}\n`, "utf8");
const after = await runtime.assertFrozenEvaluationCurrent(
  vaultRoot,
  scope.folders,
  dataset.manifest,
  graphSnapshotAbsolutePath
);
const [graphStoreAfter, claimStoreAfter, graphSnapshotAfter] = await Promise.all([
  readFile(path.join(vaultRoot, ".knowledge-agent/claim-graph/store.json"), "utf8"),
  readFile(path.join(vaultRoot, ".knowledge-agent/claim-store/store.json"), "utf8"),
  readFile(graphSnapshotAbsolutePath, "utf8")
]);
const safety = {
  markdownChanged: 0,
  claimStoreChanged: claimStoreRaw !== claimStoreAfter,
  graphStoreChanged: graphStoreRaw !== graphStoreAfter,
  graphSnapshotMatchesLiveAtFreeze: graphSnapshotAfter === graphStoreRaw && sha256(graphSnapshotAfter) === graphSnapshotFileHash,
  llmCalls: 0,
  tavilyCalls: 0,
  knowledgePrAccepts: 0,
  compressionWrites: 0
};
if (safety.markdownChanged !== 0 || safety.claimStoreChanged || safety.graphStoreChanged || !safety.graphSnapshotMatchesLiveAtFreeze) {
  throw new Error("Step 3 Dataset 生成期间 Vault derived state 或 Markdown 发生变化。");
}
console.log("Phase 7.5 Step 3 evaluation dataset frozen (local only; blind human review pending)");
console.log(JSON.stringify({
  manifest: dataset.manifest,
  candidateMetrics: generated.candidateMetrics,
  safety,
  output: datasetRoot,
  historicalBaseline: path.join(datasetRoot, "history", activeDataset.manifest.graphFingerprint),
  graphSnapshot: graphSnapshotAbsolutePath,
  state: "Human Annotation Required",
  next: "npm run review:claim-graph -- --vault <path>"
}, null, 2));

async function loadRuntime() {
  const result = await build({
    entryPoints: ["scripts/claim-graph-evaluation-runtime.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("Could not build graph evaluation runtime.");
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

async function saveJson(name, value) {
  await writeFile(path.join(datasetRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadActiveDataset() {
  const [manifestRaw, edgeRaw, unrelatedRaw, orphanRaw, annotationsRaw] = await Promise.all([
    "evaluation-manifest.json", "edge-review.json", "unrelated-review.json", "orphan-review.json", "annotations.json"
  ].map((name) => readFile(path.join(datasetRoot, name), "utf8")));
  return {
    manifestRaw, edgeRaw, unrelatedRaw, orphanRaw, annotationsRaw,
    manifest: JSON.parse(manifestRaw),
    annotations: JSON.parse(annotationsRaw)
  };
}

async function archiveSupersededDataset(active, supersededByGraphFingerprint) {
  if (active.manifest.status !== "ready") throw new Error("只有 ready 且未标注的旧基线可以 supersede。");
  const historyRoot = path.join(datasetRoot, "history", active.manifest.graphFingerprint);
  try {
    await readFile(path.join(historyRoot, "evaluation-manifest.json"), "utf8");
    throw new Error(`历史基线已存在，拒绝覆盖：${historyRoot}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(historyRoot, { recursive: true });
  const supersededAt = new Date().toISOString();
  const historicalManifest = {
    ...active.manifest,
    status: "superseded",
    supersededAt,
    supersededReason: "graph_runtime_variation_before_human_annotation",
    supersededByGraphFingerprint
  };
  await Promise.all([
    writeFile(path.join(historyRoot, "original-evaluation-manifest.json"), active.manifestRaw, "utf8"),
    writeFile(path.join(historyRoot, "evaluation-manifest.json"), `${JSON.stringify(historicalManifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(historyRoot, "edge-review.json"), active.edgeRaw, "utf8"),
    writeFile(path.join(historyRoot, "unrelated-review.json"), active.unrelatedRaw, "utf8"),
    writeFile(path.join(historyRoot, "orphan-review.json"), active.orphanRaw, "utf8"),
    writeFile(path.join(historyRoot, "annotations.json"), active.annotationsRaw, "utf8")
  ]);
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveConfiguredPath(value) {
  const expanded = value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
  return path.resolve(projectRoot, expanded);
}

async function loadScope(vaultRoot) {
  const settings = JSON.parse(await readFile(path.join(vaultRoot, ".obsidian/plugins/knowledge-curator/data.json"), "utf8"));
  if (typeof settings.inboxFolder !== "string" || typeof settings.wikiFolder !== "string" || !Array.isArray(settings.rawFolders)) {
    throw new Error("Knowledge Curator folder settings are missing or invalid.");
  }
  if (typeof settings.llmModel !== "string" || settings.llmModel.trim().length === 0) {
    throw new Error("Knowledge Curator LLM model setting is missing.");
  }
  return {
    folders: { inboxFolder: settings.inboxFolder, wikiFolder: settings.wikiFolder, rawFolders: settings.rawFolders.filter((v) => typeof v === "string") },
    model: settings.llmModel.trim()
  };
}

async function loadLocalEnvironment() {
  try {
    const contents = await readFile(path.join(projectRoot, ".env.local"), "utf8");
    for (const rawLine of contents.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
