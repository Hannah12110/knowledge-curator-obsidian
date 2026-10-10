import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const dataPath = process.env.KC_PLUGIN_DATA;
const claimStorePath = process.env.KC_CLAIM_STORE;
const sourcePath = process.env.KC_SOURCE_PATH;
if (!dataPath || !claimStorePath || !sourcePath) {
  throw new Error("Set KC_PLUGIN_DATA, KC_CLAIM_STORE, and KC_SOURCE_PATH.");
}
const [data, store, runtime] = await Promise.all([
  readFile(dataPath, "utf8").then(JSON.parse),
  readFile(claimStorePath, "utf8").then(JSON.parse),
  loadRuntime()
]);
const entry = data.analysisCache?.[sourcePath];
if (!entry?.analysis?.claimAnalysis) {
  throw new Error(`No Claim analysis cache for ${sourcePath}`);
}
const addIds = new Set(entry.analysis.claimAnalysis.comparisons
  .filter((comparison) => comparison.relation === "add")
  .map((comparison) => comparison.candidateClaimId));
const candidates = entry.analysis.claimAnalysis.candidateClaims
  .filter((candidate) => addIds.has(candidate.id));
const rows = runtime.retrieveAuditRows(candidates, Object.values(store.claims), 5);
process.stdout.write(`${JSON.stringify({
  sourcePath,
  relationCounts: entry.analysis.claimAnalysis.comparisons.reduce((counts, comparison) => {
    counts[comparison.relation] = (counts[comparison.relation] ?? 0) + 1;
    return counts;
  }, {}),
  rows
}, null, 2)}\n`);

async function loadRuntime() {
  const result = await build({
    entryPoints: ["scripts/live-claim-audit-runtime.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("Could not build live Claim audit runtime.");
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
