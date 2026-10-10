import type { Vault } from "obsidian";
import type { ClaimGraphStore } from "../types/claim-graph";
import { createEmptyClaimGraphStore, validateClaimGraphStore } from "./claim-graph-validator";

export const CLAIM_GRAPH_ROOT = ".knowledge-agent/claim-graph";
export const CLAIM_GRAPH_STORE_PATH = `${CLAIM_GRAPH_ROOT}/store.json`;

export type ClaimGraphLoadResult =
  | { status: "not_built"; store: null }
  | { status: "ready" | "partial"; store: ClaimGraphStore }
  | { status: "corrupt"; store: null; message: string };

export class ClaimGraphRepository {
  constructor(private readonly vault: Vault) {}

  async load(): Promise<ClaimGraphLoadResult> {
    try {
      if (!await this.vault.adapter.exists(CLAIM_GRAPH_STORE_PATH)) {
        return { status: "not_built", store: null };
      }
      const store = validateClaimGraphStore(
        JSON.parse(await this.vault.adapter.read(CLAIM_GRAPH_STORE_PATH)) as unknown
      );
      return {
        status: store.metadata.failedPairs.length > 0 ? "partial" : "ready",
        store
      };
    } catch (error: unknown) {
      console.error("Knowledge Curator could not read Claim Graph Store.", error);
      return {
        status: "corrupt",
        store: null,
        message: "Claim Graph 无法读取，请重新构建。"
      };
    }
  }

  async save(store: ClaimGraphStore): Promise<void> {
    const validated = validateClaimGraphStore(store);
    if (!await this.vault.adapter.exists(CLAIM_GRAPH_ROOT)) {
      await this.vault.adapter.mkdir(CLAIM_GRAPH_ROOT);
    }
    await this.vault.adapter.write(
      CLAIM_GRAPH_STORE_PATH,
      `${JSON.stringify(validated, null, 2)}\n`
    );
  }

  empty(claimStoreRevision: string): ClaimGraphStore {
    return createEmptyClaimGraphStore(claimStoreRevision);
  }
}
