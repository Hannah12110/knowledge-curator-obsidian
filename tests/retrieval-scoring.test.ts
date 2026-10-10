import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRetrievalSignals,
  scoreKnowledgeCandidate
} from "../src/services/retrieval-service";

test("Memory source favors the Agent Memory wiki over an evaluation wiki", () => {
  const source = buildRetrievalSignals(
    "AI产品经理必须搞懂的AgentMemory应该怎么设计",
    "# Agent Memory\n长期记忆、短期记忆和记忆写入策略。"
  );
  const memory = scoreKnowledgeCandidate(
    source,
    buildRetrievalSignals("Agent Memory 设计与评测", "# 记忆架构\nAgent Memory 写入与评测。"),
    "wiki"
  );
  const evaluation = scoreKnowledgeCandidate(
    source,
    buildRetrievalSignals("Agent评测系统", "# Benchmark\n评测 Agent 工具调用。"),
    "wiki"
  );
  assert.ok(memory.relevance > evaluation.relevance);
});

test("evaluation source favors evaluation knowledge over memory knowledge", () => {
  const source = buildRetrievalSignals(
    "Agent 的评测工程化",
    "# Agent Benchmark\n评测系统、测试集和 grader。"
  );
  const benchmark = scoreKnowledgeCandidate(
    source,
    buildRetrievalSignals("Benchmark-Design", "# Agent 评测系统\n测试集与 grader。"),
    "wiki"
  );
  const memory = scoreKnowledgeCandidate(
    source,
    buildRetrievalSignals("Agent Memory 设计与评测", "# 长期记忆\n记忆写入。"),
    "wiki"
  );
  assert.ok(benchmark.relevance > memory.relevance);
});

test("wiki receives a small priority boost over equivalent raw content", () => {
  const source = buildRetrievalSignals("Harness Engineering", "Agent harness context tools");
  const candidate = buildRetrievalSignals("Harness-Engineering", "Agent harness context tools");
  const wiki = scoreKnowledgeCandidate(source, candidate, "wiki");
  const raw = scoreKnowledgeCandidate(source, candidate, "raw");
  assert.ok(wiki.relevance > raw.relevance);
});
