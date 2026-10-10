import type { Vault } from "obsidian";
import {
  FRESHNESS_RISK_POLICY_VERSION,
  MAINTENANCE_STORE_SCHEMA_VERSION
} from "../types/maintenance";
import type { MaintenanceStore, MaintenanceStoreStatus } from "../types/maintenance";
import { validateMaintenanceStore } from "./maintenance-validator";

export const MAINTENANCE_STORE_ROOT = ".knowledge-agent/maintenance";
export const MAINTENANCE_STORE_PATH = `${MAINTENANCE_STORE_ROOT}/maintenance-store.json`;

export type MaintenanceStoreLoadResult =
  | { status: "not_scanned"; store: MaintenanceStore }
  | { status: "ready"; store: MaintenanceStore }
  | { status: "corrupt"; store: MaintenanceStore; message: string };

export class MaintenanceStoreRepository {
  constructor(private readonly vault: Vault) {}

  empty(): MaintenanceStore {
    return {
      schemaVersion: MAINTENANCE_STORE_SCHEMA_VERSION,
      riskPolicyVersion: FRESHNESS_RISK_POLICY_VERSION,
      generatedAt: new Date(0).toISOString(),
      records: {},
      verifications: {},
      verificationCache: {}
    };
  }

  async load(): Promise<MaintenanceStoreLoadResult> {
    try {
      if (!await this.vault.adapter.exists(MAINTENANCE_STORE_PATH)) {
        return { status: "not_scanned", store: this.empty() };
      }
      const parsed = JSON.parse(await this.vault.adapter.read(MAINTENANCE_STORE_PATH)) as unknown;
      return { status: "ready", store: validateMaintenanceStore(parsed) };
    } catch (error: unknown) {
      console.error("Knowledge Curator could not read Maintenance Store.", error);
      return {
        status: "corrupt",
        store: this.empty(),
        message: "知识维护数据无法读取，可重新扫描 Freshness Risk。"
      };
    }
  }

  async save(store: MaintenanceStore): Promise<void> {
    const validated = validateMaintenanceStore(store);
    if (!await this.vault.adapter.exists(MAINTENANCE_STORE_ROOT)) {
      await this.vault.adapter.mkdir(MAINTENANCE_STORE_ROOT);
    }
    await this.vault.adapter.write(
      MAINTENANCE_STORE_PATH,
      `${JSON.stringify(validated, null, 2)}\n`
    );
  }
}

export function normalizeMaintenanceStatus(status: MaintenanceStoreStatus): MaintenanceStoreStatus {
  return status;
}

