import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ArticlePerformanceRecorder, observeTokens, performanceReport, renderPerformanceReport } from "../src/services/performance-metrics";
import { PerformanceRepository } from "../src/services/performance-repository";
import { LlmService } from "../src/services/llm-service";
import { DEFAULT_SETTINGS } from "../src/types/settings";

function record(kind: "real" | "synthetic" = "real", latency = 100) {
  let now = 0; const recorder = new ArticlePerformanceRecorder(() => now); recorder.begin("raw/Article.md", "Article", "example.test", "model", kind); recorder.source("测试 article");
  recorder.counts({ claimExtractionCount: 3, retrievalCandidateCount: 8, deduplicatedPairCount: 6, llmComparisonPairCount: 4, comparisonPairCount: 4, filteredPairCount: 2 });
  now = latency; return recorder.finish("completed");
}
function adapter() {
  const files = new Map<string, string>(), dirs = new Set<string>();
  return { files, value: { exists: async (path: string) => files.has(path) || dirs.has(path), mkdir: async (path: string) => { dirs.add(path); },
    write: async (path: string, content: string) => { files.set(path, content); }, read: async (path: string) => files.get(path)!,
    list: async (path: string) => ({ files: [...files.keys()].filter((file) => file.startsWith(path + "/") && !file.slice(path.length + 1).includes("/")), folders: [] }) } };
}
test("stage timer and total wall-clock are distinct and source count is a labelled estimate", async () => {
  let now = 0; const recorder = new ArticlePerformanceRecorder(() => now); recorder.begin("a", "A", "example.test", "model");
  assert.equal(record().articleCharCount, "测试 article".length); recorder.source("hello world");
  await recorder.measure("claimExtraction", () => { now += 10; }); await recorder.measure("claimComparison", () => { now += 100; });
  const result = recorder.finish("completed"); assert.equal(result.claimExtractionLatencyMs, 10); assert.equal(result.claimComparisonLatencyMs, 100); assert.equal(result.totalLatencyMs, 110);
  assert.match(result.tokenEstimator, /heuristic/u); assert.equal(result.estimatedCost, null);
});
test("actual usage is read from provider response without changing request behavior", async () => {
  const recorder = new ArticlePerformanceRecorder(); recorder.begin("a", "A", "example.test", "model");
  const llm = new LlmService(() => ({ ...DEFAULT_SETTINGS, llmBaseUrl: "https://example.test/v1", llmApiKey: "not-a-real-key", llmModel: "model" }), async () => ({ status: 200,
    json: { usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }, choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] } }), recorder.observe);
  await recorder.measure("claimComparison", () => llm.requestJsonObject([{ role: "user", content: "synthetic" }], 0));
  const result = recorder.finish("completed"); assert.equal(result.tokenUsageSource, "actual"); assert.equal(result.llmInputTokens, 11); assert.equal(result.llmOutputTokens, 7); assert.equal(result.totalTokens, 18);
  assert.equal(result.comparisonInputTokens, 11); assert.equal(result.requests[0]?.stage, "claimComparison");
});
test("missing usage is estimated, invalid usage is not accepted as actual, and no response is unavailable", () => {
  assert.equal(observeTokens(undefined, "hello world", "ok").tokenUsageSource, "estimated");
  assert.equal(observeTokens({ prompt_tokens: -10, completion_tokens: 4 }, "hello", "ok").tokenUsageSource, "estimated");
  const missing = observeTokens(undefined, "hello", null); assert.equal(missing.tokenUsageSource, "unavailable"); assert.equal(missing.outputTokens, null); assert.equal(missing.totalTokens, null);
});
test("failed request is observed without persisting raw provider errors", async () => {
  const recorder = new ArticlePerformanceRecorder(); recorder.begin("a", "A", "example.test", "model");
  const llm = new LlmService(() => ({ ...DEFAULT_SETTINGS, llmBaseUrl: "https://example.test", llmApiKey: "private-api-key", llmModel: "model" }), async () => { throw new Error("provider private body"); }, recorder.observe);
  await assert.rejects(llm.requestJsonObject([{ role: "user", content: "private source text" }], 0));
  const result = recorder.finish("failed", "network_error"); assert.equal(result.requests.length, 1); assert.equal(result.tokenUsageSource, "unavailable"); assert.equal(result.totalTokens, null);
  assert.doesNotMatch(JSON.stringify(result), /private-api-key|provider private body|private source text/u);
});
test("all retry requests count usage and mixed sources are labelled estimated", () => {
  const recorder = new ArticlePerformanceRecorder(); recorder.begin("a", "A", "example.test", "model");
  for (const source of ["actual", "estimated"] as const) recorder.observe({ latencyMs: 1, provider: "example.test", model: "model", inputTokens: 10, outputTokens: 2, totalTokens: 12, tokenUsageSource: source, success: true, retry: source === "actual" ? 0 : 1 });
  const result = recorder.finish("completed"); assert.equal(result.requests.length, 2); assert.equal(result.totalTokens, 24); assert.equal(result.tokenUsageSource, "estimated");
});
test("cost is null without valid matching developer configuration", () => {
  const recorder = new ArticlePerformanceRecorder(); recorder.begin("a", "A", "example.test", "model");
  recorder.observe({ latencyMs: 1, provider: "example.test", model: "model", inputTokens: 1_000_000, outputTokens: 500_000, totalTokens: 1_500_000, tokenUsageSource: "actual", success: true, retry: 0 });
  const result = recorder.finish("completed", undefined, { provider: "example.test", model: "model", inputPricePerMillion: 2, outputPricePerMillion: 4, currency: "fixture-unit" });
  assert.equal(result.estimatedCost, 4); assert.equal(result.currency, "fixture-unit");
  const other = new ArticlePerformanceRecorder(); other.begin("b", "B", "other.test", "model"); assert.equal(other.finish("completed", undefined, { provider: "example.test", model: "model", inputPricePerMillion: 2, outputPricePerMillion: 4, currency: "fixture-unit" }).estimatedCost, null);
});
test("aggregation separates synthetic data and returns null percentiles with zero real samples", () => {
  const empty = performanceReport([record("synthetic")]); assert.equal(empty.articles, 0); assert.equal(empty.p95TotalLatencyMs, null); assert.equal(empty.currentBottleneck, "INSUFFICIENT_DATA");
  const report = performanceReport([record("real", 10), record("real", 100)]); assert.equal(report.articles, 2); assert.equal(report.totalClaims, 6); assert.equal(report.totalCandidatePairs, 16); assert.equal(report.totalComparisonPairs, 8); assert.equal(report.p50TotalLatencyMs, 10); assert.equal(report.p95TotalLatencyMs, 100);
  assert.match(renderPerformanceReport(report), /Article \| Claims \| Candidate Pairs \| Compared Pairs/u); assert.match(renderPerformanceReport(report), /样本量较小/u);
});
test("performance persistence uses only developer paths, strips unexpected fields, and generates reports", async () => {
  const a = adapter(), repo = new PerformanceRepository(a.value); const value = record() as any;
  value.prompt = "private payload"; value.apiKey = "private-key"; value.requests.push({ latencyMs: 1, provider: "example.test", model: "model", inputTokens: 1, outputTokens: 1, totalTokens: 2, tokenUsageSource: "actual", success: true, retry: 0, stage: "claimComparison", responseBody: "private response" });
  await repo.save(value);
  assert.ok([...a.files.keys()].every((path) => path.startsWith("KnowledgeCuratorValidation/")));
  assert.ok(a.files.has("KnowledgeCuratorValidation/reports/claim-comparison-performance.json"));
  assert.doesNotMatch([...a.files.values()].join(), /private payload|private-key|private response/u);
  assert.equal((await repo.records()).length, 1);
});
test("metrics repository fails closed if developer paths overlap the configured Wiki", async () => {
  const a = adapter(), repo = new PerformanceRepository(a.value, () => "KnowledgeCuratorValidation");
  await assert.rejects(repo.save(record()), /overlap Wiki/u); assert.equal(a.files.size, 0);
});
test("private performance samples and reports are ignored by Git", () => {
  for (const path of ["KnowledgeCuratorValidation/performance/run-private.json", "KnowledgeCuratorValidation/reports/claim-comparison-performance.json", "KnowledgeCuratorValidation/reports/claim-comparison-performance.md"]) {
    assert.equal(execFileSync("git", ["check-ignore", "--no-index", path], { encoding: "utf8" }).trim(), path);
  }
});
