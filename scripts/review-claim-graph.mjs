import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = path.join(projectRoot, "KnowledgeCuratorValidation", "datasets", "graph-quality");
const requiredDatasetFiles = [
  "evaluation-manifest.json",
  "edge-review.json",
  "unrelated-review.json",
  "orphan-review.json",
  "annotations.json"
];
let vaultRoot;
let scope;
let runtime;
let dataset;
let annotations;
let evaluationState;
let rl;
class DatasetUnavailableError extends Error {}
class VaultFileUnavailableError extends Error {}

await main().catch(handleFatalError);

async function main() {
  await loadLocalEnvironment();
  vaultRoot = resolveConfiguredPath(argument("--vault") ?? process.env.TEST_VAULT?.trim() ?? "");
  if (!vaultRoot) throw new Error("TEST_VAULT 未配置，请使用 --vault <path>。");
  await assertDatasetFilesReadable();
  try {
    scope = await loadScope(vaultRoot);
  } catch (error) {
    throw new VaultFileUnavailableError("Vault file unavailable locally.", { cause: error });
  }
  runtime = await loadRuntime();
  try {
    dataset = await loadDataset();
  } catch (error) {
    throw new DatasetUnavailableError("Graph Quality Evaluation dataset is unavailable locally.", { cause: error });
  }
  try {
    const graphSnapshotPath = resolveGraphSnapshotPath(dataset.manifest);
    evaluationState = await runtime.assertFrozenEvaluationCurrent(vaultRoot, scope, dataset.manifest, graphSnapshotPath);
    if (evaluationState.liveGraphDiffers) {
      console.warn("Live graph differs from evaluation snapshot; frozen human-review baseline remains valid.");
    }
  } catch (error) {
    if (isLocalReadFailure(error)) {
      throw new VaultFileUnavailableError("Vault file unavailable locally.", { cause: error });
    }
    if (error instanceof Error && (error.message.includes("知识图谱已变化") || error.message.includes("Claim Store 已变化"))) {
      throw new Error("Evaluation baseline changed. Human annotation cannot continue.", { cause: error });
    }
    throw error;
  }
  try {
    annotations = JSON.parse(await readFile(path.join(datasetRoot, "annotations.json"), "utf8"));
  } catch (error) {
    throw new DatasetUnavailableError("Graph Quality Evaluation dataset is unavailable locally.", { cause: error });
  }
  runtime.validateAnnotations(dataset, annotations, false);

  if (process.argv.includes("--progress")) {
    printProgress();
    return;
  }
  if (process.argv.includes("--export")) {
    await saveJson("review-export.json", { manifest: dataset.manifest, annotations });
    console.log("Review export written locally.");
    return;
  }

  rl = createInterface({ input, output });
  try {
    while (true) {
      printProgress();
      const action = await choose("\n操作", ["继续未完成审核", "Edge Review", "Unrelated Review", "Orphan Review", "导出", "退出"]);
      if (action === 5) break;
      if (action === 4) {
        await saveJson("review-export.json", { manifest: dataset.manifest, annotations });
        console.log("已导出 review-export.json");
        continue;
      }
      const kind = action === 0 ? firstIncompleteKind() : ["edge", "unrelated", "orphan"][action - 1];
      if (!kind) {
        console.log("全部人工审核已完成。下一步可运行 npm run evaluate:claim-graph。");
        continue;
      }
      await reviewNext(kind);
    }
  } finally {
    rl.close();
  }
}

async function reviewNext(kind) {
  const records = kind === "edge" ? dataset.edges : kind === "unrelated" ? dataset.unrelated : dataset.orphans;
  const record = records.find((item) => annotations[kind][item.reviewId] === undefined);
  if (!record) {
    console.log(`${kind} 已全部完成。`);
    return;
  }
  if (kind === "orphan") await reviewOrphan(record);
  else await reviewRelation(kind, record);
}

async function reviewRelation(kind, record) {
  const completed = Object.keys(annotations[kind]).length;
  console.log(`\n[${kind === "edge" ? "Edge" : "Unrelated"} Review ${completed + 1} / ${kind === "edge" ? dataset.edges.length : dataset.unrelated.length}]`);
  printClaim("Claim A", record.claimA);
  printClaim("Claim B", record.claimB);
  const relation = relationFromChoice(await choose("人工关系（提交前不显示模型答案）", ["duplicate", "supports", "refines", "contradicts", "depends_on", "unrelated", "uncertain"]));
  const direction = await askDirection(relation);
  const confidence = ["high", "medium", "low"][await choose("Reviewer confidence", ["high", "medium", "low"])];
  const notes = await rl.question("Notes（可留空）：");
  annotations[kind][record.reviewId] = {
    humanRelation: relation,
    humanDirection: direction,
    reviewerConfidence: confidence,
    notes,
    submittedAt: new Date().toISOString()
  };
  await persist();
  console.log("\n--- 提交后显示模型信息 ---");
  if (kind === "edge") {
    console.log(`Model Prediction: ${record.predictedRelation} ${record.predictedDirection}`);
    console.log(`Model Confidence: ${record.modelConfidence}`);
    console.log(`Model Evidence: ${record.modelEvidence.join(" | ")}`);
    console.log(`Match: ${record.predictedRelation === relation && (!isDirectional(relation) || record.predictedDirection === direction) ? "YES" : "NO"}`);
  } else {
    console.log("Model Prediction: unrelated");
    console.log(`Match: ${relation === "unrelated" ? "YES" : "NO"}`);
  }
}

async function reviewOrphan(record) {
  const completed = Object.keys(annotations.orphan).length;
  console.log(`\n[Orphan Review ${completed + 1} / ${dataset.orphans.length}]`);
  printClaim("Orphan Claim", record.targetClaim);
  record.topCandidates.forEach((claim, index) => printClaim(`Candidate ${index + 1} · score ${claim.score.toFixed(3)}`, claim));
  const label = ["true_orphan", "has_relation", "uncertain"][await choose("人工判断", ["true_orphan", "has_relation", "uncertain"] )];
  let relatedClaimId;
  let humanRelation;
  let humanDirection = label === "uncertain" ? "uncertain" : "not_applicable";
  if (label === "has_relation") {
    relatedClaimId = await selectRelatedClaim(record);
    humanRelation = relationFromChoice(await choose("关系", ["duplicate", "supports", "refines", "contradicts", "depends_on"]));
    humanDirection = await askDirection(humanRelation);
  }
  const confidence = ["high", "medium", "low"][await choose("Reviewer confidence", ["high", "medium", "low"] )];
  const notes = await rl.question("Notes（可留空）：");
  annotations.orphan[record.reviewId] = {
    humanLabel: label,
    ...(relatedClaimId ? { relatedClaimId, humanRelation } : {}),
    humanDirection,
    reviewerConfidence: confidence,
    notes,
    submittedAt: new Date().toISOString()
  };
  await persist();
}

async function selectRelatedClaim(record) {
  while (true) {
    const answer = (await rl.question("选择 Candidate 1-5，或输入搜索词 / Claim ID：")).trim();
    const number = Number(answer);
    if (Number.isInteger(number) && number >= 1 && number <= record.topCandidates.length) return record.topCandidates[number - 1].id;
    const query = answer.toLowerCase();
    const results = Object.values(evaluationState.graph.nodes)
      .filter((claim) => claim.claimId !== record.targetClaim.id && [claim.claimId, claim.statement, claim.topic ?? "", claim.sourcePath]
        .join(" ").toLowerCase().includes(query))
      .slice(0, 10)
      .map((claim) => ({ id: claim.claimId, statement: claim.statement }));
    if (results.length === 0) { console.log("未找到匹配 Claim。"); continue; }
    results.forEach((claim, index) => console.log(`${index + 1}. ${claim.id}\n   ${claim.statement}`));
    const selected = Number(await rl.question("选择搜索结果序号："));
    if (Number.isInteger(selected) && selected >= 1 && selected <= results.length) return results[selected - 1].id;
  }
}

async function askDirection(relation) {
  if (!isDirectional(relation)) return relation === "uncertain" ? "uncertain" : "not_applicable";
  return ["a_to_b", "b_to_a", "uncertain"][await choose("Direction", ["A → B", "B → A", "uncertain"] )];
}

async function choose(title, choices) {
  console.log(`\n${title}:`);
  choices.forEach((choice, index) => console.log(`${index + 1}. ${choice}`));
  while (true) {
    const selected = Number(await rl.question("> "));
    if (Number.isInteger(selected) && selected >= 1 && selected <= choices.length) return selected - 1;
    console.log("请输入有效序号。");
  }
}

function printClaim(label, claim) {
  console.log(`\n${label}:\n${claim.statement}\nSource: ${claim.sourcePath}\nID: ${claim.id}`);
}
function relationFromChoice(index) { return ["duplicate", "supports", "refines", "contradicts", "depends_on", "unrelated", "uncertain"][index]; }
function isDirectional(relation) { return relation === "supports" || relation === "refines" || relation === "depends_on"; }
function firstIncompleteKind() {
  if (Object.keys(annotations.edge).length < dataset.edges.length) return "edge";
  if (Object.keys(annotations.unrelated).length < dataset.unrelated.length) return "unrelated";
  if (Object.keys(annotations.orphan).length < dataset.orphans.length) return "orphan";
  return null;
}
function printProgress() {
  console.log(`\nHuman Review Progress\nEdge: ${Object.keys(annotations.edge).length}/${dataset.edges.length}\nUnrelated: ${Object.keys(annotations.unrelated).length}/${dataset.unrelated.length}\nOrphan: ${Object.keys(annotations.orphan).length}/${dataset.orphans.length}`);
}
async function persist() {
  annotations.updatedAt = new Date().toISOString();
  runtime.validateAnnotations(dataset, annotations, false);
  await writeFile(path.join(datasetRoot, "annotations.json"), `${JSON.stringify(annotations, null, 2)}\n`, "utf8");
}
async function loadDataset() {
  const [manifest, edge, unrelated, orphan] = await Promise.all(["evaluation-manifest.json", "edge-review.json", "unrelated-review.json", "orphan-review.json"].map(async (name) => JSON.parse(await readFile(path.join(datasetRoot, name), "utf8"))));
  return { manifest, edges: edge.records, unrelated: unrelated.records, orphans: orphan.records };
}
async function loadRuntime() {
  const { build } = await import("esbuild");
  const result = await build({ entryPoints: ["scripts/claim-graph-evaluation-runtime.ts"], bundle: true, platform: "node", format: "esm", target: "node20", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
async function assertDatasetFilesReadable() {
  try {
    await Promise.all(requiredDatasetFiles.map((name) => readFile(path.join(datasetRoot, name))));
  } catch (error) {
    throw new DatasetUnavailableError("Graph Quality Evaluation dataset is unavailable locally.", { cause: error });
  }
}
function handleFatalError(error) {
  process.exitCode = 1;
  if (error instanceof DatasetUnavailableError) {
    console.error(error.message);
    console.error("The frozen dataset was not regenerated or modified.");
  } else if (error instanceof VaultFileUnavailableError) {
    console.error(error.message);
    console.error("Make the required Claim Store, Claim Graph, and plugin settings files available locally, then retry.");
  } else if (isLocalReadFailure(error)) {
    console.error([
      "Knowledge Curator could not read a local project file.",
      "",
      "This usually happens when macOS/iCloud has offloaded the file.",
      "",
      "Run:",
      "",
      "npm run preflight:local-files",
      "",
      "and make sure the repository is fully downloaded locally."
    ].join("\n"));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  if (process.env.KC_DEBUG === "1" && error instanceof Error) console.error(error.stack);
}
function isLocalReadFailure(error) {
  let current = error;
  while (current instanceof Error) {
    if (current.code === "ETIMEDOUT" || current.syscall === "read" || current.message.includes("ETIMEDOUT")) return true;
    current = current.cause;
  }
  return false;
}
async function loadScope(root) {
  const settings = JSON.parse(await readFile(path.join(root, ".obsidian/plugins/knowledge-curator/data.json"), "utf8"));
  return { inboxFolder: settings.inboxFolder, wikiFolder: settings.wikiFolder, rawFolders: settings.rawFolders };
}
async function saveJson(name, value) { await writeFile(path.join(datasetRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function resolveConfiguredPath(value) { if (!value) return ""; return path.resolve(projectRoot, value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value); }
function resolveGraphSnapshotPath(manifest) {
  if (typeof manifest.graphSnapshotPath !== "string" || manifest.graphSnapshotPath.length === 0) return undefined;
  const snapshotsRoot = path.resolve(projectRoot, "KnowledgeCuratorValidation", "snapshots", "graph-quality");
  const resolved = path.resolve(projectRoot, manifest.graphSnapshotPath);
  if (resolved !== snapshotsRoot && !resolved.startsWith(`${snapshotsRoot}${path.sep}`)) {
    throw new DatasetUnavailableError("Graph Quality Evaluation snapshot path is invalid.");
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
