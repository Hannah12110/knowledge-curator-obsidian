import test from "node:test";
import assert from "node:assert/strict";
import type { Vault } from "obsidian";
import { ClaimGraphRepository, CLAIM_GRAPH_STORE_PATH } from "../src/services/claim-graph-repository";

test("Claim Graph repository persists only the derived graph path and reloads it", async () => {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const vault = {
    adapter: {
      exists: async (path: string) => files.has(path) || path === ".knowledge-agent/claim-graph",
      mkdir: async () => undefined,
      read: async (path: string) => files.get(path) ?? "",
      write: async (path: string, content: string) => { writes.push(path); files.set(path, content); }
    }
  } as unknown as Vault;
  const repository = new ClaimGraphRepository(vault);
  const store = repository.empty("wiki:hash");
  await repository.save(store);
  const loaded = await repository.load();
  assert.deepEqual(writes, [CLAIM_GRAPH_STORE_PATH]);
  assert.equal(loaded.status, "ready");
  assert.equal(loaded.store?.metadata.claimStoreRevision, "wiki:hash");
  assert.equal(writes.some((path) => path.endsWith(".md")), false);
});

test("corrupt Claim Graph is isolated instead of breaking plugin initialization", async () => {
  const vault = {
    adapter: {
      exists: async () => true,
      read: async () => "{broken",
      write: async () => undefined,
      mkdir: async () => undefined
    }
  } as unknown as Vault;
  const loaded = await new ClaimGraphRepository(vault).load();
  assert.equal(loaded.status, "corrupt");
  assert.equal(loaded.store, null);
});
