import test from "node:test";
import assert from "node:assert/strict";
import {
  SearchProviderError,
  TavilySearchProvider
} from "../src/services/search-provider";
import type { KnowledgeCuratorSettings } from "../src/types/settings";

const SETTINGS: KnowledgeCuratorSettings = {
  inboxFolder: "inbox",
  rawFolders: ["raw"],
  wikiFolder: "wiki",
  llmBaseUrl: "https://example.test/v1",
  llmApiKey: "llm-secret",
  llmModel: "test-model",
  maxRelatedNotes: 8,
  searchProvider: "tavily",
  searchApiKey: "tvly-secret",
  maxSearchResults: 5
};

test("Tavily search sends snippet-only request and parses results", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};
  const provider = new TavilySearchProvider(() => SETTINGS, async (url, headers, body) => {
    capturedUrl = url;
    capturedHeaders = headers;
    capturedBody = JSON.parse(body) as Record<string, unknown>;
    return {
      status: 200,
      json: {
        results: [{
          title: "Official Docs",
          url: "https://openai.com/docs/example",
          content: "Short result snippet",
          score: 0.9,
          published_date: "2026-01-02T00:00:00Z"
        }]
      }
    };
  });

  const results = await provider.search("agent memory official docs");
  assert.equal(capturedUrl, "https://api.tavily.com/search");
  assert.equal(capturedHeaders.Authorization, "Bearer tvly-secret");
  assert.equal(capturedBody.include_raw_content, false);
  assert.equal(capturedBody.include_answer, false);
  assert.equal(capturedBody.max_results, 5);
  assert.equal(results[0]?.title, "Official Docs");
  assert.equal(results[0]?.snippet, "Short result snippet");
  assert.equal(results[0]?.domain, "openai.com");
});

test("missing Search API key fails before transport", async () => {
  let called = false;
  const provider = new TavilySearchProvider(
    () => ({ ...SETTINGS, searchApiKey: "" }),
    async () => {
      called = true;
      return { status: 200, json: { results: [] } };
    }
  );
  await assert.rejects(
    provider.search("query"),
    (error: unknown) => error instanceof SearchProviderError &&
      error.code === "missing_search_api_key"
  );
  assert.equal(called, false);
});

for (const scenario of [
  { status: 401, code: "search_http_401", message: "API Key" },
  { status: 403, code: "search_http_403", message: "API Key" },
  { status: 429, code: "search_http_429", message: "过于频繁" },
  { status: 503, code: "search_http_503", message: "暂时不可用" }
]) {
  test(`maps Tavily HTTP ${scenario.status} to a safe Chinese error`, async () => {
    const provider = new TavilySearchProvider(
      () => SETTINGS,
      async () => ({ status: scenario.status, json: {} })
    );
    await assert.rejects(
      provider.search("query"),
      (error: unknown) => error instanceof SearchProviderError &&
        error.code === scenario.code &&
        error.userMessage.includes(scenario.message) &&
        !error.userMessage.includes(SETTINGS.searchApiKey)
    );
  });
}

test("reports timeout without waiting for the default timeout", async () => {
  const provider = new TavilySearchProvider(
    () => SETTINGS,
    async () => await new Promise(() => undefined),
    5
  );
  await assert.rejects(
    provider.search("query"),
    (error: unknown) => error instanceof SearchProviderError &&
      error.code === "search_timeout"
  );
});

test("empty and malformed search results fail safely", async () => {
  const emptyProvider = new TavilySearchProvider(
    () => SETTINGS,
    async () => ({ status: 200, json: { results: [] } })
  );
  await assert.rejects(
    emptyProvider.search("query"),
    (error: unknown) => error instanceof SearchProviderError &&
      error.code === "empty_search_results"
  );

  const malformedProvider = new TavilySearchProvider(
    () => SETTINGS,
    async () => ({ status: 200, json: { results: "invalid" } })
  );
  await assert.rejects(
    malformedProvider.search("query"),
    (error: unknown) => error instanceof SearchProviderError &&
      error.code === "malformed_search_results"
  );
});
