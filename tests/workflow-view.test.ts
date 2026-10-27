import test from "node:test";
import assert from "node:assert/strict";
import { KnowledgeCuratorView } from "../src/views/curator-view";
import { UiNode } from "./obsidian-ui-stub";
import type { WorkspaceLeaf } from "obsidian";
import { DEFAULT_ANALYSIS_PREFERENCES } from "../src/types/settings";
import { VALID_ANALYSIS } from "./test-fixture";

function harness() {
  const selected: string[] = [], opened: string[] = [];
  let analyzes = 0;
  const view = new KnowledgeCuratorView({} as WorkspaceLeaf, {
    onRefresh: () => undefined, onSelectArticle: (path) => { selected.push(path); view.selectArticle(path); },
    onAnalyze: () => { analyzes++; }, onOpenFile: (path) => { opened.push(path); }, onOpenSettings: () => undefined
  });
  const root = view.contentEl as unknown as UiNode;
  view.showInbox({ state: "ready", configuredPath: "raw", items: [{ path: "raw/Article.md", name: "Article.md", basename: "Article", status: "pending", modified: 100, size: 100 }] });
  return { view, root, selected, opened, analyzes: () => analyzes };
}
function result() {
  return { sourcePath: "raw/Article.md", title: "Article", analysis: VALID_ANALYSIS, preferences: { ...DEFAULT_ANALYSIS_PREFERENCES },
    points: [{ key: "internal-id-secret", text: "按任务评测记忆", sourcePath: "raw/Article.md", wikiPaths: ["wiki/Memory.md"] }],
    verifications: [], freshness: { text: "未发现明显风险", detail: "本地判断，未外部核验" }, graph: { stats: { status: "ready" }, nodes: [], edges: [] },
    updateMessage: "已更新 1 个知识点。", warnings: [] } as any;
}

test("article card click selects the article through the real view action without nested action buttons", () => {
  const h = harness(); const card = h.root.all().find((node) => node.classes.has("kc-article"))!;
  assert.equal(card.children.some((node) => node.tag === "button"), false);
  card.dispatch("click"); assert.deepEqual(h.selected, ["raw/Article.md"]); assert.equal(h.view.getSelectedArticle(), "raw/Article.md");
  assert.equal(h.root.all().filter((node) => node.classes.has("mod-cta")).length, 1);
});

test("single CTA runs analysis and cards are disabled while a workflow is busy", () => {
  const h = harness(); h.root.all().find((node) => node.classes.has("kc-primary"))!.dispatch("click");
  assert.equal(h.analyzes(), 1);
  h.view.showProgress("正在分析文章…");
  const card = h.root.all().find((node) => node.classes.has("kc-article"))!;
  card.dispatch("click"); assert.equal(h.selected.length, 0); assert.equal(card.disabled, true);
  assert.equal(h.root.attributes["aria-busy"], "true");
});

test("tabs display knowledge point details and real source links without internal identifiers", () => {
  const h = harness(); h.view.showResult(result());
  h.root.all().find((node) => node.attributes.id === "kc-tab-points")!.dispatch("click");
  assert.match(h.root.textContent, /知识点（1）/u); assert.match(h.root.textContent, /来源文章/u);
  assert.doesNotMatch(h.root.textContent, /internal-id-secret|Claim Store|Claim Mode|confidence/u);
  h.root.all().find((node) => node.ownText === "来源文章")!.dispatch("click");
  assert.deepEqual(h.opened, ["raw/Article.md"]);
});

test("tab arrow keys move focus and relation empty state stays user-friendly", () => {
  const h = harness(); h.view.showResult(result());
  h.root.all().find((node) => node.attributes.id === "kc-tab-analysis")!.dispatch("keydown", { key: "End", preventDefault() {} });
  assert.match(h.root.textContent, /知识关系思维导图/u); assert.match(h.root.textContent, /暂未发现知识关联/u);
  assert.equal(h.root.all().find((node) => node.attributes.id === "kc-tab-relations")!.focused, true);
});

test("error state offers retry through the same sole primary action", () => {
  const h = harness(); h.view.showError("请检查 AI 服务配置。", true);
  assert.match(h.root.textContent, /分析失败/u);
  const buttons = h.root.all().filter((node) => node.classes.has("mod-cta"));
  assert.equal(buttons.length, 1); assert.equal(buttons[0]!.ownText, "重新分析");
});
