import test from "node:test";
import assert from "node:assert/strict";
import { groupGlobalGraph, globalNodeDetails, GLOBAL_RELATION_LABELS, MindMapViewport, changeLogEntry } from "../src/product/global-workspace";
import { HistoryService } from "../src/services/history-service";
import { KnowledgeCuratorView } from "../src/views/curator-view";
import { knowledgeDifferences } from "../src/product/workflow-presenter";
import { UiNode } from "./obsidian-ui-stub";
import { VALID_ANALYSIS } from "./test-fixture";

const graph = { stats: { status: "ready" }, nodes: [
  { claimId: "a", statement: "第一组知识", sourcePath: "wiki/A.md", topic: "已有主题", createdAt: "2026-10-01T00:00:00Z", status: "active" },
  { claimId: "b", statement: "另一篇文章的知识", sourcePath: "wiki/B.md", createdAt: "2026-10-01T00:00:00Z", status: "active" }
], edges: [{ id: "edge", fromClaimId: "a", toClaimId: "b", relation: "supports" }] } as any;
const history = { prId: "pr-1", sourcePath: "raw/Article.md", targetPath: "wiki/A.md", decidedAt: "2026-10-27T00:00:00Z", createdAt: "2026-10-26T00:00:00Z", decision: "accepted", operation: "update",
  changes: [{ id: "c1", type: "add", before: "before snippet", after: "after snippet", reason: "real reason", sourceClaims: ["knowledge"], confidence: .9 }] } as any;
function viewHarness(snapshot = graph) {
  const view = new KnowledgeCuratorView({} as any, { onRefresh() {}, onSelectArticle(path) { view.selectArticle(path); }, onAnalyze() {}, onOpenFile() {}, onOpenSettings() {},
    getGlobalGraph: () => snapshot, getClaims: () => [], getHistory: async () => ({ entries: [changeLogEntry(history)], unreadable: 0 }) });
  return { view, root: view.contentEl as unknown as UiNode };
}

test("global graph groups all stored nodes using existing topic or Wiki filename, independent of active article", () => {
  const groups = groupGlobalGraph(graph); assert.equal(groups.length, 2); assert.deepEqual(new Set(groups.map((group) => group.title)), new Set(["已有主题", "B"]));
  const h = viewHarness(); h.view.workspaceState.activeArticleId = "raw/OnlyA.md"; h.view.showGlobalGraph();
  assert.match(h.root.textContent, /另一篇文章的知识/u); assert.match(h.root.textContent, /2 个知识点/u);
});
test("relation enums map to user labels without changing enums", () => {
  assert.deepEqual(GLOBAL_RELATION_LABELS, { supports: "补充", refines: "细化", contradicts: "冲突", depends_on: "依赖", duplicate: "重复" });
  assert.equal(graph.edges[0].relation, "supports");
});
test("global node details use only real metadata and include global incoming relationships", () => {
  const detail = globalNodeDetails(graph, "b", [])!; assert.equal(detail.wikiPath, "wiki/B.md"); assert.equal(detail.updatedAt, undefined); assert.deepEqual(detail.sourceArticles, []);
  assert.equal(detail.relations[0]?.label, "补充"); assert.equal(detail.relations[0]?.direction, "←");
});
test("empty global graph is friendly and does not expose internal store states", () => {
  const h = viewHarness({ stats: { status: "not_built" }, nodes: [], edges: [] }); h.view.showGlobalGraph();
  assert.match(h.root.textContent, /暂未发现知识关联/u); assert.doesNotMatch(h.root.textContent, /Claim Graph|Classifier|not_built/u);
});
test("viewport pan, zoom and reset have finite bounded values", () => {
  const viewport = new MindMapViewport(); viewport.pan(30, -12); viewport.zoom(2); assert.equal(viewport.transform(), "translate(30px, -12px) scale(2)");
  viewport.zoom(100); assert.equal(viewport.scale, 2.5); viewport.zoom(.001); assert.equal(viewport.scale, .4); viewport.pan(NaN, 1); assert.equal(viewport.x, 30);
  viewport.reset(); assert.equal(viewport.transform(), "translate(0px, 0px) scale(1)");
});
test("real global view supports pan/zoom events, expansion and clickable node details", () => {
  const h = viewHarness(); h.view.showGlobalGraph();
  const viewport = h.root.all().find((node) => node.classes.has("kc-global-viewport"))!, canvas = h.root.all().find((node) => node.classes.has("kc-global-canvas"))!;
  viewport.dispatch("pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 1 }); viewport.dispatch("pointermove", { clientX: 35, clientY: 20 }); viewport.dispatch("pointerup");
  assert.match(canvas.style.transform!, /translate\(25px, 10px\)/u); viewport.dispatch("wheel", { deltaY: -100 }); assert.doesNotMatch(canvas.style.transform!, /scale\(1\)$/u);
  const group = h.root.all().find((node) => node.classes.has("kc-global-group"))!; group.open = true; group.dispatch("toggle");
  h.root.all().find((node) => node.classes.has("kc-global-node"))!.dispatch("click");
  assert.match(h.root.textContent, /知识点详情/u); assert.match(h.root.textContent, /来源 Wiki/u);
  assert.equal(h.root.all().find((node) => node.classes.has("kc-global-group"))!.open, true);
});
test("old history missing optional comparison fields stays readable and does not invent skipped counts", () => {
  const entry = changeLogEntry(history); assert.equal(entry.addedCount, 1); assert.equal(entry.duplicateSkippedCount, undefined); assert.equal(entry.refinedCount, 0); assert.equal(entry.titleSource, "filename");
});
test("history reader isolates corrupt records and leaves files unchanged", async () => {
  const values: Record<string, string> = { ".knowledge-agent/history/good.json": JSON.stringify(history), ".knowledge-agent/history/bad.json": "{broken" };
  let writes = 0;
  const service = new HistoryService({ list: async () => Object.keys(values), readJson: async (path: string) => JSON.parse(values[path]!), createJson: async () => { writes++; } } as any);
  const result = await service.listRecords(); assert.equal(result.records.length, 1); assert.equal(result.unreadable, 1); assert.equal(writes, 0);
});
test("history list opens real before/after detail without a nonfunctional Undo button", async () => {
  const h = viewHarness(); h.view.showHistoryPage(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(h.root.textContent, /新增知识 1/u);
  h.root.all().find((node) => node.classes.has("kc-history-card"))!.dispatch("click");
  assert.match(h.root.textContent, /变更前.*before snippet.*变更后.*after snippet.*real reason/u); assert.doesNotMatch(h.root.textContent, /撤销本次更新/u);
});
test("new and refined knowledge comes from existing comparison data; pure reinforcement remains excluded", () => {
  const analysis = { ...VALID_ANALYSIS, claimAnalysis: { candidateClaims: [], coverage: 0, comparisons: [
    { candidateStatement: "新增", relation: "add" }, { candidateStatement: "补充", relation: "refine", coverage: { uncoveredAspects: ["适用条件"] } },
    { candidateStatement: "重复", relation: "reinforce", coverage: { uncoveredAspects: [] } },
    { candidateStatement: "旧记录中有未覆盖部分", relation: "reinforce", coverage: { uncoveredAspects: ["已有未覆盖证据"] } }
  ] } } as any;
  const differences = knowledgeDifferences(analysis); assert.equal(differences.length, 3); assert.equal(differences.some((item) => item.text === "重复"), false);
  assert.equal(differences[1]?.kind, "补充知识"); assert.equal(differences[1]?.detail, "适用条件");
});
