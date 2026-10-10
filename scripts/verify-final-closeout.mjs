import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vaultArgument = readArgument("--vault");
if (vaultArgument === undefined || vaultArgument.trim().length === 0) fail("Missing required --vault argument.");
const vaultRoot = resolve(vaultArgument);

const claimStorePath = join(vaultRoot, ".knowledge-agent/claim-store/store.json");
const graphStorePath = join(vaultRoot, ".knowledge-agent/claim-graph/store.json");
const evaluationPath = join(repositoryRoot, "KnowledgeCuratorValidation/reports/graph-quality-evaluation.json");
const modelChoicePath = join(repositoryRoot, "KnowledgeCuratorValidation/calibration/model-choice/2026-10-08T09-18-04.412Z-f7f2427b/model-comparison.json");
const manifestPath = join(repositoryRoot, "KnowledgeCuratorValidation/datasets/graph-quality/evaluation-manifest.json");

const markdownBefore = await markdownManifest(vaultRoot);
const [claimStore, graphStore, evaluation, modelChoice, evaluationManifest] = await Promise.all([
  json(claimStorePath),
  json(graphStorePath),
  json(evaluationPath),
  json(modelChoicePath),
  json(manifestPath)
]);
const frozenGraphPath = join(repositoryRoot, evaluationManifest.graphSnapshotPath);
const [liveGraphHash, frozenGraphHash, uiSource, boundarySource] = await Promise.all([
  hashFile(graphStorePath),
  hashFile(frozenGraphPath),
  readFile(join(repositoryRoot, "src/views/curator-view.ts"), "utf8"),
  readFile(join(repositoryRoot, "src/knowledge/claim-graph-release-boundary.ts"), "utf8")
]);

check(Object.keys(claimStore.claims ?? {}).length === 184, "Claim Store must contain 184 Claims.");
check(Object.keys(claimStore.files ?? {}).length === 7, "Claim Store must contain 7 indexed Wiki files.");
check(graphStore.metadata?.nodeCount === 184, "Claim Graph must contain 184 nodes.");
check(graphStore.metadata?.edgeCount === 43, "Claim Graph must contain 43 suggested edges.");
check(graphStore.metadata?.buildMetadata?.autoCompressionWrites === 0, "Claim Graph build must not write compression changes.");
check(graphStore.metadata?.buildMetadata?.autoConflictResolutions === 0, "Claim Graph build must not auto-resolve conflicts.");
check(liveGraphHash === frozenGraphHash, "Live Graph and frozen evaluation Graph differ.");
check(evaluation.metrics?.coverage?.edge?.reviewed === 43, "Expected 43 reviewed edges.");
check(evaluation.metrics?.coverage?.unrelated?.reviewed === 13, "Expected 13 reviewed unrelated pairs.");
check(evaluation.metrics?.coverage?.orphan?.reviewed === 0, "Expected zero reviewed orphan Claims.");
check(modelChoice.result === "MODEL_INDEPENDENT_LIMITATION", "Final model-choice decision is not frozen.");
check(modelChoice.productionCandidate === null, "No production relation model may be selected.");
check(modelChoice.compressionEligible === false, "Autonomous compression must remain ineligible.");
check(uiSource.includes("AI 建议关系"), "Claim Graph UI must label relations as AI suggestions.");
check(!uiSource.includes("this.actions.getCompressionProposals()"), "Claim Graph UI must not load compression proposals.");
check(boundarySource.includes("BLOCKED_BY_QUALITY_GATE"), "Compression quality gate boundary is missing.");
check(boundarySource.includes("HUMAN_IN_THE_LOOP"), "Human-in-the-loop Graph boundary is missing.");

const markdownAfter = await markdownManifest(vaultRoot);
check(JSON.stringify(markdownBefore) === JSON.stringify(markdownAfter), "Vault Markdown changed during final closeout verification.");

const result = {
  status: "PASS",
  execution: "READ_ONLY_FINAL_E2E",
  sourceWorkflow: {
    claimStoreClaims: 184,
    indexedWiki: 7,
    verificationAndKnowledgePrContracts: "covered_by_automated_tests",
    humanReviewRequired: true
  },
  graphWorkflow: {
    nodes: 184,
    suggestedEdges: 43,
    edgeHumanReview: "43/43",
    unrelatedHumanReview: "13/40",
    orphanHumanReview: "0/30",
    relationModelQuality: "LIMITED",
    humanReviewPolicy: "HUMAN_IN_THE_LOOP"
  },
  compression: "BLOCKED_BY_QUALITY_GATE",
  safety: {
    markdownBefore: markdownBefore.length,
    markdownAfter: markdownAfter.length,
    changedMarkdown: 0,
    llmCalls: 0,
    tavilyCalls: 0,
    graphBuilds: 0,
    claimMerges: 0,
    graphDrivenDeletes: 0,
    compressionWrites: 0
  },
  protectedHashes: {
    liveGraph: liveGraphHash,
    frozenGraph: frozenGraphHash
  },
  warning: markdownBefore.length === 169
    ? null
    : `The historical Phase 7.5 Vault snapshot contained 169 Markdown files; the current closeout baseline contains ${markdownBefore.length}.`
};

console.log(JSON.stringify(result, null, 2));

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function markdownManifest(root) {
  const paths = await walk(root);
  const markdown = paths.filter((path) => path.endsWith(".md")).sort();
  return Promise.all(markdown.map(async (path) => ({
    path: relative(root, path),
    hash: await hashFile(path)
  })));
}

async function walk(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile() && (await stat(path)).isFile()) output.push(path);
  }
  return output;
}

function check(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`Final closeout verification failed: ${message}`);
  process.exit(1);
}
