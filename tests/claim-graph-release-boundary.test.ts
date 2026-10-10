import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLAIM_GRAPH_RELEASE_BOUNDARY,
  CLAIM_GRAPH_RELEASE_NOTICE,
  COMPRESSION_RELEASE_NOTICE
} from "../src/knowledge/claim-graph-release-boundary";

test("final release keeps Claim Graph human-in-the-loop", () => {
  assert.equal(CLAIM_GRAPH_RELEASE_BOUNDARY.capability, "AI_ASSISTED_RELATION_SUGGESTION");
  assert.equal(CLAIM_GRAPH_RELEASE_BOUNDARY.relationStatus, "SUGGESTED");
  assert.equal(CLAIM_GRAPH_RELEASE_BOUNDARY.humanReviewPolicy, "HUMAN_IN_THE_LOOP");
  assert.match(CLAIM_GRAPH_RELEASE_NOTICE, /模型建议/u);
  assert.match(CLAIM_GRAPH_RELEASE_NOTICE, /不是已验证事实/u);
});

test("final release blocks autonomous compression behind the quality gate", () => {
  assert.equal(CLAIM_GRAPH_RELEASE_BOUNDARY.autonomousCompression, "BLOCKED_BY_QUALITY_GATE");
  assert.match(COMPRESSION_RELEASE_NOTICE, /不会自动合并、删除或改写 Markdown/u);
});

test("Claim Graph UI does not load or render compression proposals", async () => {
  const source = await readFile("src/views/curator-view.ts", "utf8");
  assert.doesNotMatch(source, /this\.actions\.getCompressionProposals\(\)/u);
  assert.doesNotMatch(source, /知识压缩预览/u);
  assert.match(source, /AI 建议关系/u);
  assert.match(source, /COMPRESSION_RELEASE_NOTICE/u);
});
