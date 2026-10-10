import test from "node:test";
import assert from "node:assert/strict";
import {
  getStoredAnalysisCache,
  getStoredComparisonCache,
  getStoredKnowledgePRCache,
  getStoredVerificationCache,
  migrateSettings
} from "../src/services/settings-migration";

test("migrates the Phase 1 rawFolder without losing other settings", () => {
  const migrated = migrateSettings({
    inboxFolder: "custom-inbox",
    rawFolder: "custom-raw",
    wikiFolder: "custom-wiki",
    llmBaseUrl: "https://example.test/v1",
    llmApiKey: "secret",
    llmModel: "model"
  });
  assert.deepEqual(migrated.rawFolders, ["custom-raw"]);
  assert.equal(migrated.inboxFolder, "custom-inbox");
  assert.equal(migrated.wikiFolder, "custom-wiki");
  assert.equal(migrated.llmApiKey, "secret");
});

test("deduplicates the new rawFolders setting", () => {
  const migrated = migrateSettings({ rawFolders: ["raw-a", " raw-a ", "raw-b"] });
  assert.deepEqual(migrated.rawFolders, ["raw-a", "raw-b"]);
});

test("migrates Phase 4 search settings with safe bounds", () => {
  const migrated = migrateSettings({
    searchProvider: "unsupported",
    searchApiKey: "tvly-test",
    maxSearchResults: 99
  });
  assert.equal(migrated.searchProvider, "tavily");
  assert.equal(migrated.searchApiKey, "tvly-test");
  assert.equal(migrated.maxSearchResults, 10);
});

test("defaults to test mode and restores production preview explicitly", () => {
  assert.equal(migrateSettings({}).mode, "test");
  assert.equal(migrateSettings({ mode: "production-preview" }).mode, "production-preview");
  assert.equal(migrateSettings({ mode: "unsafe-production-write" }).mode, "test");
});

test("migrates Claim Mode settings with a safe Top K range", () => {
  assert.equal(migrateSettings({}).claimComparisonMode, "claim");
  assert.equal(migrateSettings({ claimComparisonMode: "legacy" }).claimComparisonMode, "legacy");
  assert.equal(migrateSettings({ claimComparisonMode: "unknown" }).claimComparisonMode, "claim");
  assert.equal(migrateSettings({ claimRetrievalTopK: 1 }).claimRetrievalTopK, 3);
  assert.equal(migrateSettings({ claimRetrievalTopK: 99 }).claimRetrievalTopK, 10);
});

test("missing or malformed stored caches migrate to empty objects", () => {
  assert.deepEqual(getStoredAnalysisCache({}), {});
  assert.deepEqual(getStoredKnowledgePRCache({ knowledgePRCache: [] }), {});
  assert.deepEqual(getStoredVerificationCache({ verificationCache: null }), {});
  assert.deepEqual(getStoredComparisonCache({ comparisonCache: [] }), {});
});
