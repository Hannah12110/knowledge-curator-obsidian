import test from "node:test";
import assert from "node:assert/strict";
import type { Vault } from "obsidian";
import type { ClaimRecord } from "../src/types/claim";
import type { ClaimGraphCandidatePair, ClaimGraphEdge, ClaimGraphStore } from "../src/types/claim-graph";
import {
  canonicalClaimPairKey,
  ClaimGraphCandidateService,
  CLAIM_GRAPH_MAX_TOTAL_PAIRS
} from "../src/services/claim-graph-candidate-service";
import {
  ClaimGraphRelationService
} from "../src/services/claim-graph-relation-service";
import {
  ClaimGraphValidationError,
  createEmptyClaimGraphStore,
  parseClaimGraphClassifications,
  validateClaimGraphStore
} from "../src/services/claim-graph-validator";
import { ClaimGraphRepository, CLAIM_GRAPH_STORE_PATH } from "../src/services/claim-graph-repository";
import { ClaimGraphService } from "../src/services/claim-graph-service";
import { KnowledgeCompressionService } from "../src/services/knowledge-compression-service";
import type { LlmService } from "../src/services/llm-service";

test("Step2 candidate: self pair is rejected", () => {
  assert.throws(() => canonicalClaimPairKey("a", "a"));
});

test("Step2 candidate: reverse duplicate pairs collapse to one canonical pair", async () => {
  const result = await new ClaimGraphCandidateService().generate([
    claim("a", "Long-term memory persists across sessions."),
    claim("b", "Long-term memory persists across sessions.")
  ]);
  assert.equal(result.pairs.length, 1);
});

test("Step2 candidate: canonical pair key is stable", () => {
  assert.equal(canonicalClaimPairKey("b", "a"), "a::b");
  assert.equal(canonicalClaimPairKey("a", "b"), "a::b");
});

test("Step2 candidate: max pair bound remains 500", async () => {
  const claims = Array.from({ length: 520 }, (_, index) => claim(`c${index}`, "Agent memory persists across sessions."));
  const result = await new ClaimGraphCandidateService().generate(claims);
  assert.ok(result.pairs.length <= CLAIM_GRAPH_MAX_TOTAL_PAIRS);
  assert.ok(result.metrics.rawScoredPairs < claims.length * (claims.length - 1) / 2);
});

test("Step2 candidate: real output is deterministic", async () => {
  const values = [claim("a", "RAG may improve grounding."), claim("b", "Retrieval augmented generation may improve grounding.")];
  const service = new ClaimGraphCandidateService();
  assert.deepEqual((await service.generate(values)).pairs, (await service.generate(values)).pairs);
});

test("Step2 validation: unknown Claim evidence ID is rejected", () => {
  assert.throws(() => parse(JSON.stringify(one("p", "supports", ["unknown"]))), ClaimGraphValidationError);
});

test("Step2 validation: invalid relation is rejected", () => {
  assert.throws(() => parse(JSON.stringify(one("p", "merge", ["a"]))), ClaimGraphValidationError);
});

test("Step2 validation: confidence outside 0..1 is rejected", () => {
  const payload = one("p", "supports", ["a"]); payload.relations[0]!.confidence = 2;
  assert.throws(() => parse(JSON.stringify(payload)), ClaimGraphValidationError);
});

test("Step2 validation: empty evidence is rejected", () => {
  assert.throws(() => parse(JSON.stringify(one("p", "supports", []))), ClaimGraphValidationError);
});

test("Step2 validation: pair outside Candidate Set is rejected", () => {
  assert.throws(() => parse(JSON.stringify(one("outside", "supports", ["a"]))), ClaimGraphValidationError);
});

test("Step2 validation: missing Candidate Pair is rejected", () => {
  assert.throws(() => parse(JSON.stringify({ relations: [] })), ClaimGraphValidationError);
});

test("Step2 validation: duplicate Candidate result is rejected", () => {
  const item = one("p", "supports", ["a"]).relations[0]!;
  assert.throws(() => parse(JSON.stringify({ relations: [item, item] })), ClaimGraphValidationError);
});

test("Step2 persistence: Graph save/load preserves the validated Store", async () => {
  const fixture = repositoryFixture();
  const store = graphStore("rev-a", [edge("e", "a", "b", "supports")]);
  await fixture.repository.save(store);
  const loaded = await fixture.repository.load();
  assert.deepEqual(loaded.store, validateClaimGraphStore(store));
});

test("Step2 persistence: relation stats must match persisted edges", () => {
  const store = graphStore("rev-a", [edge("e", "a", "b", "supports")]);
  store.metadata.relationStats.supports = 0;
  assert.throws(() => validateClaimGraphStore(store), ClaimGraphValidationError);
});

test("Step2 persistence: node and edge counts must match Store contents", () => {
  const store = graphStore("rev-a", [edge("e", "a", "b", "supports")]);
  store.metadata.nodeCount = 1;
  assert.throws(() => validateClaimGraphStore(store), ClaimGraphValidationError);
});

test("Step2 persistence: orphan metadata must match Graph degree", () => {
  const store = graphStore("rev-a", []);
  store.metadata.buildMetadata.orphanClaimIds = ["a"];
  assert.throws(() => validateClaimGraphStore(store), ClaimGraphValidationError);
});

test("Step2 stale: Claim addition marks a restored Graph stale", async () => {
  assert.equal(await statusAfterRevisionChange("rev-a", "rev-a|new-claim"), "stale");
});

test("Step2 stale: Claim fingerprint modification marks a restored Graph stale", async () => {
  assert.equal(await statusAfterRevisionChange("rev-a", "rev-b"), "stale");
});

test("Step2 stale: Claim deletion marks a restored Graph stale", async () => {
  assert.equal(await statusAfterRevisionChange("rev-a|rev-b", "rev-a"), "stale");
});

test("Step2 safety: Graph repository cannot write Markdown", async () => {
  const fixture = repositoryFixture();
  await fixture.repository.save(graphStore("rev-a", []));
  assert.deepEqual(fixture.writes, [CLAIM_GRAPH_STORE_PATH]);
  assert.equal(fixture.writes.some((path) => path.endsWith(".md")), false);
});

test("Step2 safety: contradicts creates only an Edge and never invokes Phase 4", async () => {
  let phase4Calls = 0;
  const service = relationService(() => one("p", "contradicts", ["a", "b"]));
  const result = await service.discover([pair("p")], claimMap());
  assert.equal(result.edges[0]?.relation, "contradicts");
  assert.equal(phase4Calls, 0);
});

test("Step2 safety: Compression preview is read-only", async () => {
  let writes = 0;
  const proposals = await new KnowledgeCompressionService().preview(
    [node("a"), node("b")], [edge("e", "a", "b", "duplicate")]
  );
  assert.equal(proposals.length, 1);
  assert.equal(writes, 0);
});

test("Step2 safety: unrelated classification is counted but not persisted as Edge", async () => {
  const result = await relationService(() => one("p", "none", [])).discover([pair("p")], claimMap());
  assert.equal(result.classifiedPairs, 1);
  assert.equal(result.metrics.unrelatedCount, 1);
  assert.equal(result.edges.length, 0);
});

test("Step2 recovery: schema-invalid batch is isolated and all Pairs recover", async () => {
  let calls = 0;
  const llm = { requestJsonObject: async (messages: Array<{ content: string }>) => {
    calls += 1;
    const content = messages.at(-1)?.content ?? "";
    if (content.includes("上一次")) return "{}";
    const ids = [...content.matchAll(/"pairId":"([^"]+)"/gu)].map((match) => match[1]!);
    if (ids.length > 1) return "{}";
    return JSON.stringify(one(ids[0]!, "supports", [ids[0] === "p1" ? "a" : "b"]));
  } } as unknown as LlmService;
  const pairs = [pair("p1"), { ...pair("p2"), leftClaimId: "b", rightClaimId: "c" }];
  const claims = new Map([["a", claim("a", "A")], ["b", claim("b", "B")], ["c", claim("c", "C")]]);
  const result = await new ClaimGraphRelationService(llm).discover(pairs, claims);
  assert.equal(result.failedPairs.length, 0);
  assert.equal(result.metrics.recoveredPairs, 2);
  assert.ok(result.metrics.schemaInvalidCount >= 2);
  assert.ok(calls >= 4);
});

test("Step2 recovery: unrecoverable single Pair remains explicit failure", async () => {
  const llm = { requestJsonObject: async () => "{}" } as unknown as LlmService;
  const result = await new ClaimGraphRelationService(llm).discover([pair("p")], claimMap());
  assert.deepEqual(result.failedPairs, ["p"]);
  assert.equal(result.classifiedPairs, 0);
});

function parse(text: string) {
  return parseClaimGraphClassifications(text, new Map([["p", { leftClaimId: "a", rightClaimId: "b" }]]));
}
function one(pairId: string, relation: string, evidenceClaimIds: string[]) {
  const direction = relation === "supports" || relation === "refines" || relation === "depends_on"
    ? "left_to_right" : "symmetric";
  return { relations: [{ pairId, relation, direction, confidence: 0.9, reasoning: "direct relation", evidenceClaimIds }] };
}
function claim(id: string, statement: string): ClaimRecord {
  return { id, statement, normalizedStatement: statement.toLowerCase(), type: "fact", status: "active", confidence: 0.9,
    provenance: [{ filePath: `Wiki/${id}.md`, fileHash: id.padEnd(64, "0").slice(0, 64), sourceKind: "wiki" }],
    createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z" };
}
function pair(pairId: string): ClaimGraphCandidatePair {
  return { pairId, leftClaimId: "a", rightClaimId: "b", score: 0.9, reasons: ["test"] };
}
function claimMap() { return new Map([["a", claim("a", "A")], ["b", claim("b", "B")]]); }
function relationService(output: () => object) {
  return new ClaimGraphRelationService({ requestJsonObject: async () => JSON.stringify(output()) } as unknown as LlmService);
}
function node(id: string) {
  return { claimId: id, statement: id.toUpperCase(), sourcePath: `Wiki/${id}.md`, createdAt: "2026-09-28T00:00:00.000Z", claimFingerprint: id.padEnd(64, "0").slice(0, 64), status: "active" as const };
}
function edge(id: string, fromClaimId: string, toClaimId: string, relation: ClaimGraphEdge["relation"]): ClaimGraphEdge {
  return { id, fromClaimId, toClaimId, relation, confidence: 0.9,
    evidence: [{ claimId: fromClaimId, statement: fromClaimId.toUpperCase(), sourcePath: `Wiki/${fromClaimId}.md`, reason: "test" }],
    retrievalScore: 0.9, retrievalReasons: ["test"], createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z" };
}
function graphStore(revision: string, edges: ClaimGraphEdge[]): ClaimGraphStore {
  const store = createEmptyClaimGraphStore(revision);
  store.metadata.claimStoreFingerprint = "f".repeat(64);
  store.nodes.a = node("a"); store.nodes.b = node("b");
  for (const item of edges) store.edges[item.id] = item;
  store.metadata.nodeCount = 2; store.metadata.edgeCount = edges.length;
  for (const item of edges) store.metadata.relationStats[item.relation] += 1;
  store.metadata.buildMetadata.claimCount = 2;
  store.metadata.buildMetadata.persistedEdges = edges.length;
  const connected = new Set(edges.flatMap((item) => [item.fromClaimId, item.toClaimId]));
  store.metadata.buildMetadata.orphanClaimIds = Object.keys(store.nodes).filter((id) => !connected.has(id)).sort();
  return store;
}
function repositoryFixture() {
  const files = new Map<string, string>(); const writes: string[] = [];
  const vault = { adapter: {
    exists: async (path: string) => files.has(path) || path === ".knowledge-agent/claim-graph",
    mkdir: async () => undefined,
    read: async (path: string) => files.get(path) ?? "",
    write: async (path: string, value: string) => { writes.push(path); files.set(path, value); }
  } } as unknown as Vault;
  return { repository: new ClaimGraphRepository(vault), writes };
}
async function statusAfterRevisionChange(before: string, after: string) {
  let revision = before;
  const service = new ClaimGraphService(
    { getRevision: () => revision, getClaims: () => [] } as never,
    { load: async () => ({ status: "ready", store: graphStore(before, []) }) } as never,
    {} as never, {} as never, {} as never, new KnowledgeCompressionService()
  );
  await service.initialize();
  assert.equal(service.getStats().status, "ready");
  revision = after;
  return service.getStats().status;
}
