import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { migrateSettings } from "../src/services/settings-migration";
import { validateClaimStore } from "../src/services/claim-validator";
import { validateClaimGraphStore } from "../src/services/claim-graph-validator";
import { AnalysisCacheService } from "../src/services/analysis-cache-service";
import { configuredWritableWikiRoot } from "../src/services/write-scope-guard";
import { DEFAULT_ANALYSIS_PREFERENCES } from "../src/types/settings";

async function fixture() { return JSON.parse(await readFile("tests/fixtures/v0.1.3-product-data.json", "utf8")); }

test("0.1.3 serialized Claim Store and nonempty Graph Store load with unchanged schemas and content", async () => {
  const data = await fixture();
  const claims = validateClaimStore(data.claimStore), graph = validateClaimGraphStore(data.graphStore);
  assert.equal(claims.schemaVersion, 1); assert.equal(graph.metadata.schemaVersion, 2);
  assert.deepEqual(claims, data.claimStore); assert.deepEqual(graph, data.graphStore);
  assert.equal(graph.nodes.claim_baseline?.statement, claims.claims.claim_baseline?.statement);
});

test("0.1.3 preview/legacy settings preserve configuration and boot into the normal Claim product flow", async () => {
  const data = await fixture(), settings = migrateSettings(data.settings);
  assert.equal(settings.mode, "normal"); assert.equal(settings.claimComparisonMode, "claim");
  for (const key of ["inboxFolder", "rawFolders", "wikiFolder", "llmBaseUrl", "llmApiKey", "llmModel"] as const) assert.deepEqual(settings[key], data.settings[key]);
  assert.deepEqual(settings.analysisPreferences, DEFAULT_ANALYSIS_PREFERENCES);
});

test("malformed old caches do not prevent settings or article cache initialization", () => {
  assert.doesNotThrow(() => new AnalysisCacheService({ "raw/broken.md": { schemaVersion: 6, analysis: {} } }, async () => undefined));
  assert.equal(migrateSettings({ mode: { invalid: true }, analysisPreferences: { quality: false, conflicts: "invalid" } }).mode, "normal");
  assert.equal(migrateSettings({ analysisPreferences: { quality: false } }).analysisPreferences.quality, false);
  assert.equal(migrateSettings({ analysisPreferences: { conflicts: "invalid" } }).analysisPreferences.conflicts, true);
});

test("configured Wiki root rejects overlap and unsafe settings before any write", () => {
  assert.equal(configuredWritableWikiRoot({ wikiFolder: "wiki", inboxFolder: "raw", rawFolders: ["raw"] }), "wiki");
  for (const root of ["", "/tmp/wiki", "../wiki", ".obsidian", "raw", "raw/wiki", "sources"]) {
    assert.throws(() => configuredWritableWikiRoot({ wikiFolder: root, inboxFolder: "raw", rawFolders: ["raw", "sources/notes"] }), /configuration|overlap/u, root);
  }
});
