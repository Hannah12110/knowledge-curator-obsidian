import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ARTICLE_STATUS_LABELS, EMPTY_STATES, RELATION_LABELS, mapKnowledgePoints, selectAnalysisTarget, userWorkflowError, articleRelations } from "../src/product/workflow-presenter";
import { VALID_ANALYSIS } from "./test-fixture";

test("active article wins over sidebar selection; non-article or non-Markdown falls back", () => {
  const scope = (path: string) => path.startsWith("raw/");
  assert.equal(selectAnalysisTarget({ path: "raw/active.md", extension: "md" }, "raw/selected.md", scope), "raw/active.md");
  assert.equal(selectAnalysisTarget({ path: "wiki/file.md", extension: "md" }, "raw/selected.md", scope), "raw/selected.md");
  assert.equal(selectAnalysisTarget({ path: "raw/file.pdf", extension: "pdf" }, "raw/selected.md", scope), "raw/selected.md");
  assert.equal(selectAnalysisTarget(null, null, scope), null);
  assert.equal(selectAnalysisTarget(null, "wiki/file.md", scope), null);
});

test("only four user statuses and all five natural language relation labels exist", () => {
  assert.deepEqual(Object.values(ARTICLE_STATUS_LABELS), ["待分析", "分析中", "已分析", "分析失败"]);
  assert.deepEqual(RELATION_LABELS, { supports: "支持 / 补充", refines: "细化", contradicts: "冲突", depends_on: "依赖", duplicate: "重复" });
  assert.deepEqual(Object.values(EMPTY_STATES), ["待处理目录里还没有文章", "暂未提取到可维护的知识点", "暂未发现知识关联"]);
});

test("knowledge point mapping uses real statement/source only and invents no Wiki or timestamps", () => {
  const points = mapKnowledgePoints(VALID_ANALYSIS, "raw/Test.md", [], "wiki/proposed.md");
  assert.equal(points[0]?.text, VALID_ANALYSIS.newClaims[0]?.statement);
  assert.equal(points[0]?.sourcePath, "raw/Test.md");
  assert.deepEqual(points[0]?.wikiPaths, []); assert.equal(points[0]?.updatedAt, undefined);
});

test("provider raw messages and userMessage are never directly exposed as workflow errors", () => {
  assert.equal(userWorkflowError({ code: "missing_configuration", userMessage: '{"api_key":"secret"}' }), "请先在设置中填写 AI 服务地址、API Key 和模型。");
  assert.doesNotMatch(userWorkflowError(new Error("InternalException secret stack trace")), /secret|stack|InternalException/u);
});

test("stale graphs do not appear as current article relations", () => {
  assert.deepEqual(articleRelations({ graph: { stats: { status: "stale" } } } as any), []);
});

test("ordinary views and settings no longer render engineering modes or architecture statistics", async () => {
  const source = await readFile("src/views/curator-view.ts", "utf8");
  const settings = await readFile("src/settings.ts", "utf8");
  for (const forbidden of ["MVP COMPLETE", "Claim Store", "Claim Mode", "Legacy Document Mode", "Test Mode", "Production Preview", "当前模式", "正式知识库预览", "Top K", "Claim Graph"]) {
    assert.equal(source.includes(forbidden), false, forbidden); assert.equal(settings.includes(forbidden), false, forbidden);
  }
  assert.equal((source.match(/mod-cta/gu) ?? []).length, 1);
  assert.deepEqual([...settings.matchAll(/setName\("([^"]+)"\)\.setHeading\(\)/gu)].map((match) => match[1]), ["知识范围", "AI 服务", "分析偏好", "知识维护"]);
});

test("community scanner safety and stable versions are preserved", async () => {
  const main = await readFile("src/main.ts", "utf8"), settings = await readFile("src/settings.ts", "utf8");
  assert.doesNotMatch(main.slice(main.indexOf("  onunload()"), main.indexOf("  async loadSettings")), /detachLeavesOfType/u);
  assert.doesNotMatch(settings, /createEl\("h[1-6]"/u);
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  assert.equal(manifest.version, "0.1.3"); assert.doesNotMatch(manifest.description, /Obsidian/iu);
  assert.equal(JSON.parse(await readFile("package.json", "utf8")).version, "0.1.3");
});
