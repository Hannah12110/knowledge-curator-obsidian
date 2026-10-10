import test from "node:test";
import assert from "node:assert/strict";
import { LlmService, LlmServiceError } from "../src/services/llm-service";
import type { KnowledgeCuratorSettings } from "../src/types/settings";
import type { RetrievalCandidate } from "../src/types/analysis";
import { VALID_ANALYSIS } from "./test-fixture";

const SETTINGS: KnowledgeCuratorSettings = {
  inboxFolder: "inbox",
  rawFolders: ["raw-a", "raw-b"],
  wikiFolder: "wiki",
  llmBaseUrl: "https://example.test/v1",
  llmApiKey: "test-secret",
  llmModel: "test-model",
  maxRelatedNotes: 8
};

const RELATED_CANDIDATE: RetrievalCandidate = {
  path: "wiki/Agent Memory 设计与评测.md",
  title: "Agent Memory 设计与评测",
  kind: "wiki",
  relevance: 0.9,
  reason: "related",
  content: "Agent Memory",
  truncated: false
};

test("retries once after invalid JSON and returns the validated result", async () => {
  let calls = 0;
  const service = new LlmService(() => SETTINGS, async () => {
    calls += 1;
    return {
      status: 200,
      json: {
        choices: [{ message: { content: calls === 1 ? "not json" : JSON.stringify(VALID_ANALYSIS) } }]
      }
    };
  });

  const result = await service.analyzeSource({
    sourcePath: "inbox/a.md",
    sourceTitle: "A",
    sourceContent: "source",
    relatedCandidates: [RELATED_CANDIDATE]
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, VALID_ANALYSIS);
});

test("retries once after empty content and sends DeepSeek-compatible JSON settings", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const service = new LlmService(
    () => ({ ...SETTINGS, llmBaseUrl: "https://api.deepseek.com" }),
    async (_url, _headers, body) => {
    requestBodies.push(JSON.parse(body) as Record<string, unknown>);
    return {
      status: 200,
      json: {
        choices: [{
          finish_reason: "stop",
          message: {
            content: requestBodies.length === 1 ? "   " : JSON.stringify(VALID_ANALYSIS)
          }
        }]
      }
    };
    }
  );

  const result = await service.analyzeSource({
    sourcePath: "inbox/a.md",
    sourceTitle: "A",
    sourceContent: "source",
    relatedCandidates: [RELATED_CANDIDATE]
  });

  assert.deepEqual(result, VALID_ANALYSIS);
  assert.equal(requestBodies.length, 2);
  assert.deepEqual(requestBodies[0]?.response_format, { type: "json_object" });
  assert.equal(requestBodies[0]?.max_tokens, 8_000);
  assert.equal(requestBodies[0]?.stream, false);
  assert.equal(requestBodies[0]?.temperature, 0.1);
  assert.deepEqual(requestBodies[0]?.thinking, { type: "disabled" });

  const initialMessages = requestBodies[0]?.messages as Array<{ content: string }>;
  assert.ok(initialMessages.some((message) => message.content.includes("只输出 JSON")));
  assert.ok(initialMessages.some((message) => message.content.includes("Valid JSON example")));

  const retryMessages = requestBodies[1]?.messages as Array<{ content: string }>;
  assert.ok(retryMessages.some((message) =>
    message.content.includes("上一次没有返回内容") &&
    message.content.includes("完整、合法、非空的 JSON 对象")
  ));
});

test("does not send the DeepSeek-only thinking option to other providers", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const service = new LlmService(() => SETTINGS, async (_url, _headers, body) => {
    requestBody = JSON.parse(body) as Record<string, unknown>;
    return {
      status: 200,
      json: {
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(VALID_ANALYSIS) } }]
      }
    };
  });

  await service.analyzeSource({
    sourcePath: "inbox/a.md",
    sourceTitle: "A",
    sourceContent: "source",
    relatedCandidates: [RELATED_CANDIDATE]
  });

  assert.ok(requestBody !== null);
  assert.equal(Object.hasOwn(requestBody, "thinking"), false);
});

test("reports a clear error when both responses contain empty content", async () => {
  let calls = 0;
  const service = new LlmService(() => SETTINGS, async () => {
    calls += 1;
    return {
      status: 200,
      json: {
        choices: [{
          finish_reason: "stop",
          message: { content: calls === 1 ? null : "\n\t" }
        }]
      }
    };
  });

  await assert.rejects(
    () => service.analyzeSource({
      sourcePath: "inbox/a.md",
      sourceTitle: "A",
      sourceContent: "source",
      relatedCandidates: []
    }),
    (error: unknown) => error instanceof LlmServiceError &&
      error.code === "empty_provider_response" &&
      error.userMessage === "模型返回了空内容，请稍后重试或更换模型。"
  );
  assert.equal(calls, 2);
});

test("reports truncation when the provider finish reason is length", async () => {
  let calls = 0;
  const service = new LlmService(() => SETTINGS, async () => {
    calls += 1;
    return {
      status: 200,
      json: {
        choices: [{ finish_reason: "length", message: { content: "{" } }]
      }
    };
  });

  await assert.rejects(
    () => service.analyzeSource({
      sourcePath: "inbox/a.md",
      sourceTitle: "A",
      sourceContent: "source",
      relatedCandidates: []
    }),
    (error: unknown) => error instanceof LlmServiceError &&
      error.code === "output_truncated" &&
      error.userMessage === "模型输出被截断，请提高输出长度限制后重试。"
  );
  assert.equal(calls, 1);
});

test("rejects basename-only duplicateWith identities", async () => {
  let calls = 0;
  const invalidAnalysis = {
    ...VALID_ANALYSIS,
    duplicateWith: ["Agent Memory 设计与评测.md"]
  };
  const service = new LlmService(() => SETTINGS, async () => {
    calls += 1;
    return {
      status: 200,
      json: {
        choices: [{
          finish_reason: "stop",
          message: { content: JSON.stringify(invalidAnalysis) }
        }]
      }
    };
  });

  await assert.rejects(
    () => service.analyzeSource({
      sourcePath: "inbox/a.md",
      sourceTitle: "A",
      sourceContent: "source",
      relatedCandidates: [RELATED_CANDIDATE]
    }),
    (error: unknown) => error instanceof LlmServiceError &&
      error.code === "invalid_response"
  );
  assert.equal(calls, 2);
});

test("maps 401 without exposing the API key", async () => {
  const service = new LlmService(() => SETTINGS, async () => ({ status: 401, json: {} }));
  await assert.rejects(
    () => service.analyzeSource({
      sourcePath: "inbox/a.md",
      sourceTitle: "A",
      sourceContent: "source",
      relatedCandidates: []
    }),
    (error: unknown) => error instanceof LlmServiceError &&
      error.userMessage === "API Key 无效或无权限。" &&
      !error.userMessage.includes(SETTINGS.llmApiKey)
  );
});

test("requires an API key before any network request", async () => {
  let called = false;
  const service = new LlmService(
    () => ({ ...SETTINGS, llmApiKey: "" }),
    async () => {
      called = true;
      return { status: 200, json: {} };
    }
  );
  await assert.rejects(
    () => service.analyzeSource({
      sourcePath: "inbox/a.md",
      sourceTitle: "A",
      sourceContent: "source",
      relatedCandidates: []
    }),
    (error: unknown) => error instanceof LlmServiceError && error.code === "missing_api_key"
  );
  assert.equal(called, false);
});
