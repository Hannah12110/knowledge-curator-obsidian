import type { Vault } from "obsidian";
import {
  CLAIM_STORE_SCHEMA_VERSION
} from "../types/claim";
import type { ClaimStore } from "../types/claim";
import { validateClaimStore } from "./claim-validator";

export const CLAIM_STORE_ROOT = ".knowledge-agent/claim-store";
export const CLAIM_STORE_PATH = `${CLAIM_STORE_ROOT}/store.json`;

export type ClaimStoreLoadResult =
  | { status: "not_built"; store: null }
  | { status: "ready" | "partial"; store: ClaimStore }
  | { status: "corrupt"; store: null; message: string };

export class ClaimStoreRepository {
  constructor(private readonly vault: Vault) {}

  async load(): Promise<ClaimStoreLoadResult> {
    try {
      if (!await this.vault.adapter.exists(CLAIM_STORE_PATH)) {
        return { status: "not_built", store: null };
      }
      const raw = await this.vault.adapter.read(CLAIM_STORE_PATH);
      const store = validateClaimStore(JSON.parse(raw) as unknown);
      return {
        status: Object.keys(store.failedFiles).length > 0 ? "partial" : "ready",
        store
      };
    } catch (error: unknown) {
      console.error("Knowledge Curator could not read Claim Store.", error);
      return {
        status: "corrupt",
        store: null,
        message: "Claim Store 无法读取，请重新构建。"
      };
    }
  }

  async save(store: ClaimStore): Promise<void> {
    const validated = validateClaimStore(store);
    if (!await this.vault.adapter.exists(CLAIM_STORE_ROOT)) {
      await this.vault.adapter.mkdir(CLAIM_STORE_ROOT);
    }
    await this.vault.adapter.write(
      CLAIM_STORE_PATH,
      `${JSON.stringify(validated, null, 2)}\n`
    );
  }

  empty(): ClaimStore {
    return {
      schemaVersion: CLAIM_STORE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      claims: {},
      files: {},
      failedFiles: {}
    };
  }
}
