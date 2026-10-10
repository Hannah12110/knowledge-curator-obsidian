import type { TFile } from "obsidian";
import type {
  ClaimRecord,
  ClaimStore,
  ClaimStoreStats
} from "../types/claim";
import { sha256Text } from "./content-hash";
import { ClaimExtractionService } from "./claim-extraction-service";
import { ClaimStoreRepository } from "./claim-store-repository";
import { VaultService } from "./vault-service";

export interface ClaimStoreBuildResult {
  stats: ClaimStoreStats;
  durationMs: number;
  llmCalls: number;
  cacheHits: number;
}

export class ClaimStoreService {
  private store: ClaimStore | null = null;
  private stats: ClaimStoreStats = {
    status: "not_built",
    totalClaims: 0,
    indexedWiki: 0,
    failedFiles: 0
  };
  private abortController: AbortController | null = null;
  private listeners = new Set<(stats: ClaimStoreStats) => void>();

  constructor(
    private readonly vaultService: VaultService,
    private readonly extractionService: ClaimExtractionService,
    private readonly repository: ClaimStoreRepository
  ) {}

  async initialize(): Promise<void> {
    const loaded = await this.repository.load();
    this.store = loaded.store;
    this.stats = loaded.store === null
      ? {
          status: loaded.status,
          totalClaims: 0,
          indexedWiki: 0,
          failedFiles: 0,
          message: "message" in loaded ? loaded.message : undefined
        }
      : this.toStats(loaded.store, loaded.status);
    this.emit();
  }

  getStats(): ClaimStoreStats {
    return {
      ...this.stats,
      progress: this.stats.progress === undefined ? undefined : { ...this.stats.progress }
    };
  }

  getClaims(): ClaimRecord[] {
    if (this.store === null) return [];
    return Object.values(this.store.claims).filter((claim) =>
      claim.provenance.some((item) =>
        item.sourceKind === "wiki" && this.vaultService.isInWikiScope(item.filePath)
      )
    );
  }

  getRevision(): string {
    if (this.store === null) return "not-built";
    const entries = Object.entries(this.store.files)
      .filter(([path]) => this.vaultService.isInWikiScope(path))
      .map(([path, value]) => `${path}:${value.fileHash}`)
      .sort();
    return entries.length === 0 ? "not-built" : entries.join("|");
  }

  subscribe(listener: (stats: ClaimStoreStats) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cancelBuild(): void {
    this.abortController?.abort();
  }

  async build(options: { rebuild: boolean; retryFailedOnly?: boolean }): Promise<ClaimStoreBuildResult> {
    if (this.stats.status === "building") {
      throw new Error("Claim Store 正在建立中。");
    }
    const started = Date.now();
    const controller = new AbortController();
    this.abortController = controller;
    const existing = options.rebuild || this.store === null
      ? this.repository.empty()
      : structuredClone(this.store);
    const files = await this.vaultService.listWikiFiles();
    this.removeDeletedFiles(existing, new Set(files.map((file) => file.path)));
    const targets = options.retryFailedOnly
      ? files.filter((file) => existing.failedFiles[file.path] !== undefined)
      : files;
    let llmCalls = 0;
    let cacheHits = 0;
    let completed = 0;
    this.stats = {
      ...this.toStats(existing, "building"),
      progress: { completed, total: targets.length }
    };
    this.emit();

    try {
      for (const file of targets) {
        if (controller.signal.aborted) break;
        this.stats.progress = { completed, total: targets.length, currentPath: file.path };
        this.emit();
        const content = await this.vaultService.readMarkdown(file);
        const fileHash = await sha256Text(content);
        if (!options.rebuild && existing.files[file.path]?.fileHash === fileHash) {
          cacheHits += 1;
          delete existing.failedFiles[file.path];
          completed += 1;
          await this.persistProgress(existing, completed, targets.length);
          continue;
        }
        try {
          llmCalls += 1;
          const claims = await this.extractionService.extractWikiClaims({
            filePath: file.path,
            fileHash,
            content
          });
          this.replaceFileClaims(existing, file, fileHash, claims);
          delete existing.failedFiles[file.path];
        } catch (error: unknown) {
          console.error(`Knowledge Curator failed to index ${file.path}.`, error);
          existing.failedFiles[file.path] = safeFailureMessage(error);
        }
        completed += 1;
        await this.persistProgress(existing, completed, targets.length);
      }
      if (controller.signal.aborted) {
        for (const file of targets.slice(completed)) {
          existing.failedFiles[file.path] ??= "Claim Store 建立已取消，可重试该文件。";
        }
      }
      existing.generatedAt = new Date().toISOString();
      await this.repository.save(existing);
      this.store = existing;
      const finalStatus = Object.keys(existing.failedFiles).length > 0 ? "partial" : "ready";
      this.stats = this.toStats(existing, finalStatus);
      this.emit();
      return {
        stats: this.getStats(),
        durationMs: Date.now() - started,
        llmCalls,
        cacheHits
      };
    } finally {
      this.abortController = null;
    }
  }

  async reindexWiki(path: string): Promise<void> {
    const file = this.vaultService.getMarkdownFile(path);
    if (file === null || !this.vaultService.isInWikiScope(path)) {
      throw new Error("目标文件不在当前 Wiki 索引范围内。");
    }
    const store = this.store ?? this.repository.empty();
    const content = await this.vaultService.readMarkdown(file);
    const fileHash = await sha256Text(content);
    const claims = await this.extractionService.extractWikiClaims({
      filePath: path,
      fileHash,
      content
    });
    this.replaceFileClaims(store, file, fileHash, claims);
    delete store.failedFiles[path];
    store.generatedAt = new Date().toISOString();
    await this.repository.save(store);
    this.store = store;
    this.stats = this.toStats(store, Object.keys(store.failedFiles).length > 0 ? "partial" : "ready");
    this.emit();
  }

  private replaceFileClaims(
    store: ClaimStore,
    file: TFile,
    fileHash: string,
    claims: ClaimRecord[]
  ): void {
    this.removeFileClaims(store, file.path);
    for (const claim of claims) store.claims[claim.id] = claim;
    store.files[file.path] = {
      fileHash,
      claimIds: claims.map((claim) => claim.id),
      indexedAt: new Date().toISOString()
    };
  }

  private removeDeletedFiles(store: ClaimStore, currentPaths: Set<string>): void {
    for (const path of Object.keys(store.files)) {
      if (!currentPaths.has(path)) this.removeFileClaims(store, path);
    }
    for (const path of Object.keys(store.failedFiles)) {
      if (!currentPaths.has(path)) delete store.failedFiles[path];
    }
  }

  private removeFileClaims(store: ClaimStore, path: string): void {
    const entry = store.files[path];
    for (const claimId of entry?.claimIds ?? []) delete store.claims[claimId];
    delete store.files[path];
  }

  private async persistProgress(store: ClaimStore, completed: number, total: number): Promise<void> {
    store.generatedAt = new Date().toISOString();
    await this.repository.save(store);
    this.store = store;
    this.stats = {
      ...this.toStats(store, "building"),
      progress: { completed, total }
    };
    this.emit();
  }

  private toStats(store: ClaimStore, status: ClaimStoreStats["status"]): ClaimStoreStats {
    const indexedPaths = Object.keys(store.files)
      .filter((path) => this.vaultService.isInWikiScope(path));
    const failedPaths = Object.keys(store.failedFiles)
      .filter((path) => this.vaultService.isInWikiScope(path));
    const totalClaims = Object.values(store.claims).filter((claim) =>
      claim.provenance.some((item) =>
        item.sourceKind === "wiki" && this.vaultService.isInWikiScope(item.filePath)
      )
    ).length;
    const effectiveStatus = status !== "building" && indexedPaths.length === 0 &&
      Object.keys(store.files).length > 0
      ? "not_built"
      : status;
    return {
      status: effectiveStatus,
      totalClaims,
      indexedWiki: indexedPaths.length,
      failedFiles: failedPaths.length,
      lastUpdated: store.generatedAt
    };
  }

  private emit(): void {
    const stats = this.getStats();
    for (const listener of this.listeners) listener(stats);
  }
}

function safeFailureMessage(error: unknown): string {
  const candidate = error as { userMessage?: unknown };
  return typeof candidate?.userMessage === "string"
    ? candidate.userMessage
    : "Claim 抽取失败，请重试。";
}
