import type { KnowledgePR, KnowledgePRCache } from "../types/knowledge-pr";
import { normalizeSourcePath } from "./analysis-cache-service";

export class KnowledgePRCacheService {
  private cache: KnowledgePRCache;

  constructor(
    storedCache: unknown,
    private readonly persist: (cache: KnowledgePRCache) => Promise<void>
  ) {
    this.cache = parseStoredKnowledgePRCache(storedCache);
  }

  get(sourcePath: string): KnowledgePR | null {
    return this.cache[normalizeSourcePath(sourcePath)] ?? null;
  }

  async set(pr: KnowledgePR): Promise<void> {
    const sourcePath = normalizeSourcePath(pr.sourcePath);
    this.cache[sourcePath] = {
      ...pr,
      sourcePath
    };
    await this.persist(this.cache);
  }

  async markDraftStale(sourcePath: string): Promise<KnowledgePR | null> {
    const normalizedPath = normalizeSourcePath(sourcePath);
    const current = this.cache[normalizedPath];
    if (current === undefined || current.status !== "draft") {
      return current ?? null;
    }
    const stale: KnowledgePR = { ...current, status: "stale" };
    this.cache[normalizedPath] = stale;
    await this.persist(this.cache);
    return stale;
  }

  async clearDrafts(): Promise<number> {
    let removed = 0;
    for (const [sourcePath, pr] of Object.entries(this.cache)) {
      if (pr.status === "draft" || pr.status === "stale") {
        delete this.cache[sourcePath];
        removed += 1;
      }
    }
    await this.persist(this.cache);
    return removed;
  }

  snapshot(): KnowledgePRCache {
    return { ...this.cache };
  }
}

export function parseStoredKnowledgePRCache(value: unknown): KnowledgePRCache {
  if (!isRecord(value)) {
    return {};
  }
  const cache: KnowledgePRCache = {};
  for (const [sourcePath, candidate] of Object.entries(value)) {
    if (!isBasicKnowledgePR(candidate)) {
      console.warn(`Knowledge Curator ignored invalid Knowledge PR cache for ${sourcePath}.`);
      continue;
    }
    const normalizedSourcePath = normalizeSourcePath(sourcePath);
    if (normalizeSourcePath(candidate.sourcePath) !== normalizedSourcePath) {
      continue;
    }
    cache[normalizedSourcePath] = candidate;
  }
  return cache;
}

function isBasicKnowledgePR(value: unknown): value is KnowledgePR {
  if (!isRecord(value) || !isRecord(value.target) || !isRecord(value.sourceFingerprint)) {
    return false;
  }
  return typeof value.id === "string" &&
    typeof value.sourcePath === "string" &&
    typeof value.target.path === "string" &&
    (value.target.operation === "create" || value.target.operation === "update") &&
    Array.isArray(value.changes) &&
    Array.isArray(value.evidence) &&
    (value.status === "draft" || value.status === "accepted" || value.status === "rejected" || value.status === "stale");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
