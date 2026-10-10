import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const ROOT = resolve("KnowledgeCuratorRegression");
const EXPECTED_DIR = resolve(ROOT, "expected");
const OUTPUT_DIR = resolve(ROOT, "outputs");
const REPORT_JSON = resolve("regression-report.json");
const REPORT_MD = resolve("regression-report.md");
const BASELINE = resolve("regression-baseline.json");
const COMPARISON_CASES = resolve(ROOT, "claim-comparison", "cases.json");
const HARNESS_FIXED_CASES = resolve(ROOT, "claim-comparison", "harness-fixed.json");
const AGENT_MEMORY_FIXED_CASES = resolve(ROOT, "claim-comparison", "agent-memory-fixed.json");
const FRESHNESS_CASES = resolve(ROOT, "freshness", "cases.json");
const CLAIM_GRAPH_CASES = resolve(ROOT, "claim-graph", "cases.json");
const updateBaseline = process.argv.includes("--update-baseline");
const claimRuntime = await loadClaimRuntime();
console.log("Regression runtime: claim loaded");
const comparisonRuntime = await loadComparisonRuntime();
console.log("Regression runtime: comparison loaded");
const freshnessRuntime = await loadFreshnessRuntime();
console.log("Regression runtime: freshness loaded");
const graphRuntime = await loadGraphRuntime();
console.log("Regression runtime: claim graph loaded");

const expectedFiles = (await readdir(EXPECTED_DIR))
  .filter((file) => file.endsWith(".json"))
  .sort();

const rows = [];
for (const file of expectedFiles) {
  console.log(`Regression case: ${file}`);
  const expected = JSON.parse(await readFile(resolve(EXPECTED_DIR, file), "utf8"));
  const actual = JSON.parse(await readFile(resolve(OUTPUT_DIR, file), "utf8"));
  if (expected.caseId !== actual.caseId) {
    throw new Error(`Case identity mismatch in ${file}`);
  }
  if (expected.expected.claimInput) {
    actual.actual.claim = await claimRuntime.evaluateClaimCase(
      expected.expected.claimInput,
      actual.providerComparison
    );
  }
  rows.push(evaluateCase(expected, actual));
}
console.log(`Regression runtime: ${rows.length} output snapshots evaluated`);

for (const path of [COMPARISON_CASES, HARNESS_FIXED_CASES, AGENT_MEMORY_FIXED_CASES]) {
  const fixtureFile = JSON.parse(await readFile(path, "utf8"));
  for (const fixture of fixtureFile.cases) {
    const actual = await comparisonRuntime.evaluateFixedComparisonCase(fixture);
    rows.push(evaluateComparisonCase(fixture, actual));
  }
}
console.log(`Regression runtime: ${rows.length} comparison cases evaluated`);

const freshnessFixtures = JSON.parse(await readFile(FRESHNESS_CASES, "utf8"));
for (const fixture of freshnessFixtures.riskCases) {
  const actual = await freshnessRuntime.evaluateRiskCase(fixture);
  const riskPass = fixture.expectedRisk.includes(actual.freshnessRisk);
  const factorPass = fixture.requiredFactors.every((factor) => actual.riskFactors.some((item) => item.type === factor));
  const highDetected = actual.freshnessRisk === "high" || actual.freshnessRisk === "critical";
  const checks = [
    check("freshnessRisk", riskPass && factorPass, { risk: fixture.expectedRisk, factors: fixture.requiredFactors }, { risk: actual.freshnessRisk, factors: actual.riskFactors.map((item) => item.type) }, "F1 Freshness Risk Mismatch"),
    check("freshnessHighRecall", fixture.highExpected ? highDetected : true, fixture.highExpected, highDetected, "F2 High-risk Miss"),
    check("freshnessLowFalseAlarm", fixture.highExpected ? true : !highDetected, false, highDetected, "F3 Low-risk False Alarm")
  ];
  rows.push({ caseId: fixture.caseId, type: "freshness-risk", passed: checks.every((item) => item.pass), failureType: checks.find((item) => !item.pass)?.failureType ?? "none", reason: checks.find((item) => !item.pass)?.name ?? "freshness risk expectations matched", checks });
}
console.log(`Regression runtime: ${rows.length} freshness risk cases evaluated`);
for (const fixture of freshnessFixtures.verificationCases) {
  const actual = freshnessRuntime.evaluateVerificationCase(fixture);
  const checks = [
    check("freshnessVerification", fixture.expected.includes(actual.resolution), fixture.expected, actual.resolution, "F4 Freshness Verification Mismatch"),
    check("unsafeMaintenanceReplace", actual.unsafeReplace === false, false, actual.unsafeReplace, "F5 Unsafe Maintenance Replace")
  ];
  rows.push({ caseId: fixture.caseId, type: "freshness-verification", passed: checks.every((item) => item.pass), failureType: checks.find((item) => !item.pass)?.failureType ?? "none", reason: checks.find((item) => !item.pass)?.name ?? "freshness verification expectations matched", checks });
}
console.log(`Regression runtime: ${rows.length} total cases evaluated`);

const graphFixtures = JSON.parse(await readFile(CLAIM_GRAPH_CASES, "utf8"));
for (const fixture of graphFixtures.cases) {
  const actual = await graphRuntime.evaluateGraphCase(fixture);
  const checks = [
    check("graphRelation", actual.relation === fixture.expected, fixture.expected, actual.relation, "G1 Relation Mismatch"),
    check("unsafeGraphMerge", actual.unsafeMerge === false, false, actual.unsafeMerge, "G2 Unsafe Merge")
  ];
  if (fixture.orphan === true) {
    checks.push(check("graphOrphan", actual.orphan === true, true, actual.orphan, "G3 Orphan Detection"));
  }
  rows.push({ caseId: fixture.caseId, type: "claim-graph", passed: checks.every((item) => item.pass), failureType: checks.find((item) => !item.pass)?.failureType ?? "none", reason: checks.find((item) => !item.pass)?.name ?? "graph relation expectations matched", checks });
}
console.log(`Regression runtime: ${rows.length} cases including Claim Graph evaluated`);

async function loadClaimRuntime() {
  const result = await build({
    entryPoints: ["scripts/claim-regression-runtime.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("Could not build Claim regression runtime.");
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

async function loadComparisonRuntime() {
  const result = await build({
    entryPoints: ["scripts/comparison-regression-runtime.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("Could not build Comparison regression runtime.");
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

async function loadFreshnessRuntime() {
  const result = await build({ entryPoints: ["scripts/freshness-regression-runtime.ts"], bundle: true, platform: "node", format: "esm", target: "node20", write: false });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("Could not build Freshness regression runtime.");
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

async function loadGraphRuntime() {
  const result = await build({ entryPoints: ["scripts/claim-graph-regression-runtime.ts"], bundle: true, platform: "node", format: "esm", target: "node20", write: false });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("Could not build Claim Graph regression runtime.");
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const metrics = buildMetrics(rows);
const baseline = await readBaseline();
const baselineComparison = compareBaseline(baseline, rows, metrics);
const failureTaxonomy = Object.fromEntries(
  rows.filter((row) => !row.passed)
    .reduce((map, row) => {
      map.set(row.failureType, (map.get(row.failureType) ?? 0) + 1);
      return map;
    }, new Map())
);
const report = sanitize({
  generatedAt: new Date().toISOString(),
  mode: "offline-product-output-snapshot",
  totalCases: rows.length,
  passed: rows.filter((row) => row.passed).length,
  failed: rows.filter((row) => !row.passed).length,
  metrics,
  baselineComparison,
  releaseGate: evaluateGate(metrics),
  failureTaxonomy,
  cases: rows
});

await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(REPORT_MD, renderMarkdown(report), "utf8");

if (updateBaseline) {
  await writeFile(BASELINE, `${JSON.stringify({
    createdAt: report.generatedAt,
    totalCases: report.totalCases,
    passed: report.passed,
    metrics: report.metrics,
    caseResults: Object.fromEntries(rows.map((row) => [row.caseId, row.passed]))
  }, null, 2)}\n`, "utf8");
}

console.log(`Regression: ${report.passed}/${report.totalCases} cases passed; ${baselineComparison.summary}.`);
for (const metric of Object.values(metrics)) {
  console.log(`${metric.label}: ${formatPercent(metric.value)} (n=${metric.sampleSize})`);
}
if (!report.releaseGate.pass) {
  console.error(`Release gate failed: ${report.releaseGate.failures.join("; ")}`);
  process.exitCode = 1;
}

function evaluateCase(expectedFile, actualFile) {
  const expected = expectedFile.expected;
  const actual = actualFile.actual;
  const checks = [];
  if (expected.relatedWikiTop1) {
    checks.push(check("relatedWikiTop1", actual.relatedWiki?.[0] === expected.relatedWikiTop1,
      expected.relatedWikiTop1, actual.relatedWiki?.[0], "R1 Retrieval Miss"));
    checks.push(check("relatedWikiTop3", actual.relatedWiki?.slice(0, 3).includes(expected.relatedWikiTop1) === true,
      expected.relatedWikiTop1, actual.relatedWiki?.slice(0, 3), "R1 Retrieval Miss"));
  }
  if (expected.knowledgeGain) {
    checks.push(check("knowledgeGain", expected.knowledgeGain.includes(actual.knowledgeGain),
      expected.knowledgeGain, actual.knowledgeGain, "R5 New Claim Miss"));
  }
  if (expected.allowedRecommendation) {
    checks.push(check("recommendation", expected.allowedRecommendation.includes(actual.recommendation),
      expected.allowedRecommendation, actual.recommendation, "R8 Recommendation Mismatch"));
  }
  if (typeof expected.expectedConflict === "boolean") {
    const hasConflict = Number(actual.conflictCount ?? 0) > 0;
    checks.push(check("conflict", hasConflict === expected.expectedConflict,
      expected.expectedConflict, hasConflict,
      hasConflict ? "R6 Conflict False Positive" : "R7 Conflict Miss"));
  }
  if (expected.verificationAllowed) {
    checks.push(check("verification", expected.verificationAllowed.includes(actual.verificationResolution),
      expected.verificationAllowed, actual.verificationResolution, "R11 Verification Weak Evidence"));
  }
  if (expected.prExpected) {
    const pr = actual.pr ?? {};
    checks.push(check("targetWiki", pr.target === expected.prExpected.target,
      expected.prExpected.target, pr.target, "R9 Wrong Target Wiki"));
    const actualTypes = Array.isArray(pr.changeTypes) ? pr.changeTypes : [];
    const allowedTypes = expected.prExpected.allowedTypes ?? [];
    const forbiddenTypes = expected.prExpected.forbidTypes ?? [];
    const structurePass = actualTypes.every((type) => allowedTypes.includes(type)) &&
      actualTypes.every((type) => !forbiddenTypes.includes(type)) &&
      Number(pr.changeCount ?? 0) <= Number(expected.prExpected.maxChanges ?? Infinity);
    checks.push(check("prStructure", structurePass, expected.prExpected, pr, "R10 Unsafe PR"));
  }
  if (expected.errorCode) {
    checks.push(check("providerError", actual.errorCode === expected.errorCode,
      expected.errorCode, actual.errorCode, "R12 Provider Failure"));
  }
  if (expected.claimExpected) {
    const claim = actual.claim ?? {};
    if (expected.claimExpected.existingClaimId) {
      checks.push(check(
        "claimRetrievalTop1V1",
        claim.v1RetrievedClaimIds?.[0] === expected.claimExpected.existingClaimId,
        expected.claimExpected.existingClaimId,
        claim.v1RetrievedClaimIds?.[0],
        "R1 Retrieval Miss"
      ));
      checks.push(check(
        "claimRetrievalTop3V1",
        claim.v1RetrievedClaimIds?.slice(0, 3).includes(expected.claimExpected.existingClaimId) === true,
        expected.claimExpected.existingClaimId,
        claim.v1RetrievedClaimIds?.slice(0, 3),
        "R1 Retrieval Miss"
      ));
      checks.push(check(
        "claimRetrievalTop1",
        claim.retrievedClaimIds?.[0] === expected.claimExpected.existingClaimId,
        expected.claimExpected.existingClaimId,
        claim.retrievedClaimIds?.[0],
        "R1 Retrieval Miss"
      ));
      checks.push(check(
        "claimRetrievalTop3",
        claim.retrievedClaimIds?.slice(0, 3).includes(expected.claimExpected.existingClaimId) === true,
        expected.claimExpected.existingClaimId,
        claim.retrievedClaimIds?.slice(0, 3),
        "R1 Retrieval Miss"
      ));
    }
    checks.push(check(
      "claimRelation",
      expected.claimExpected.allowedRelations.includes(claim.relation),
      expected.claimExpected.allowedRelations,
      claim.relation,
      claim.relation === "add" ? "R4 New Claim False Positive" : "R8 Recommendation Mismatch"
    ));
  }
  // v1 checks are A/B observations. A known v1 miss that v2 fixes must not make
  // the hardened case fail.
  const failed = checks.find((item) => !item.pass && !item.name.endsWith("V1"));
  return {
    caseId: expectedFile.caseId,
    type: expectedFile.type,
    passed: failed === undefined,
    failureType: failed?.failureType ?? "none",
    reason: failed === undefined ? "all declared expectations matched" : failed.name,
    knownClaim: expected.claimExpected?.knownClaim === true,
    retrievalCategory: expected.claimExpected?.retrievalCategory ?? "general",
    actualClaimRelation: actual.claim?.relation,
    checks
  };
}

function evaluateComparisonCase(fixture, actual) {
  const expected = fixture.expected;
  const v1RelationPass = expected.allowedRelations.includes(actual.v1.relation);
  const v2RelationPass = expected.allowedRelations.includes(actual.v2.relation);
  const coveragePass = expected.allowedCoverage.includes(actual.v2.coverage?.coverage);
  const mustNotPass = !(expected.mustNotBe ?? []).includes(actual.v2.relation);
  const checks = [
    check("comparisonRelationV1", v1RelationPass, expected.allowedRelations, actual.v1.relation, "C1-C8 Comparison Mismatch"),
    check("comparisonCoverage", coveragePass, expected.allowedCoverage, actual.v2.coverage?.coverage, "C1-C8 Coverage Mismatch"),
    check("comparisonRelation", v2RelationPass, expected.allowedRelations, actual.v2.relation, "C1-C8 Comparison Mismatch"),
    check("comparisonMustNot", mustNotPass, expected.mustNotBe ?? [], actual.v2.relation, "C1-C8 Unsafe Relation")
  ];
  const failed = checks.find((item) =>
    !item.pass && item.name !== "comparisonRelationV1" && expected.excludeFromGate !== true
  );
  return {
    caseId: fixture.caseId,
    type: fixture.category,
    passed: failed === undefined,
    failureType: failed?.failureType ?? "none",
    reason: failed === undefined ? "fixed comparison expectations matched" : failed.name,
    knownClaim: expected.knownClaim,
    expectedComparisonRelation: expected.allowedRelations,
    expectedCoverage: expected.allowedCoverage,
    comparisonTaxonomy: expected.taxonomy ?? "unknown",
    excludeFromComparisonGate: expected.excludeFromGate === true,
    actualComparisonV1: actual.v1.relation,
    actualComparisonV2: actual.v2.relation,
    actualCoverageV2: actual.v2.coverage?.coverage,
    checks
  };
}

function check(name, pass, expected, actual, failureType) {
  return { name, pass, expected, actual, failureType };
}

function buildMetrics(rows) {
  const ratio = (label, checks) => {
    const selected = rows.flatMap((row) => row.checks.filter((item) => checks.includes(item.name)));
    return {
      label,
      value: selected.length === 0 ? null : selected.filter((item) => item.pass).length / selected.length,
      sampleSize: selected.length
    };
  };
  const conflictRows = rows.flatMap((row) => row.checks.filter((item) => item.name === "conflict"));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const item of conflictRows) {
    if (item.expected === true && item.actual === true) tp += 1;
    if (item.expected === false && item.actual === true) fp += 1;
    if (item.expected === true && item.actual === false) fn += 1;
  }
  return {
    relatedWikiTop1: ratio("Related Wiki Top1 Accuracy", ["relatedWikiTop1"]),
    relatedWikiTop3: ratio("Related Wiki Top3 Recall", ["relatedWikiTop3"]),
    recommendation: ratio("Recommendation Agreement", ["recommendation"]),
    knowledgeGain: ratio("Knowledge Gain Agreement", ["knowledgeGain"]),
    conflictPrecision: {
      label: "Conflict Precision",
      value: tp + fp === 0 ? null : tp / (tp + fp),
      sampleSize: conflictRows.length,
      tp, fp, fn
    },
    conflictRecall: {
      label: "Conflict Recall",
      value: tp + fn === 0 ? null : tp / (tp + fn),
      sampleSize: conflictRows.length,
      tp, fp, fn
    },
    targetWiki: ratio("Target Wiki Accuracy", ["targetWiki"]),
    prStructure: ratio("PR Structural Pass Rate", ["prStructure"]),
    verification: ratio("Verification Agreement", ["verification"]),
    claimRetrievalTop1: ratio("Claim Retrieval Top1 Accuracy", ["claimRetrievalTop1"]),
    claimRetrievalTop3: ratio("Claim Retrieval Top3 Recall", ["claimRetrievalTop3"]),
    claimRetrievalTop1V1: ratio("Claim Retrieval v1 Top1 Accuracy", ["claimRetrievalTop1V1"]),
    claimRetrievalTop3V1: ratio("Claim Retrieval v1 Top3 Recall", ["claimRetrievalTop3V1"]),
    relationAgreement: ratio("Relation Agreement", ["claimRelation"]),
    falseNewRate: buildFalseNewRate(rows),
    bilingualRetrieval: buildCategoryRecall(rows, "bilingual", "Bilingual Retrieval Recall"),
    acronymRetrieval: buildCategoryRecall(rows, "acronym", "Acronym Retrieval Recall"),
    conflictRetrieval: buildCategoryRecall(rows, "conflict", "Conflict Retrieval Recall"),
    falseAddRetrievalMissV1: buildRetrievalMissRate(rows, "claimRetrievalTop3V1", "False ADD Retrieval Miss v1"),
    falseAddRetrievalMiss: buildRetrievalMissRate(rows, "claimRetrievalTop3", "False ADD Retrieval Miss v2"),
    coverageAgreement: ratio("Coverage Agreement", ["comparisonCoverage"]),
    comparisonRelationV1: ratio("Comparison v1 Relation Agreement", ["comparisonRelationV1"]),
    comparisonRelation: ratio("Comparison v2 Relation Agreement", ["comparisonRelation"]),
    falseAddComparisonV1: buildComparisonErrorRate(rows, "add", true, "False ADD Comparison Error v1"),
    falseAddComparison: buildComparisonErrorRate(rows, "add", false, "False ADD Comparison Error v2"),
    falseReinforceV1: buildFalseReinforceRate(rows, true, "False REINFORCE Rate v1"),
    falseReinforce: buildFalseReinforceRate(rows, false, "False REINFORCE Rate v2"),
    freshnessRiskAgreement: ratio("Risk Classification Agreement", ["freshnessRisk"]),
    freshnessHighRecall: ratio("High-risk Recall", ["freshnessHighRecall"]),
    freshnessLowFalseAlarm: buildFailureRate(rows, "freshnessLowFalseAlarm", "Low-risk False Alarm Rate"),
    freshnessVerification: ratio("Freshness Verification Agreement", ["freshnessVerification"]),
    unsafeReplace: buildFailureRate(rows, "unsafeMaintenanceReplace", "Unsafe Replace Rate")
    ,graphRelationAccuracy: ratio("Graph Relation Accuracy", ["graphRelation"])
    ,unsafeGraphMerge: buildFailureRate(rows, "unsafeGraphMerge", "Unsafe Graph Merge Rate")
    ,graphOrphanAccuracy: ratio("Graph Orphan Detection", ["graphOrphan"])
  };
}

function buildFailureRate(rows, checkName, label) {
  const selected = rows.flatMap((row) => row.checks.filter((item) => item.name === checkName));
  const errors = selected.filter((item) => !item.pass).length;
  return { label, value: selected.length === 0 ? null : errors / selected.length, sampleSize: selected.length, errors };
}

function comparisonRows(rows) {
  return rows.filter((row) =>
    row.actualComparisonV2 !== undefined && row.excludeFromComparisonGate !== true
  );
}

function buildComparisonErrorRate(rows, errorRelation, v1, label) {
  const selected = comparisonRows(rows).filter((row) => row.knownClaim === true);
  const field = v1 ? "actualComparisonV1" : "actualComparisonV2";
  const errors = selected.filter((row) =>
    row[field] === errorRelation && !row.expectedComparisonRelation.includes(errorRelation)
  ).length;
  return {
    label,
    value: selected.length === 0 ? null : errors / selected.length,
    sampleSize: selected.length,
    errors
  };
}

function buildFalseReinforceRate(rows, v1, label) {
  const selected = comparisonRows(rows).filter((row) => row.knownClaim === false);
  const field = v1 ? "actualComparisonV1" : "actualComparisonV2";
  const errors = selected.filter((row) => row[field] === "reinforce").length;
  return {
    label,
    value: selected.length === 0 ? null : errors / selected.length,
    sampleSize: selected.length,
    errors
  };
}

function buildCategoryRecall(rows, category, label) {
  const selected = rows.filter((row) => row.retrievalCategory === category)
    .flatMap((row) => row.checks.filter((item) => item.name === "claimRetrievalTop3"));
  return {
    label,
    value: selected.length === 0 ? null : selected.filter((item) => item.pass).length / selected.length,
    sampleSize: selected.length
  };
}

function buildRetrievalMissRate(rows, checkName, label) {
  const selected = rows.filter((row) => row.knownClaim)
    .flatMap((row) => row.checks.filter((item) => item.name === checkName));
  const misses = selected.filter((item) => !item.pass).length;
  return {
    label,
    value: selected.length === 0 ? null : misses / selected.length,
    sampleSize: selected.length,
    misses
  };
}

function buildFalseNewRate(rows) {
  const known = rows.filter((row) =>
    row.knownClaim && row.actualClaimRelation !== undefined
  );
  const falseNew = known.filter((row) => row.actualClaimRelation === "add").length;
  return {
    label: "False New Rate",
    value: known.length === 0 ? null : falseNew / known.length,
    sampleSize: known.length,
    falseNew
  };
}

function evaluateGate(metrics) {
  const gates = [
    ["Related Wiki Top1", metrics.relatedWikiTop1, 0.8],
    ["Related Wiki Top3", metrics.relatedWikiTop3, 0.9],
    ["Recommendation", metrics.recommendation, 0.8],
    ["Target Wiki", metrics.targetWiki, 0.8],
    ["Conflict Precision", metrics.conflictPrecision, 0.8],
    ["Claim Retrieval Top1", metrics.claimRetrievalTop1, 0.8],
    ["Claim Retrieval Top3", metrics.claimRetrievalTop3, 0.9],
    ["Relation Agreement", metrics.relationAgreement, 0.8],
    ["Bilingual Retrieval", metrics.bilingualRetrieval, 0.8],
    ["Acronym Retrieval", metrics.acronymRetrieval, 0.9],
    ["Conflict Retrieval", metrics.conflictRetrieval, 0.9]
    ,["Coverage Agreement", metrics.coverageAgreement, 0.8]
    ,["Comparison Relation", metrics.comparisonRelation, 0.85]
  ];
  const failures = gates
    .filter(([, metric, threshold]) => metric.value === null || metric.value < threshold)
    .map(([name, metric, threshold]) => `${name} ${formatPercent(metric.value)} < ${formatPercent(threshold)}`);
  if (metrics.falseNewRate.value === null || metrics.falseNewRate.value > 0.15) {
    failures.push(`False New Rate ${formatPercent(metrics.falseNewRate.value)} > 15.0%`);
  }
  if (
    metrics.falseAddRetrievalMiss.value === null ||
    metrics.falseAddRetrievalMissV1.value === null ||
    metrics.falseAddRetrievalMiss.value > metrics.falseAddRetrievalMissV1.value
  ) {
    failures.push("False ADD Retrieval Miss v2 must not exceed v1");
  }
  if (metrics.falseAddComparison.value === null || metrics.falseAddComparison.value > 0.1) {
    failures.push(`False ADD Comparison Error ${formatPercent(metrics.falseAddComparison.value)} > 10.0%`);
  }
  if (metrics.falseReinforce.value === null || metrics.falseReinforce.value > 0.1) {
    failures.push(`False REINFORCE Rate ${formatPercent(metrics.falseReinforce.value)} > 10.0%`);
  }
  if (metrics.freshnessRiskAgreement.value === null || metrics.freshnessRiskAgreement.value < 0.8) failures.push(`Risk Classification Agreement ${formatPercent(metrics.freshnessRiskAgreement.value)} < 80.0%`);
  if (metrics.freshnessHighRecall.value === null || metrics.freshnessHighRecall.value < 0.9) failures.push(`High-risk Recall ${formatPercent(metrics.freshnessHighRecall.value)} < 90.0%`);
  if (metrics.freshnessLowFalseAlarm.value === null || metrics.freshnessLowFalseAlarm.value > 0.15) failures.push(`Low-risk False Alarm ${formatPercent(metrics.freshnessLowFalseAlarm.value)} > 15.0%`);
  if (metrics.freshnessVerification.value === null || metrics.freshnessVerification.value < 0.8) failures.push(`Freshness Verification ${formatPercent(metrics.freshnessVerification.value)} < 80.0%`);
  if (metrics.unsafeReplace.value === null || metrics.unsafeReplace.value !== 0) failures.push(`Unsafe Replace Rate ${formatPercent(metrics.unsafeReplace.value)} must be 0.0%`);
  if (metrics.graphRelationAccuracy.value === null || metrics.graphRelationAccuracy.value < 0.8) failures.push(`Graph Relation Accuracy ${formatPercent(metrics.graphRelationAccuracy.value)} < 80.0%`);
  if (metrics.unsafeGraphMerge.value === null || metrics.unsafeGraphMerge.value !== 0) failures.push(`Unsafe Graph Merge ${formatPercent(metrics.unsafeGraphMerge.value)} must be 0.0%`);
  return { pass: failures.length === 0, failures };
}

async function readBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function compareBaseline(baseline, currentRows, currentMetrics) {
  if (baseline === null) return { summary: "baseline not found", regressions: [], metricDeltas: {} };
  const regressions = currentRows
    .filter((row) => baseline.caseResults?.[row.caseId] === true && !row.passed)
    .map((row) => row.caseId);
  const metricDeltas = {};
  for (const key of [
    "relatedWikiTop1", "relatedWikiTop3", "recommendation", "knowledgeGain",
    "conflictPrecision", "conflictRecall", "targetWiki", "prStructure", "verification",
    "claimRetrievalTop1", "claimRetrievalTop3", "relationAgreement", "falseNewRate",
    "bilingualRetrieval", "acronymRetrieval", "conflictRetrieval", "falseAddRetrievalMiss",
    "coverageAgreement", "comparisonRelation", "falseAddComparison", "falseReinforce",
    "freshnessRiskAgreement", "freshnessHighRecall", "freshnessLowFalseAlarm", "freshnessVerification", "unsafeReplace",
    "graphRelationAccuracy", "unsafeGraphMerge", "graphOrphanAccuracy"
  ]) {
    const previous = baseline.metrics?.[key]?.value;
    const current = currentMetrics[key]?.value;
    if (typeof previous === "number" && typeof current === "number") {
      metricDeltas[key] = current - previous;
    }
  }
  if (regressions.length > 0) process.exitCode = 1;
  return {
    summary: regressions.length === 0
      ? "no PASS-to-FAIL regressions"
      : `regressions: ${regressions.join(", ")}`,
    regressions,
    metricDeltas
  };
}

function sanitize(value) {
  const serialized = JSON.stringify(value);
  const sensitivePatterns = {
    openaiStyleSecret: /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/,
    tavilySecret: /(?:^|[^A-Za-z0-9])tvly-[A-Za-z0-9_-]{8,}/,
    apiKeyLabel: /api[_-]?key/i
  };
  for (const [label, pattern] of Object.entries(sensitivePatterns)) {
    if (pattern.test(serialized)) {
      throw new Error(`Sensitive value detected in regression report (${label}).`);
    }
  }
  return value;
}

function formatPercent(value) {
  return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function renderMarkdown(report) {
  const lines = [
    "# Knowledge Curator Regression Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    "",
    `- Total Cases: ${report.totalCases}`,
    `- Passed: ${report.passed}`,
    `- Failed: ${report.failed}`,
    "",
    "## Metrics",
    "",
    "| Metric | Result | Sample Size |",
    "|---|---:|---:|",
    ...Object.values(report.metrics).map((metric) =>
      `| ${metric.label} | ${formatPercent(metric.value)} | ${metric.sampleSize} |`
    ),
    "",
    `Release Gate: ${report.releaseGate.pass ? "PASS" : "FAIL"}`,
    `Baseline Comparison: ${report.baselineComparison.summary}`,
    "",
    "## Failed Cases",
    ""
  ];
  const failed = report.cases.filter((row) => !row.passed);
  if (failed.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Case | Failure Type | Reason |", "|---|---|---|");
    for (const row of failed) {
      lines.push(`| ${row.caseId} | ${row.failureType} | ${row.reason} |`);
    }
  }
  lines.push(
    "",
    "## Notes",
    "",
    "This release gate uses checked-in provider-output fixtures; Claim cases execute the production retrieval and comparison services. It is intentionally small and reports sample size, so it is not a statistically stable live-provider benchmark.",
    "Provider/error cases are included in total case health but excluded from unrelated quality denominators.",
    "No regression command accepts a Knowledge PR or writes to an Obsidian Vault.",
    ""
  );
  return lines.join("\n");
}
