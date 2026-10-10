import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimRecord, ClaimType } from "../src/types/claim";
import { FreshnessRiskService } from "../src/services/freshness-risk-service";

const cases: Array<{ name: string; statement: string; type: ClaimType; expected: string[]; factors?: string[]; status?: ClaimRecord["status"] }> = [
  { name: "stable definition", statement: "RAG 是 Retrieval-Augmented Generation。", type: "definition", expected: ["low"], factors: ["stable_definition"] },
  { name: "model capability", statement: "GPT-5 当前上下文窗口支持 128K tokens。", type: "fact", expected: ["high", "critical"], factors: ["versioned_product", "quantitative", "current_state"] },
  { name: "API behavior", statement: "当前 API endpoint 支持 response_format 参数。", type: "fact", expected: ["high", "critical"], factors: ["api_behavior", "current_state"] },
  { name: "pricing", statement: "当前价格为 $2 / 1M tokens。", type: "quantitative", expected: ["critical"], factors: ["pricing"] },
  { name: "benchmark", statement: "Model A 当前在 Benchmark X 排名第一。", type: "quantitative", expected: ["critical"], factors: ["benchmark"] },
  { name: "current state", statement: "目前该产品已经开放访问。", type: "fact", expected: ["medium", "high"], factors: ["current_state"] },
  { name: "historical date", statement: "2024 年 GPT-4 上下文窗口为 128K tokens。", type: "quantitative", expected: ["medium", "high", "critical"], factors: ["historical_scope"] },
  { name: "version scoped", statement: "在 v1 版本中 API 不支持批量调用。", type: "fact", expected: ["medium", "high"], factors: ["historical_scope"] },
  { name: "quantitative", statement: "该评测成功率为 82%。", type: "quantitative", expected: ["high", "critical"], factors: ["quantitative"] },
  { name: "timeless method", statement: "错误分析应先定义可复现的分类标准。", type: "method", expected: ["low"] },
  { name: "previous conflict", statement: "Agent Memory 通常分为两类。", type: "fact", expected: ["medium", "high"], factors: ["previous_conflict"], status: "disputed" },
  { name: "unresolved", statement: "某方法可能是当前最佳实践。", type: "opinion", expected: ["high", "critical"], status: "active" },
  { name: "product availability", statement: "当前 Product X 已向所有用户开放。", type: "fact", expected: ["high", "critical"], factors: ["current_state"] },
  { name: "library behavior", statement: "SDK v2 当前支持异步批处理。", type: "fact", expected: ["high", "critical"], factors: ["api_behavior", "versioned_product"] },
  { name: "context window", statement: "Claude 4 当前 context window 为 200K。", type: "quantitative", expected: ["critical"], factors: ["quantitative", "current_state"] },
  { name: "latency", statement: "Model X API latency 为 350ms。", type: "quantitative", expected: ["high", "critical"], factors: ["quantitative"] },
  { name: "market state", statement: "目前企业 Agent 市场增长最快。", type: "predictive", expected: ["high", "critical"], factors: ["current_state"] },
  { name: "taxonomy", statement: "情景记忆与语义记忆描述内容类型维度。", type: "definition", expected: ["low"] },
  { name: "old stable", statement: "上下文用于描述模型当前可见的信息。", type: "definition", expected: ["low", "medium"] },
  { name: "new volatile", statement: "最新 GPT-5 API 当前支持 Feature X。", type: "fact", expected: ["critical"], factors: ["current_state", "api_behavior"] }
];

for (const item of cases) {
  test(`freshness risk: ${item.name}`, async () => {
    const service = new FreshnessRiskService();
    const record = await service.assess({
      claim: claim(item.statement, item.type, item.status),
      sourceModified: Date.UTC(2024, 0, 1),
      previousResolution: item.name === "unresolved" ? "disputed" : undefined,
      now: new Date("2026-09-27T00:00:00.000Z")
    });
    assert.ok(item.expected.includes(record.freshnessRisk), `${item.name}: ${record.freshnessRisk}`);
    for (const factor of item.factors ?? []) assert.ok(record.riskFactors.some((entry) => entry.type === factor), `${item.name} missing ${factor}`);
  });
}

test("freshness risk is deterministic and ignores age for stable definitions", async () => {
  const service = new FreshnessRiskService();
  const input = { claim: claim("RAG 是 Retrieval-Augmented Generation。", "definition"), sourceModified: Date.UTC(2020, 0, 1), now: new Date("2026-09-27T00:00:00.000Z") };
  assert.deepEqual(await service.assess(input), await service.assess(input));
  assert.equal((await service.assess(input)).freshnessRisk, "low");
});

function claim(statement: string, type: ClaimType, status: ClaimRecord["status"] = "active"): ClaimRecord {
  return {
    id: `claim_${statement.length}_${type}`,
    statement,
    normalizedStatement: statement.toLowerCase(),
    type,
    status,
    confidence: 0.9,
    provenance: [{ filePath: "KnowledgeCuratorPhase1Test/wiki/Test.md", fileHash: "a".repeat(64), sourceKind: "wiki", accepted: true }],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z"
  };
}
