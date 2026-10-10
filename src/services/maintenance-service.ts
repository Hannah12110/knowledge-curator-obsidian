import type { ClaimRecord } from "../types/claim";
import {
  FRESHNESS_RISK_POLICY_VERSION,
  MAINTENANCE_STORE_SCHEMA_VERSION
} from "../types/maintenance";
import type {
  CachedFreshnessVerification,
  FreshnessVerificationResult,
  MaintenanceFilter,
  MaintenanceQueueItem,
  MaintenanceQueueStats,
  MaintenanceSnapshot,
  MaintenanceStore,
  MaintenanceStoreStatus
} from "../types/maintenance";
import type { ClaimStoreService } from "./claim-store-service";
import type { FreshnessRiskService } from "./freshness-risk-service";
import type { MaintenanceStoreRepository } from "./maintenance-store-repository";
import type { VaultService } from "./vault-service";

export interface FreshnessScanResult {
  stats: MaintenanceQueueStats;
  durationMs: number;
  assessed: number;
  reused: number;
}

export class MaintenanceService {
  private store: MaintenanceStore;
  private status: MaintenanceStoreStatus = "not_scanned";
  private message?: string;
  private scanDurationMs?: number;
  private listeners = new Set<() => void>();

  constructor(
    private readonly claimStore: ClaimStoreService,
    private readonly vaultService: VaultService,
    private readonly riskService: FreshnessRiskService,
    private readonly repository: MaintenanceStoreRepository
  ) {
    this.store = repository.empty();
  }

  async initialize(): Promise<void> {
    const loaded = await this.repository.load();
    this.store = loaded.store;
    this.status = loaded.status;
    this.message = "message" in loaded ? loaded.message : undefined;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async scan(): Promise<FreshnessScanResult> {
    const started = performance.now();
    const claims = this.claimStore.getClaims();
    const previous = this.store;
    const records: MaintenanceStore["records"] = {};
    let assessed = 0;
    let reused = 0;
    for (const claim of claims) {
      const fingerprint = await this.riskService.fingerprint(claim);
      const existing = previous.records[claim.id];
      if (
        previous.riskPolicyVersion === FRESHNESS_RISK_POLICY_VERSION &&
        existing?.claimFingerprint === fingerprint
      ) {
        records[claim.id] = existing;
        reused += 1;
        continue;
      }
      const sourcePath = getPrimaryWikiPath(claim);
      const file = sourcePath === undefined ? null : this.vaultService.getMarkdownFile(sourcePath);
      records[claim.id] = await this.riskService.assess({
        claim,
        sourceModified: file?.stat.mtime,
        previousResolution: existing?.latestResolution,
        lastVerifiedAt: existing?.lastVerifiedAt
      });
      assessed += 1;
    }
    const currentFingerprints = new Set(Object.values(records).map((record) => record.claimFingerprint));
    const verifications = Object.fromEntries(Object.entries(previous.verifications)
      .filter(([, result]) => currentFingerprints.has(result.claimFingerprint)));
    const verificationCache = Object.fromEntries(Object.entries(previous.verificationCache)
      .filter(([, entry]) => currentFingerprints.has(entry.claimFingerprint)));
    this.store = {
      schemaVersion: MAINTENANCE_STORE_SCHEMA_VERSION,
      riskPolicyVersion: FRESHNESS_RISK_POLICY_VERSION,
      generatedAt: new Date().toISOString(),
      records,
      verifications,
      verificationCache
    };
    await this.repository.save(this.store);
    this.status = "ready";
    this.message = undefined;
    this.scanDurationMs = performance.now() - started;
    this.emit();
    return { stats: this.getStats(), durationMs: this.scanDurationMs, assessed, reused };
  }

  getSnapshot(filter: MaintenanceFilter = "all"): MaintenanceSnapshot {
    const claims = new Map(this.claimStore.getClaims().map((claim) => [claim.id, claim]));
    const items = Object.values(this.store.records)
      .flatMap((record): MaintenanceQueueItem[] => {
        const claim = claims.get(record.claimId);
        if (claim === undefined || !matchesFilter(record, filter)) return [];
        const verification = record.latestVerificationId === undefined
          ? undefined
          : this.store.verifications[record.latestVerificationId];
        return [{ claim, record, sourcePath: getPrimaryWikiPath(claim) ?? "(unknown)", verification }];
      })
      .sort(compareQueueItems);
    return { stats: this.getStats(), items };
  }

  getClaim(claimId: string): ClaimRecord | null {
    return this.claimStore.getClaims().find((claim) => claim.id === claimId) ?? null;
  }

  getRecord(claimId: string) {
    return this.store.records[claimId] ?? null;
  }

  getVerification(verificationId: string): FreshnessVerificationResult | null {
    return this.store.verifications[verificationId] ?? null;
  }

  getCachedVerification(cacheKey: string): CachedFreshnessVerification | null {
    return this.store.verificationCache[cacheKey] ?? null;
  }

  async saveVerification(entry: CachedFreshnessVerification): Promise<void> {
    const record = this.store.records[entry.claimId];
    if (record === undefined || record.claimFingerprint !== entry.claimFingerprint) {
      throw new Error("Claim Maintenance Record 已失效，请重新扫描。");
    }
    this.store.verifications[entry.result.id] = entry.result;
    this.store.verificationCache[entry.cacheKey] = entry;
    record.lastVerifiedAt = entry.result.verifiedAt;
    record.latestVerificationId = entry.result.id;
    record.latestResolution = entry.result.resolution;
    this.store.generatedAt = new Date().toISOString();
    await this.repository.save(this.store);
    this.emit();
  }

  async clearVerificationCache(): Promise<number> {
    const count = Object.keys(this.store.verificationCache).length;
    this.store.verificationCache = {};
    await this.repository.save(this.store);
    this.emit();
    return count;
  }

  async handleAccepted(claimId: string): Promise<void> {
    delete this.store.records[claimId];
    this.store.generatedAt = new Date().toISOString();
    await this.repository.save(this.store);
    this.emit();
  }

  getStats(): MaintenanceQueueStats {
    const records = Object.values(this.store.records);
    const count = (risk: string) => records.filter((record) => record.freshnessRisk === risk).length;
    return {
      status: this.status,
      totalClaims: records.length,
      critical: count("critical"),
      high: count("high"),
      medium: count("medium"),
      low: count("low"),
      neverVerified: records.filter((record) => record.lastVerifiedAt === undefined).length,
      lastScannedAt: this.status === "ready" ? this.store.generatedAt : undefined,
      scanDurationMs: this.scanDurationMs,
      message: this.message
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function getPrimaryWikiPath(claim: ClaimRecord): string | undefined {
  return claim.provenance.find((item) => item.sourceKind === "wiki")?.filePath;
}

function matchesFilter(record: MaintenanceStore["records"][string], filter: MaintenanceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "verified") return record.lastVerifiedAt !== undefined;
  if (filter === "unverified") return record.lastVerifiedAt === undefined;
  return record.freshnessRisk === filter;
}

function compareQueueItems(left: MaintenanceQueueItem, right: MaintenanceQueueItem): number {
  const severity = { critical: 4, high: 3, medium: 2, low: 1 };
  return severity[right.record.freshnessRisk] - severity[left.record.freshnessRisk] ||
    right.record.riskScore - left.record.riskScore ||
    Number(left.record.lastVerifiedAt !== undefined) - Number(right.record.lastVerifiedAt !== undefined) ||
    (left.record.lastVerifiedAt ?? "").localeCompare(right.record.lastVerifiedAt ?? "") ||
    left.claim.statement.localeCompare(right.claim.statement);
}
