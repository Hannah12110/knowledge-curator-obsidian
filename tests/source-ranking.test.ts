import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeUrl,
  classifySource,
  deduplicateSearchResults,
  rankSearchResults
} from "../src/services/source-ranking-service";

test("deduplicates canonical URL and domain plus normalized title", () => {
  const results = deduplicateSearchResults([
    {
      title: "Agent Memory Docs",
      url: "https://www.openai.com/docs/memory/?utm_source=test#section"
    },
    {
      title: "Agent Memory Docs",
      url: "https://openai.com/docs/memory"
    },
    {
      title: "  Agent   Memory Docs ",
      url: "https://openai.com/duplicate"
    }
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.url, "https://openai.com/docs/memory");
  assert.equal(
    canonicalizeUrl("https://example.com/a/?utm_campaign=x#y"),
    "https://example.com/a"
  );
});

test("Tier 0 official source ranks above multiple Tier 3 sources", () => {
  const ranked = rankSearchResults([
    {
      title: "Community opinion one",
      url: "https://medium.com/example/one",
      snippet: "agent memory taxonomy",
      providerScore: 1
    },
    {
      title: "Community opinion two",
      url: "https://dev.to/example/two",
      snippet: "agent memory taxonomy",
      providerScore: 0.99
    },
    {
      title: "Agent Memory Official Documentation",
      url: "https://openai.com/docs/agent-memory",
      snippet: "official agent memory taxonomy",
      providerScore: 0.4
    }
  ], ["agent memory taxonomy"]);

  assert.equal(ranked[0]?.url, "https://openai.com/docs/agent-memory");
  assert.equal(ranked[0]?.score.tier, 0);
  assert.equal(ranked[1]?.score.tier, 3);
});

test("classifies Claude Platform documentation as Tier 0 official evidence", () => {
  const classification = classifySource({
    title: "Context windows - Claude Platform Docs",
    url: "https://platform.claude.com/docs/en/build-with-claude/context-windows"
  });
  assert.equal(classification.tier, 0);
  assert.equal(classification.sourceType, "official");
  assert.equal(classification.primarySource, true);
});

test("GitHub domain alone is not classified as Tier 0", () => {
  const classification = classifySource({
    title: "Personal memory experiment",
    url: "https://github.com/random-user/memory-experiment"
  });
  assert.equal(classification.tier, 2);
  assert.equal(classification.primarySource, false);
});

test("unknown blog domains fall back to Tier 3 instead of Tier 2", () => {
  const classification = classifySource({
    title: "AI Agent Memory Architecture 2026 Full Guide",
    url: "https://unknown-memory-blog.example/agent-memory"
  });
  assert.equal(classification.tier, 3);
  assert.equal(classification.sourceType, "unknown");
  assert.equal(classification.primarySource, false);
});

test("recognized professional engineering domains remain Tier 2", () => {
  const classification = classifySource({
    title: "Long-Term Memory Architectures for AI Agents",
    url: "https://redis.io/blog/long-term-memory-architectures-ai-agents"
  });
  assert.equal(classification.tier, 2);
  assert.equal(classification.sourceType, "engineering");
  assert.equal(classification.primarySource, false);
});
