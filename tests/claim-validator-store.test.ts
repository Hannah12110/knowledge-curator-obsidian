import test from "node:test";
import assert from "node:assert/strict";
import type { Vault } from "obsidian";
import {
  CLAIM_STORE_PATH,
  ClaimStoreRepository
} from "../src/services/claim-store-repository";
import {
  ClaimValidationError,
  parseExtractedClaims,
  validateClaimStore
} from "../src/services/claim-validator";
import { ClaimExtractionService } from "../src/services/claim-extraction-service";
import { LlmServiceError } from "../src/services/llm-service";
import type { LlmService } from "../src/services/llm-service";

const NOW = "2026-09-25T00:00:00.000Z";

function validStore() {
  return {
    schemaVersion: 1,
    generatedAt: NOW,
    claims: {
      claim_one: {
        id: "claim_one",
        statement: "Long-term memory persists across sessions.",
        normalizedStatement: "long-term memory persists across sessions",
        type: "fact",
        status: "active",
        confidence: 0.9,
        provenance: [{
          filePath: "KnowledgeCuratorPhase1Test/wiki/Memory.md",
          fileHash: "hash",
          sourceKind: "wiki",
          accepted: true
        }],
        createdAt: NOW,
        updatedAt: NOW
      }
    },
    files: {
      "KnowledgeCuratorPhase1Test/wiki/Memory.md": {
        fileHash: "hash",
        claimIds: ["claim_one"],
        indexedAt: NOW
      }
    },
    failedFiles: {}
  };
}

test("claim extraction validation accepts atomic claims and rejects duplicates", () => {
  const valid = JSON.stringify({
    claims: [{
      statement: "Long-term memory persists across sessions.",
      type: "fact",
      qualifiers: ["usually"],
      confidence: 0.9
    }]
  });
  assert.equal(parseExtractedClaims(valid).length, 1);
  assert.throws(() => parseExtractedClaims(JSON.stringify({
    claims: [
      { statement: "**RAG** may improve accuracy.", type: "fact", confidence: 0.8 },
      { statement: "RAG may improve accuracy.", type: "fact", confidence: 0.8 }
    ]
  })), ClaimValidationError);
});

test("Claim Store validates schema version and claim references", () => {
  assert.equal(validateClaimStore(validStore()).schemaVersion, 1);
  assert.throws(
    () => validateClaimStore({ ...validStore(), schemaVersion: 999 }),
    /版本不兼容/u
  );
  const broken = validStore();
  broken.files["KnowledgeCuratorPhase1Test/wiki/Memory.md"].claimIds = ["missing"];
  assert.throws(() => validateClaimStore(broken), /不存在/u);
});

test("Claim Store repository saves and reloads local JSON", async () => {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const vault = {
    adapter: {
      exists: async (path: string) => files.has(path) || directories.has(path),
      read: async (path: string) => files.get(path)!,
      mkdir: async (path: string) => { directories.add(path); },
      write: async (path: string, value: string) => { files.set(path, value); }
    }
  } as unknown as Vault;
  const repository = new ClaimStoreRepository(vault);
  await repository.save(validateClaimStore(validStore()));
  assert.ok(files.has(CLAIM_STORE_PATH));
  const loaded = await repository.load();
  assert.equal(loaded.status, "ready");
  assert.equal(loaded.store?.claims.claim_one?.statement, "Long-term memory persists across sessions.");
});

test("corrupt Claim Store is isolated and requests a rebuild", async () => {
  const vault = {
    adapter: {
      exists: async () => true,
      read: async () => "{not-json"
    }
  } as unknown as Vault;
  const loaded = await new ClaimStoreRepository(vault).load();
  assert.equal(loaded.status, "corrupt");
  assert.match("message" in loaded ? loaded.message : "", /重新构建/u);
});

test("Claim extraction retries truncated output with a stricter bounded prompt", async () => {
  let calls = 0;
  let retryPrompt = "";
  const llm = {
    requestJsonObject: async (messages: Array<{ content: string }>) => {
      calls += 1;
      if (calls === 1) {
        throw new LlmServiceError("truncated", "output_truncated");
      }
      retryPrompt = messages.at(-1)?.content ?? "";
      return JSON.stringify({
        claims: [{ statement: "A bounded atomic claim.", type: "fact", confidence: 0.9 }]
      });
    }
  } as unknown as LlmService;
  const claims = await new ClaimExtractionService(llm).extractCandidateClaims({
    sourcePath: "KnowledgeCuratorPhase1Test/inbox/Test.md",
    content: "A source."
  });
  assert.equal(calls, 2);
  assert.equal(claims.length, 1);
  assert.match(retryPrompt, /最多 25 条/u);
});

test("Claim extraction keeps at most 30 prioritized claims per document", async () => {
  const rawClaims = Array.from({ length: 35 }, (_, index) => ({
    statement: `Atomic claim ${index + 1}.`,
    type: "fact",
    confidence: 0.8
  }));
  const llm = {
    requestJsonObject: async () => JSON.stringify({ claims: rawClaims })
  } as unknown as LlmService;
  const claims = await new ClaimExtractionService(llm).extractCandidateClaims({
    sourcePath: "KnowledgeCuratorPhase1Test/inbox/Test.md",
    content: "A source with many claims."
  });
  assert.equal(claims.length, 30);
});
