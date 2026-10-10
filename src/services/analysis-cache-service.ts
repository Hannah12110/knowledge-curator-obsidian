import type {
  AnalysisCache,
  AnalysisContextMetadata,
  CachedSourceAnalysis,
  ClaimAnalysisContextSnapshot,
  RetrievalScopeSnapshot
} from "../types/analysis";
import type { SourceAnalysis } from "../types/source-analysis";
import {
  createRetrievalScopeSnapshot,
  isPathInKnowledgeScope,
  isPathInsideFolder,
  retrievalScopesEqual
} from "./path-scope";
import { validateSourceAnalysis } from "./source-analysis-validator";

export const ANALYSIS_CACHE_SCHEMA_VERSION = 6;

export class AnalysisCacheService {
  private cache: AnalysisCache;

  constructor(
    storedCache: unknown,
    private readonly persist: (cache: AnalysisCache) => Promise<void>
  ) {
    this.cache = parseStoredCache(storedCache);
  }

  getValid(
    sourcePath: string,
    sourceModified: number,
    currentScope?: RetrievalScopeSnapshot,
    currentClaimContext?: ClaimAnalysisContextSnapshot
  ): CachedSourceAnalysis | null {
    const entry = this.cache[normalizeSourcePath(sourcePath)];
    if (entry === undefined || entry.sourceModified !== sourceModified) {
      return null;
    }
    if (currentScope !== undefined && !isEntryWithinScope(entry, currentScope)) {
      return null;
    }
    if (
      currentClaimContext !== undefined &&
      !claimContextsEqual(entry.context.claimContext, currentClaimContext)
    ) {
      return null;
    }
    return entry;
  }

  getAnalysis(
    sourcePath: string,
    sourceModified: number,
    currentScope?: RetrievalScopeSnapshot,
    currentClaimContext?: ClaimAnalysisContextSnapshot
  ): SourceAnalysis | null {
    return this.getValid(
      sourcePath,
      sourceModified,
      currentScope,
      currentClaimContext
    )?.analysis ?? null;
  }

  async set(entry: CachedSourceAnalysis): Promise<void> {
    const sourcePath = normalizeSourcePath(entry.sourcePath);
    this.cache[sourcePath] = {
      ...entry,
      schemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION,
      sourcePath
    };
    await this.persist(this.cache);
  }

  async clear(): Promise<void> {
    this.cache = {};
    await this.persist(this.cache);
  }

  snapshot(): AnalysisCache {
    return { ...this.cache };
  }
}

function parseStoredCache(value: unknown): AnalysisCache {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const cache: AnalysisCache = {};
  for (const [path, candidate] of Object.entries(value as Record<string, unknown>)) {
    try {
      const entry = parseEntry(candidate);
      const normalizedPath = normalizeSourcePath(path);
      if (normalizeSourcePath(entry.sourcePath) === normalizedPath) {
        cache[normalizedPath] = {
          ...entry,
          sourcePath: normalizedPath
        };
      }
    } catch (error: unknown) {
      console.warn(`Knowledge Curator ignored invalid analysis cache for ${path}.`, error);
    }
  }
  return cache;
}

export function normalizeSourcePath(sourcePath: string): string {
  return sourcePath
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\/{2,}/gu, "/");
}

function parseEntry(value: unknown): CachedSourceAnalysis {
  const record = requireRecord(value);
  const sourcePath = requireString(record.sourcePath);
  const schemaVersion = requireFiniteNumber(record.schemaVersion);
  if (schemaVersion !== ANALYSIS_CACHE_SCHEMA_VERSION) {
    throw new Error("Unsupported analysis cache schema version.");
  }
  const sourceModified = requireFiniteNumber(record.sourceModified);
  const analyzedAt = requireString(record.analyzedAt);
  const context = parseContext(record.context);
  return {
    schemaVersion,
    sourcePath,
    sourceModified,
    analyzedAt,
    analysis: validateSourceAnalysis(record.analysis),
    context
  };
}

function parseContext(value: unknown): AnalysisContextMetadata {
  const record = requireRecord(value);
  if (
    typeof record.sourceTruncated !== "boolean" ||
    typeof record.relatedNotesTruncated !== "boolean" ||
    typeof record.totalContextTruncated !== "boolean" ||
    !Array.isArray(record.candidatePaths) ||
    !record.candidatePaths.every((path) => typeof path === "string") ||
    typeof record.retrievalScope !== "object" ||
    record.retrievalScope === null
  ) {
    throw new Error("Invalid cache context metadata.");
  }
  return {
    sourceTruncated: record.sourceTruncated,
    relatedNotesTruncated: record.relatedNotesTruncated,
    totalContextTruncated: record.totalContextTruncated,
    candidatePaths: record.candidatePaths as string[],
    retrievalScope: parseRetrievalScope(record.retrievalScope),
    claimContext: parseClaimContext(record.claimContext)
  };
}

function parseClaimContext(value: unknown): ClaimAnalysisContextSnapshot {
  const record = requireRecord(value);
  if (
    (record.mode !== "legacy" && record.mode !== "claim") ||
    typeof record.topK !== "number" ||
    !Number.isFinite(record.topK) ||
    typeof record.claimStoreRevision !== "string" ||
    record.claimStoreRevision.length === 0 ||
    (record.retrievalVersion !== "legacy-document" &&
      record.retrievalVersion !== "claim-retrieval-v1" &&
      record.retrievalVersion !== "claim-retrieval-v2") ||
    (record.comparisonVersion !== "legacy-document" &&
      record.comparisonVersion !== "claim-comparison-v1" &&
      record.comparisonVersion !== "claim-comparison-v2")
  ) {
    throw new Error("Invalid claim analysis cache context.");
  }
  return {
    mode: record.mode,
    topK: record.topK,
    claimStoreRevision: record.claimStoreRevision,
    retrievalVersion: record.retrievalVersion,
    comparisonVersion: record.comparisonVersion
  };
}

function claimContextsEqual(
  left: ClaimAnalysisContextSnapshot,
  right: ClaimAnalysisContextSnapshot
): boolean {
  return left.mode === right.mode &&
    left.topK === right.topK &&
    left.claimStoreRevision === right.claimStoreRevision &&
    left.retrievalVersion === right.retrievalVersion &&
    left.comparisonVersion === right.comparisonVersion;
}

function parseRetrievalScope(value: unknown): RetrievalScopeSnapshot {
  const record = requireRecord(value);
  if (
    typeof record.inboxFolder !== "string" ||
    typeof record.wikiFolder !== "string" ||
    !Array.isArray(record.rawFolders) ||
    !record.rawFolders.every((folder) => typeof folder === "string")
  ) {
    throw new Error("Invalid cache retrieval scope.");
  }
  return createRetrievalScopeSnapshot({
    inboxFolder: record.inboxFolder,
    wikiFolder: record.wikiFolder,
    rawFolders: record.rawFolders as string[]
  });
}

function isEntryWithinScope(
  entry: CachedSourceAnalysis,
  currentScope: RetrievalScopeSnapshot
): boolean {
  const normalizedScope = createRetrievalScopeSnapshot(currentScope);
  if (
    !retrievalScopesEqual(entry.context.retrievalScope, normalizedScope) ||
    !isPathInsideFolder(entry.sourcePath, normalizedScope.inboxFolder)
  ) {
    return false;
  }
  const candidatePaths = [
    ...entry.context.candidatePaths,
    ...entry.analysis.relatedNotes.map((note) => note.path),
    ...entry.analysis.duplicateWith
  ];
  return candidatePaths.every((path) =>
    isPathInKnowledgeScope(path, normalizedScope)
  );
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected a string.");
  }
  return value;
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Expected a finite number.");
  }
  return value;
}
