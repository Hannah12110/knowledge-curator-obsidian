import test from "node:test";
import assert from "node:assert/strict";
import { BatchWorkspaceState, BatchAnalysisQueue } from "../src/product/batch-analysis";
import type { InboxItem } from "../src/types/knowledge";
const items = ["pending", "pending", "analyzed", "failed"].map((status, index) => ({ path: `raw/${index}.md`, status, modified: 100, name: `${index}.md`, basename: String(index), size: 1 })) as InboxItem[];

test("active article and checked IDs are independent", () => {
  const state = new BatchWorkspaceState(); state.activeArticleId = "raw/0.md"; state.toggle("raw/1.md");
  assert.equal(state.activeArticleId, "raw/0.md"); assert.deepEqual([...state.selectedArticleIds], ["raw/1.md"]);
});
for (const [filter, count] of [["all", 4], ["pending", 2], ["analyzed", 1], ["failed", 1]] as const) test(`filter ${filter} uses existing article status`, () => {
  const state = new BatchWorkspaceState(); state.filter = filter; assert.equal(state.visible(items).length, count);
});
test("select all and deselect all act only on current filter, preserving hidden checks", () => {
  const state = new BatchWorkspaceState(); state.toggle("raw/2.md"); state.toggle("raw/0.md");
  assert.equal(state.selection(items).indeterminate, true); state.toggleAll(items);
  assert.equal(state.selection(items).all, true); assert.equal(state.selectedArticleIds.has("raw/2.md"), true);
  state.toggleAll(items); assert.deepEqual([...state.selectedArticleIds], ["raw/2.md"]);
});
test("CTA follows visible selection and never falls back to active article", () => {
  const state = new BatchWorkspaceState(); state.activeArticleId = "raw/3.md";
  assert.deepEqual(state.cta(items).ids, ["raw/0.md", "raw/1.md"]); assert.equal(state.cta(items).label, "分析全部未分析文章");
  state.toggle("raw/1.md"); assert.equal(state.cta(items).label, "分析所选 1 篇"); assert.deepEqual(state.targetIds(items), ["raw/1.md"]);
  state.filter = "failed"; assert.equal(state.cta(items).disabled, true); assert.equal(state.selection(items).hiddenCount, 1);
  state.filter = "pending"; assert.equal(state.selectedArticleIds.has("raw/1.md"), true);
});
test("no pending articles disables the default CTA", () => {
  const state = new BatchWorkspaceState(); assert.equal(state.cta(items.slice(2)).label, "暂无待分析文章"); assert.equal(state.cta(items.slice(2)).disabled, true);
});
test("one article batch completes and exposes consistent counts", async () => {
  const queue = new BatchAnalysisQueue(); const result = await queue.start(["a"], async () => undefined);
  assert.equal(result.status, "completed"); assert.equal(result.completed, 1); assert.equal(result.running, 0); assert.equal(result.pending, 0);
  assert.ok(result.tasks[0]!.startedAt && result.tasks[0]!.finishedAt && result.finishedAt);
});
test("multiple article batch is serial, deduplicated and continues after a failure", async () => {
  const queue = new BatchAnalysisQueue(); const calls: string[] = []; let active = 0, maximum = 0;
  const snapshots: any[] = []; queue.subscribe((job) => snapshots.push(job));
  const result = await queue.start(["a", "bad", "a", "c"], async (id, progress) => {
    active++; maximum = Math.max(maximum, active); calls.push(id); progress("检查已有知识"); await Promise.resolve(); active--;
    if (id === "bad") throw new Error("private provider body");
  });
  assert.deepEqual(calls, ["a", "bad", "c"]); assert.equal(maximum, 1); assert.equal(result.completed, 2); assert.equal(result.failed, 1);
  assert.doesNotMatch(JSON.stringify(result), /private provider body/u);
  for (const job of snapshots) assert.equal(job.completed + job.running + job.failed + job.pending + job.cancelled, job.total);
});
test("cancel finishes current article and cancels only later tasks", async () => {
  const queue = new BatchAnalysisQueue(); let release!: () => void; const calls: string[] = [];
  const pending = queue.start(["a", "b", "c"], async (id) => { calls.push(id); await new Promise<void>((resolve) => { release = resolve; }); });
  queue.cancel(); assert.equal(queue.snapshot()?.running, 1); assert.equal(queue.snapshot()?.cancelRequested, true);
  release(); const result = await pending; assert.deepEqual(calls, ["a"]); assert.equal(result.completed, 1); assert.equal(result.cancelled, 2); assert.equal(result.status, "cancelled");
});
test("queue freezes input IDs and rejects a concurrent batch", async () => {
  const queue = new BatchAnalysisQueue(), ids = ["a"]; let release!: () => void;
  const first = queue.start(ids, () => new Promise<void>((resolve) => { release = resolve; })); ids.push("b");
  await assert.rejects(queue.start(["c"], async () => undefined)); release(); assert.deepEqual((await first).articleIds, ["a"]);
});
test("queue disposal cancels pending work and never restores jobs automatically", async () => {
  const queue = new BatchAnalysisQueue(); let release!: () => void;
  const first = queue.start(["a", "b"], () => new Promise<void>((resolve) => { release = resolve; }));
  queue.dispose(); release(); assert.equal((await first).cancelled, 1);
  assert.equal(new BatchAnalysisQueue().snapshot(), null);
});
