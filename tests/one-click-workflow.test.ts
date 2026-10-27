import test from "node:test";
import assert from "node:assert/strict";
import { OneClickAnalysisOrchestrator, WORKFLOW_PROGRESS, type OneClickWorkflowPorts } from "../src/product/one-click-analysis-orchestrator";
import { DEFAULT_ANALYSIS_PREFERENCES } from "../src/types/settings";
import type { CachedSourceAnalysis } from "../src/types/analysis";
import type { KnowledgePR } from "../src/types/knowledge-pr";
import { VALID_ANALYSIS } from "./test-fixture";

function harness() {
  const calls: string[] = [];
  const entry = { analysis: structuredClone(VALID_ANALYSIS) } as CachedSourceAnalysis;
  const pr = { target: { path: "wiki/Test.md" }, changes: [{ sourceClaims: ["knowledge"] }] } as KnowledgePR;
  const ports: OneClickWorkflowPorts = {
    prepareIndex: async () => { calls.push("index"); }, analyze: async () => { calls.push("analyze"); return entry; },
    verifyConflicts: async () => { calls.push("verify"); return []; },
    assessFreshness: async () => { calls.push("freshness"); return { text: "本地判断", detail: "未做外部核验" }; },
    previousUpdate: async () => { calls.push("previous"); return null; },
    generateUpdate: async () => { calls.push("proposal"); return pr; },
    assertUnchanged: async () => { calls.push("guard"); },
    write: async () => { calls.push("write"); return { claimStoreUpdated: true }; },
    refreshIndex: async () => { calls.push("refresh"); }, buildRelations: async () => { calls.push("graph"); return { failedPairs: 0 }; },
    log: () => undefined
  };
  return { calls, entry, pr, ports, orchestrator: new OneClickAnalysisOrchestrator() };
}
const preferences = { ...DEFAULT_ANALYSIS_PREFERENCES };

test("one click orders existing capabilities, guards before writing, and refreshes relations after accepted write", async () => {
  const h = harness(), progress: string[] = [];
  const result = await h.orchestrator.run(h.ports, preferences, (message) => progress.push(message));
  assert.deepEqual(h.calls, ["index", "analyze", "freshness", "previous", "proposal", "guard", "write", "graph"]);
  assert.equal(result.wikiPath, "wiki/Test.md");
  assert.equal(result.updateMessage, "已更新 1 个知识点。");
  assert.deepEqual(new Set(progress), new Set(Object.values(WORKFLOW_PROGRESS)));
  assert.equal(h.orchestrator.isBusy(), false);
});

test("conflicts go through verification and unverified ones remain explicitly unverified", async () => {
  const h = harness();
  h.entry.analysis.conflicts = [{ newClaim: "new", existingClaim: "old" } as any];
  const result = await h.orchestrator.run(h.ports, preferences, () => undefined);
  assert.ok(h.calls.indexOf("verify") < h.calls.indexOf("proposal"));
  assert.match(result.warnings.join(), /尚未完成外部核验/u);
});

test("unchanged previously accepted source skips proposal and write but can recover index and graph", async () => {
  const h = harness(); h.ports.previousUpdate = async () => ({ ...h.pr, status: "accepted" });
  const result = await h.orchestrator.run(h.ports, preferences, () => undefined);
  assert.ok(!h.calls.includes("write") && !h.calls.includes("proposal"));
  assert.ok(h.calls.includes("refresh") && h.calls.includes("graph"));
  assert.match(result.updateMessage, /未重复写入/u);
});

test("graph failure after writing reports partial outcome and preserves accepted result", async () => {
  const h = harness(); h.ports.buildRelations = async () => { throw new Error("provider secret response"); };
  const result = await h.orchestrator.run(h.ports, preferences, () => undefined);
  assert.equal(result.wikiPath, "wiki/Test.md");
  assert.match(result.warnings.join(), /知识文档已保留/u);
  assert.doesNotMatch(JSON.stringify(result), /provider secret/u);
});

test("failed post-write index refresh remains visible and never repeats the write", async () => {
  const h = harness(); h.ports.previousUpdate = async () => ({ ...h.pr, status: "accepted" });
  h.ports.refreshIndex = async () => { throw new Error("index failure"); };
  const result = await h.orchestrator.run(h.ports, preferences, () => undefined);
  assert.match(result.warnings.join(), /知识索引更新失败/u);
  assert.equal(h.calls.includes("write"), false);
});

test("write success with reindex failure returns warning instead of claiming full completion", async () => {
  const h = harness(); h.ports.write = async () => ({ claimStoreUpdated: false });
  assert.match((await h.orchestrator.run(h.ports, preferences, () => undefined)).warnings.join(), /知识索引更新失败/u);
});

test("write failure stops graph work and releases workflow lock for retry", async () => {
  const h = harness(); h.ports.write = async () => { throw new Error("write failed"); };
  await assert.rejects(h.orchestrator.run(h.ports, preferences, () => undefined), /write failed/u);
  assert.equal(h.calls.includes("graph"), false); assert.equal(h.orchestrator.isBusy(), false);
});

test("configuration or source change blocks the write", async () => {
  const h = harness(); h.ports.assertUnchanged = async () => { throw new Error("changed"); };
  await assert.rejects(h.orchestrator.run(h.ports, preferences, () => undefined), /changed/u);
  assert.equal(h.calls.includes("write"), false);
});

test("concurrent analysis cannot start a second provider chain", async () => {
  const h = harness(); let release!: () => void;
  h.ports.prepareIndex = () => new Promise<void>((resolve) => { release = resolve; });
  const first = h.orchestrator.run(h.ports, preferences, () => undefined);
  await assert.rejects(h.orchestrator.run(h.ports, preferences, () => undefined), (error: any) => error.code === "busy");
  release(); await first;
  assert.equal(h.calls.filter((step) => step === "analyze").length, 1);
});

test("unloading before provider completes prevents later writes", async () => {
  const h = harness(); let release!: () => void;
  h.ports.prepareIndex = () => new Promise<void>((resolve) => { release = resolve; });
  const run = h.orchestrator.run(h.ports, preferences, () => undefined);
  h.orchestrator.dispose(); release();
  await assert.rejects(run, (error: any) => error.code === "cancelled");
  assert.equal(h.calls.includes("write"), false);
});

for (const setting of ["extractKnowledge", "updateWiki", "generateRelations", "freshness"] as const) test(`preference ${setting} disables its independent capability`, async () => {
  const h = harness(); await h.orchestrator.run(h.ports, { ...preferences, [setting]: false }, () => undefined);
  if (setting === "extractKnowledge") for (const step of ["index", "write", "graph"]) assert.equal(h.calls.includes(step), false, step);
  if (setting === "updateWiki") assert.equal(h.calls.includes("write"), false);
  if (setting === "generateRelations") assert.equal(h.calls.includes("graph"), false);
  if (setting === "freshness") assert.equal(h.calls.includes("freshness"), false);
});

test("all duplicate or rejected article never generates a Wiki proposal", async () => {
  const h = harness(); h.entry.analysis.recommendation = "reject"; h.entry.analysis.newClaims = [];
  const result = await h.orchestrator.run(h.ports, preferences, () => undefined);
  assert.equal(h.calls.includes("write"), false); assert.equal(result.wikiPath, undefined);
});
