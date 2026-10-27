import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { KnowledgeCuratorView } from "../src/views/curator-view";
import { UiNode } from "./obsidian-ui-stub";
function harness() {
  const selected: string[] = [], runs: string[][] = [];
  const view = new KnowledgeCuratorView({} as any, { onRefresh() {}, onSelectArticle(path) { selected.push(path); view.selectArticle(path); }, onAnalyze(ids) { runs.push(ids); }, onOpenFile() {}, onOpenSettings() {} });
  view.showInbox({ state: "ready", configuredPath: "raw", items: ["pending", "pending", "analyzed"].map((status, i) => ({ path: `raw/${i}.md`, name: `${i}.md`, basename: `${i}`, modified: 100, size: 10, status })) as any });
  return { view, root: view.contentEl as unknown as UiNode, selected, runs };
}
test("checkbox selection does not open detail and keeps active article independent", () => {
  const h = harness(); h.view.workspaceState.activeArticleId = "raw/0.md"; h.view.showInbox({ state: "ready", configuredPath: "raw", items: [{ path: "raw/0.md", basename: "0", name: "0.md", status: "pending", size: 1, modified: 100 }, { path: "raw/1.md", basename: "1", name: "1.md", status: "pending", size: 1, modified: 100 }] });
  h.root.all().find((node) => node.attributes["aria-label"] === "选择文章：1")!.dispatch("click");
  h.root.all().find((node) => node.attributes["aria-label"] === "选择文章：1")!.dispatch("change");
  assert.equal(h.selected.length, 0); assert.equal(h.view.workspaceState.activeArticleId, "raw/0.md"); assert.deepEqual([...h.view.workspaceState.selectedArticleIds], ["raw/1.md"]);
  assert.equal(h.root.all().filter((node) => node.classes.has("is-active-article")).length, 1); assert.equal(h.root.all().filter((node) => node.classes.has("is-checked")).length, 1);
});
test("select all marks indeterminate first then checked and CTA targets only current pending result", () => {
  const h = harness(); h.root.all().find((node) => node.attributes["aria-label"] === "选择文章：0")!.dispatch("change");
  assert.equal(h.root.all().find((node) => node.attributes["aria-label"] === "全选当前筛选结果")!.indeterminate, true);
  h.root.all().find((node) => node.attributes["aria-label"] === "全选当前筛选结果")!.dispatch("change");
  assert.equal(h.root.all().find((node) => node.attributes["aria-label"] === "全选当前筛选结果")!.checked, true);
  h.root.all().find((node) => node.classes.has("kc-primary"))!.dispatch("click"); assert.deepEqual(h.runs, [["raw/0.md", "raw/1.md"]]);
});
test("card opens secondary page with no list append or relation tab and back preserves selection", () => {
  const h = harness(); h.view.workspaceState.toggle("raw/1.md"); h.root.all().find((node) => node.classes.has("kc-article"))!.dispatch("click");
  assert.match(h.root.textContent, /返回文章列表/u); assert.equal(h.root.all().some((node) => node.classes.has("kc-batch-articles")), false);
  assert.equal(h.root.all().some((node) => node.attributes.id === "kc-tab-relations"), false);
  h.root.all().find((node) => node.ownText === "← 返回文章列表")!.dispatch("click"); assert.equal(h.view.workspaceState.selectedArticleIds.has("raw/1.md"), true);
});
test("gray active row and purple checked state have separate CSS rules", async () => {
  const css = await readFile("styles.css", "utf8"); assert.match(css, /\.kc-batch-row\.is-active-article/u); assert.match(css, /\.kc-batch-row\.is-checked/u);
  assert.match(css, /background: #e7e7e9/u); assert.match(css, /border-left: 3px solid #8b5cf6/u);
});
