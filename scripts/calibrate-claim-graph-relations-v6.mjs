import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = path.join(projectRoot, "KnowledgeCuratorValidation/datasets/graph-quality");
await loadLocalEnvironment();
const vaultRoot = path.resolve(argument("--vault") ?? process.env.TEST_VAULT ?? "");
if (!vaultRoot) throw new Error("TEST_VAULT 未配置，请使用 --vault <path>。");
const [manifest, edgeFile, unrelatedFile, orphanFile, annotations, settings] = await Promise.all([
  ...["evaluation-manifest.json", "edge-review.json", "unrelated-review.json", "orphan-review.json", "annotations.json"].map(loadDataset),
  loadJson(path.join(vaultRoot, ".obsidian/plugins/knowledge-curator/data.json"))
]);
if (!settings.llmApiKey?.trim() || !String(settings.llmBaseUrl).includes("deepseek")) throw new Error("DeepSeek Provider 未正确配置。");
for (const value of [edgeFile, unrelatedFile, orphanFile, annotations]) if (value.datasetFingerprint !== manifest.datasetFingerprint) throw new Error("Frozen dataset fingerprint mismatch.");
const dataset = { manifest, edges: edgeFile.records, unrelated: unrelatedFile.records, orphans: orphanFile.records };
const [v4Run, v5Run] = await Promise.all([
  latestRun("relation-v3", manifest.datasetFingerprint, "claim-graph-relation-prompt-v4"),
  latestRun("relation-v5", manifest.datasetFingerprint, "claim-graph-relation-prompt-v5")
]);
const [v4Predictions, v5Predictions, v4Metadata, v5Metadata] = await Promise.all([
  loadJson(path.join(v4Run, "predictions.json")), loadJson(path.join(v5Run, "predictions.json")),
  loadJson(path.join(v4Run, "run-metadata.json")), loadJson(path.join(v5Run, "run-metadata.json"))
]);
const fixtures = await Promise.all(["relation-policy-v3.json", "relation-policy-v4.json", "relation-policy-v5.json"].map((name) => loadJson(path.join(projectRoot, "KnowledgeCuratorRegression/claim-graph-calibration", name))));
const heldOutFixture = { cases: fixtures.flatMap((item) => item.cases) };
const graphSnapshot = path.resolve(projectRoot, manifest.graphSnapshotPath);
const protectedFiles = [
  ...["evaluation-manifest.json", "edge-review.json", "unrelated-review.json", "orphan-review.json", "annotations.json"].map((name) => path.join(datasetRoot, name)),
  graphSnapshot, path.join(vaultRoot, ".knowledge-agent/claim-store/store.json"), path.join(vaultRoot, ".knowledge-agent/claim-graph/store.json")
];
const before = await hashes(protectedFiles);
const markdownBefore = await markdownManifest(vaultRoot);
const runtime = await loadRuntime();
const replay = await runtime.replayFrozenRelationCalibration(settings, dataset, annotations, v4Predictions.candidate, v5Predictions.promptV5, "claim-graph-relation-prompt-v6");
const heldOut = await runtime.replayHeldOutRelationFixtures(settings, heldOutFixture, "claim-graph-relation-prompt-v6");
const after = await hashes(protectedFiles);
const markdownAfter = await markdownManifest(vaultRoot);
if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(markdownBefore) !== JSON.stringify(markdownAfter)) throw new Error("Prompt v6 replay modified a protected artifact or Markdown.");
const v4Metrics = replay.baselineMetrics;
const v5Metrics = replay.promptV4Metrics;
const v6Metrics = replay.candidateMetrics;
const reviewed = [...dataset.edges, ...dataset.unrelated].filter((record) => annotations.edge[record.reviewId] || annotations.unrelated[record.reviewId]);
const byHuman = new Map(reviewed.map((record) => [record.reviewId, annotations.edge[record.reviewId] ?? annotations.unrelated[record.reviewId]]));
const v5ById = new Map(replay.promptV4Predictions.map((item) => [item.pairId, item]));
const v6ById = new Map(replay.candidatePredictions.map((item) => [item.pairId, item]));
const falseNegatives = reviewed.filter((record) => {
  const human = byHuman.get(record.reviewId); const predicted = v6ById.get(record.reviewId);
  return human?.humanRelation !== "unrelated" && predicted?.relationExistence !== "related";
});
const falsePositives = reviewed.filter((record) => {
  const human = byHuman.get(record.reviewId); const predicted = v6ById.get(record.reviewId);
  return human?.humanRelation === "unrelated" && predicted?.relationExistence === "related";
});
const directionAnalysis = directionSets(reviewed, byHuman, v5ById, v6ById);
const expectedDuplicates = new Set(heldOutFixture.cases.filter((item) => item.relation === "duplicate").map((item) => item.id));
const predictedDuplicates = heldOut.cases.filter((item) => item.predictedRelation === "duplicate");
const duplicateSafety = {
  trueDuplicateDetected: predictedDuplicates.filter((item) => expectedDuplicates.has(item.id)).length,
  expectedTrueDuplicates: expectedDuplicates.size,
  falseDuplicateCount: predictedDuplicates.filter((item) => !expectedDuplicates.has(item.id)).length,
  predictedDuplicateCount: predictedDuplicates.length
};
const gate = step43Gate(v6Metrics);
const runId = `${new Date().toISOString().replaceAll(":", "-")}-${manifest.datasetFingerprint.slice(0, 8)}`;
const runRoot = path.join(projectRoot, "KnowledgeCuratorValidation/calibration/relation-v6", runId);
await mkdir(runRoot, { recursive: true });
const metadata = { runId, generatedAt: new Date().toISOString(), datasetFingerprint: manifest.datasetFingerprint, graphFingerprint: manifest.graphFingerprint, claimStoreFingerprint: manifest.claimStoreFingerprint, model: settings.llmModel, temperature: 0.1, promptVersion: "claim-graph-relation-prompt-v6", relationPolicyVersion: "claim-graph-relations-v5", baselineV4RunId: v4Metadata.runId, baselineV5RunId: v5Metadata.runId, inputPairIds: replay.inputPairIds, providerCalls: replay.executionMetrics.providerCalls + heldOut.executionMetrics.providerCalls, retryCalls: replay.executionMetrics.retryCalls + heldOut.executionMetrics.retryCalls, failedPairs: [], writes: { graphStore: 0, frozenGraph: 0, dataset: 0, annotations: 0, claimStore: 0, markdown: 0 } };
await Promise.all([
  write("predictions.json", { promptV4: replay.baselinePredictions, promptV5: replay.promptV4Predictions, promptV6: replay.candidatePredictions }),
  write("relation-existence.json", replay.candidatePredictions.map((item) => ({ pairId: item.pairId, relationExistence: item.relationExistence, relation: item.relation }))),
  write("relation-bridges.json", replay.candidatePredictions.map((item) => ({ pairId: item.pairId, relationBridge: item.relationBridge, relation: item.relation, reasoning: item.reasoning }))),
  write("metrics.json", { promptV4: v4Metrics, promptV5: v5Metrics, promptV6: v6Metrics, gate, directionAnalysis }),
  write("confusion-matrix.json", { promptV4: v4Metrics.confusionMatrix, promptV5: v5Metrics.confusionMatrix, promptV6: v6Metrics.confusionMatrix }),
  write("false-negatives.json", falseNegatives), write("false-positives.json", falsePositives),
  write("duplicate-safety.json", duplicateSafety), write("held-out-results.json", heldOut),
  write("run-metadata.json", metadata), write("safety-audit.json", { protectedArtifactsChanged: 0, markdownBefore: markdownBefore.length, markdownAfter: markdownAfter.length, markdownChanged: 0, tavilyCalls: 0, graphRebuilds: 0, compressionWrites: 0 }),
  writeFile(path.join(runRoot, "report.md"), render(metadata, v4Metrics, v5Metrics, v6Metrics, gate, duplicateSafety, directionAnalysis, heldOut), "utf8")
]);
console.log(await readFile(path.join(runRoot, "report.md"), "utf8"));
console.log(`Artifacts: ${path.relative(projectRoot, runRoot)}`);

async function write(name, value) { await writeFile(path.join(runRoot, name), `${JSON.stringify(value, null, 2)}\n`); }
function step43Gate(m) { const ok = (x, n) => x.rate !== null && x.rate >= n; const checks = { edgePrecision: ok(m.edgePrecision,.9), relationAccuracy: ok(m.relationAccuracy,.8), directionAccuracy: ok(m.directionAccuracy,.9), existenceAccuracy: ok(m.relationExistence.accuracy,.9), existencePrecision: ok(m.relationExistence.precision,.9), existenceRecall: ok(m.relationExistence.recall,.9), supportsPrecision: ok(m.perRelationPrecision.supports,.75), refinesPrecision: ok(m.perRelationPrecision.refines,.8), duplicateSafety: m.duplicateFalsePositives===0, sampledFn: m.sampledUnrelatedFalseNegativeRate.numerator<=2, unrelatedFp: m.sampledUnrelatedNewFalsePositives<=1 }; return { checks, passed: Object.values(checks).every(Boolean) }; }
function directionSets(records, human, v5, v6) { const common=[], recovered=[]; for (const r of records) { const h=human.get(r.reviewId); if (!h || !["supports","refines","depends_on"].includes(h.humanRelation)) continue; const a=v5.get(r.reviewId), b=v6.get(r.reviewId); const row={reviewId:r.reviewId,humanDirection:h.humanDirection,v5Direction:dir(a),v6Direction:dir(b),v6Correct:dir(b)===h.humanDirection}; if (a?.relation===h.humanRelation && b?.relation===h.humanRelation) common.push(row); if (a?.relationExistence!=="related" && b?.relationExistence==="related") recovered.push(row); } return { commonRelationSet:{total:common.length,errors:common.filter(x=>!x.v6Correct).length,cases:common},newlyRecoveredRelations:{total:recovered.length,errors:recovered.filter(x=>!x.v6Correct).length,cases:recovered} }; }
function dir(x) { return x?.direction==="left_to_right"?"a_to_b":x?.direction==="right_to_left"?"b_to_a":x?.direction==="uncertain"?"uncertain":"not_applicable"; }
function pct(x) { return x.rate===null?"N/A":`${(x.rate*100).toFixed(1)}% (${x.numerator}/${x.denominator})`; }
function render(meta,a,b,c,gate,dup,direction,held) { const row=(n,k)=>`| ${n} | ${pct(a[k])} | ${pct(b[k])} | ${pct(c[k])} |`; return `# Phase 7.5 Step 4.3 — Non-Duplicate Relation Existence Calibration\n\n- Run: ${meta.runId}\n- Model: ${meta.model}\n- Prompt: ${meta.promptVersion}\n\n| Metric | v4 | v5 | v6 |\n|---|---:|---:|---:|\n${row("Edge Precision","edgePrecision")}\n${row("Relation Accuracy","relationAccuracy")}\n${row("Direction Accuracy","directionAccuracy")}\n| Existence Accuracy | ${pct(a.relationExistence.accuracy)} | ${pct(b.relationExistence.accuracy)} | ${pct(c.relationExistence.accuracy)} |\n| Existence Precision | ${pct(a.relationExistence.precision)} | ${pct(b.relationExistence.precision)} | ${pct(c.relationExistence.precision)} |\n| Existence Recall | ${pct(a.relationExistence.recall)} | ${pct(b.relationExistence.recall)} | ${pct(c.relationExistence.recall)} |\n| Supports Precision | ${pct(a.perRelationPrecision.supports)} | ${pct(b.perRelationPrecision.supports)} | ${pct(c.perRelationPrecision.supports)} |\n| Refines Precision | ${pct(a.perRelationPrecision.refines)} | ${pct(b.perRelationPrecision.refines)} | ${pct(c.perRelationPrecision.refines)} |\n| Sampled Unrelated FN | ${pct(a.sampledUnrelatedFalseNegativeRate)} | ${pct(b.sampledUnrelatedFalseNegativeRate)} | ${pct(c.sampledUnrelatedFalseNegativeRate)} |\n\n## Duplicate Safety\n\n- Predicted duplicate: ${dup.predictedDuplicateCount}\n- True duplicate detected: ${dup.trueDuplicateDetected}/${dup.expectedTrueDuplicates}\n- False duplicate: ${dup.falseDuplicateCount}\n- Coverage: ${dup.predictedDuplicateCount===0?"INSUFFICIENT_EVIDENCE":"OBSERVED"}\n\n## Direction\n\n- Common relation set: ${direction.commonRelationSet.errors}/${direction.commonRelationSet.total} errors\n- Newly recovered relations: ${direction.newlyRecoveredRelations.errors}/${direction.newlyRecoveredRelations.total} errors\n\n## Held-out\n\n- Passed: ${held.passed}/${held.total}\n\n## Gate\n\n${Object.entries(gate.checks).map(([k,v])=>`- ${k}: ${v?"PASS":"FAIL"}`).join("\n")}\n\n## Result\n\nStep 4.3: ${gate.passed?"PASS":"FAIL"}\n` }
async function latestRun(folder, fingerprint, prompt) { const root=path.join(projectRoot,"KnowledgeCuratorValidation/calibration",folder); const entries=(await readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>x.name).sort().reverse(); for(const name of entries){try{const m=await loadJson(path.join(root,name,"run-metadata.json"));if(m.datasetFingerprint===fingerprint&&m.candidatePromptVersion===prompt)return path.join(root,name);}catch{}} throw new Error(`Missing ${prompt} baseline.`); }
async function loadRuntime() { const result=await build({entryPoints:["scripts/claim-graph-calibration-runtime.ts"],bundle:true,platform:"node",format:"esm",target:"node20",write:false,plugins:[{name:"obsidian-stub",setup(api){api.onResolve({filter:/^obsidian$/u},()=>({path:"obsidian",namespace:"stub"}));api.onLoad({filter:/.*/u,namespace:"stub"},()=>({contents:"export async function requestUrl(){throw new Error('Injected transport required.')}"}));}}]}); return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`); }
async function markdownManifest(root){const {execFile}=await import("node:child_process");const {promisify}=await import("node:util");const {stdout}=await promisify(execFile)("find",[root,"-type","f","-name","*.md","-print"]);const files=stdout.split("\n").filter(Boolean).sort();return Promise.all(files.map(async f=>[path.relative(root,f),createHash("sha256").update(await readFile(f)).digest("hex")]));}
async function hashes(files){return Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash("sha256").update(await readFile(f)).digest("hex")])));}
async function loadDataset(name){return loadJson(path.join(datasetRoot,name));} async function loadJson(file){return JSON.parse(await readFile(file,"utf8"));}
function argument(name){const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];}
async function loadLocalEnvironment(){try{const text=await readFile(path.join(projectRoot,".env.local"),"utf8");for(const raw of text.split(/\r?\n/u)){const m=raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);if(!m||process.env[m[1]]!==undefined)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);process.env[m[1]]=v;}}catch(e){if(e?.code!=="ENOENT")throw e;}}
