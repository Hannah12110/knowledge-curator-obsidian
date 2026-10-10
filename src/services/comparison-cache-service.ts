import type {
  CandidateClaim,
  ClaimComparison,
  ClaimRecord,
  ClaimRetrievalMatch
} from "../types/claim";
import {
  COMPARISON_CACHE_SCHEMA_VERSION
} from "../types/comparison-cache";
import type {
  ComparisonCache,
  ComparisonCacheContext,
  ComparisonCacheEntry
} from "../types/comparison-cache";
import { sha256Text } from "./content-hash";
import { normalizeClaim } from "./claim-identity";

export const MAX_COMPARISON_CACHE_ENTRIES = 5_000;

export interface ComparisonCacheIdentityInput {
  candidate: CandidateClaim;
  matches: ClaimRetrievalMatch[];
  getClaim: (id: string) => ClaimRecord | undefined;
  retrievalVersion: string;
  comparisonVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
}

export class ComparisonCacheService {
  private cache: ComparisonCache;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    stored: unknown,
    private readonly persist: (cache: ComparisonCache) => Promise<void>,
    private readonly maxEntries = MAX_COMPARISON_CACHE_ENTRIES
  ) {
    this.cache = sanitizeStoredCache(stored);
  }

  get(key: string): ComparisonCacheEntry | null {
    const entry = this.cache[key];
    return entry === undefined ? null : cloneEntry(entry);
  }

  async setMany(entries: ComparisonCacheEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.schemaVersion !== COMPARISON_CACHE_SCHEMA_VERSION || entry.key.length === 0) {
        continue;
      }
      this.cache[entry.key] = cloneEntry(entry);
    }
    this.enforceLimit();
    await this.queuePersist();
  }

  async clear(): Promise<number> {
    const removed = Object.keys(this.cache).length;
    this.cache = {};
    await this.queuePersist();
    return removed;
  }

  size(): number {
    return Object.keys(this.cache).length;
  }

  snapshot(): ComparisonCache {
    return cloneCache(this.cache);
  }

  private enforceLimit(): void {
    const entries = Object.values(this.cache);
    if (entries.length <= this.maxEntries) return;
    entries.sort((left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.key.localeCompare(right.key)
    );
    for (const entry of entries.slice(0, entries.length - this.maxEntries)) {
      delete this.cache[entry.key];
    }
  }

  private async queuePersist(): Promise<void> {
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(async () => this.persist(this.snapshot()));
    await this.persistQueue;
  }
}

export async function buildComparisonCacheIdentity(
  input: ComparisonCacheIdentityInput
): Promise<{ key: string; context: ComparisonCacheContext }> {
  const candidateHash = await sha256Text(JSON.stringify({
    statement: input.candidate.normalizedStatement,
    type: input.candidate.type,
    topic: normalizeOptional(input.candidate.topic),
    scope: normalizeList(input.candidate.scope),
    qualifiers: normalizeList(input.candidate.qualifiers),
    confidence: input.candidate.confidence
  }));
  // Ranking order and score are kept because they are included in the LLM payload.
  // A change in either can change multi-Claim coverage and must invalidate the entry.
  const existingClaimHashes = await Promise.all(input.matches.map(async (match) => {
    const claim = input.getClaim(match.claimId);
    if (claim === undefined) {
      return await sha256Text(JSON.stringify({ id: match.claimId, missing: true, score: match.score }));
    }
    return await sha256Text(JSON.stringify({
      id: claim.id,
      statement: claim.normalizedStatement,
      type: claim.type,
      topic: normalizeOptional(claim.topic),
      scope: normalizeList(claim.scope),
      qualifiers: normalizeList(claim.qualifiers),
      status: claim.status,
      score: match.score,
      provenance: claim.provenance.map((item) => ({
        filePath: item.filePath,
        fileHash: item.fileHash,
        heading: normalizeOptional(item.heading),
        sourceKind: item.sourceKind,
        accepted: item.accepted === true
      }))
    }));
  }));
  const context: ComparisonCacheContext = {
    candidateHash,
    existingClaimHashes,
    retrievalVersion: input.retrievalVersion,
    comparisonVersion: input.comparisonVersion,
    promptVersion: input.promptVersion,
    provider: input.provider.trim().toLowerCase(),
    model: input.model.trim()
  };
  return {
    key: `comparison_${await sha256Text(JSON.stringify(context))}`,
    context
  };
}

export function createComparisonCacheEntry(input: {
  key: string;
  context: ComparisonCacheContext;
  comparison: ClaimComparison;
  createdAt?: string;
}): ComparisonCacheEntry {
  return {
    schemaVersion: COMPARISON_CACHE_SCHEMA_VERSION,
    key: input.key,
    context: { ...input.context, existingClaimHashes: [...input.context.existingClaimHashes] },
    comparison: cloneComparison(input.comparison),
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

function sanitizeStoredCache(value: unknown): ComparisonCache {
  if (!isRecord(value)) return {};
  const output: ComparisonCache = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!isRecord(candidate) || candidate.schemaVersion !== COMPARISON_CACHE_SCHEMA_VERSION ||
      candidate.key !== key || !isIsoDate(candidate.createdAt) || !isRecord(candidate.context) ||
      !isRecord(candidate.comparison)) {
      console.warn(`[Knowledge Curator] ignored corrupt Comparison Cache entry: ${key}`);
      continue;
    }
    const context = parseContext(candidate.context);
    if (context === null) {
      console.warn(`[Knowledge Curator] ignored corrupt Comparison Cache context: ${key}`);
      continue;
    }
    output[key] = {
      schemaVersion: COMPARISON_CACHE_SCHEMA_VERSION,
      key,
      context,
      comparison: candidate.comparison as unknown as ClaimComparison,
      createdAt: candidate.createdAt
    };
  }
  return output;
}

function parseContext(value: Record<string, unknown>): ComparisonCacheContext | null {
  const strings = [
    value.candidateHash,
    value.retrievalVersion,
    value.comparisonVersion,
    value.promptVersion,
    value.provider,
    value.model
  ];
  if (strings.some((item) => typeof item !== "string" || item.length === 0) ||
    !Array.isArray(value.existingClaimHashes) ||
    value.existingClaimHashes.some((item) => typeof item !== "string" || item.length === 0)) {
    return null;
  }
  return {
    candidateHash: value.candidateHash as string,
    existingClaimHashes: [...value.existingClaimHashes] as string[],
    retrievalVersion: value.retrievalVersion as string,
    comparisonVersion: value.comparisonVersion as string,
    promptVersion: value.promptVersion as string,
    provider: value.provider as string,
    model: value.model as string
  };
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeClaim).filter(Boolean))].sort();
}

function normalizeOptional(value: string | undefined): string {
  return value === undefined ? "" : normalizeClaim(value);
}

function cloneCache(cache: ComparisonCache): ComparisonCache {
  return Object.fromEntries(Object.entries(cache).map(([key, entry]) => [key, cloneEntry(entry)]));
}

function cloneEntry(entry: ComparisonCacheEntry): ComparisonCacheEntry {
  return JSON.parse(JSON.stringify(entry)) as ComparisonCacheEntry;
}

function cloneComparison(comparison: ClaimComparison): ClaimComparison {
  return JSON.parse(JSON.stringify(comparison)) as ClaimComparison;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
