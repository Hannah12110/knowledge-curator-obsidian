import type { Conflict } from "../types/source-analysis";
import type {
  CachedConflictVerification,
  ConflictVerificationCache,
  SearchProviderId
} from "../types/verification";
import { normalizeSourcePath } from "./analysis-cache-service";
import {
  createConflictId,
  createVerificationCacheKey,
  generateConflictSearchQueries
} from "./conflict-query-service";

export class VerificationCacheService {
  private cache: ConflictVerificationCache;

  constructor(
    storedCache: unknown,
    private readonly persist: (cache: ConflictVerificationCache) => Promise<void>
  ) {
    this.cache = parseStoredVerificationCache(storedCache);
  }

  async getValid(input: {
    sourcePath: string;
    topic: string;
    conflict: Conflict;
    provider: SearchProviderId;
    model: string;
  }): Promise<CachedConflictVerification | null> {
    const queries = generateConflictSearchQueries(input.topic, input.conflict);
    const conflictId = await createConflictId(input.sourcePath, input.conflict);
    const cacheKey = await createVerificationCacheKey({
      conflictId,
      existingClaim: input.conflict.existingClaim,
      newClaim: input.conflict.newClaim,
      queries,
      provider: input.provider,
      model: input.model
    });
    const cached = this.cache[cacheKey];
    if (
      cached === undefined ||
      cached.sourcePath !== normalizeSourcePath(input.sourcePath) ||
      cached.existingClaim !== input.conflict.existingClaim ||
      cached.newClaim !== input.conflict.newClaim ||
      cached.provider !== input.provider ||
      cached.model !== input.model
    ) {
      return null;
    }
    return cached;
  }

  async listValidForSource(input: {
    sourcePath: string;
    topic: string;
    conflicts: Conflict[];
    provider: SearchProviderId;
    model: string;
  }): Promise<CachedConflictVerification[]> {
    const output: CachedConflictVerification[] = [];
    for (const conflict of input.conflicts) {
      const cached = await this.getValid({ ...input, conflict });
      if (cached !== null) {
        output.push(cached);
      }
    }
    return output;
  }

  countMatchingForSource(input: {
    sourcePath: string;
    conflicts: Conflict[];
    provider: SearchProviderId;
    model: string;
  }): number {
    const sourcePath = normalizeSourcePath(input.sourcePath);
    return Object.values(this.cache).filter((entry) =>
      entry.sourcePath === sourcePath &&
      entry.provider === input.provider &&
      entry.model === input.model &&
      input.conflicts.some((conflict) =>
        entry.existingClaim === conflict.existingClaim &&
        entry.newClaim === conflict.newClaim
      )
    ).length;
  }

  async set(entry: CachedConflictVerification): Promise<void> {
    this.cache[entry.cacheKey] = {
      ...entry,
      sourcePath: normalizeSourcePath(entry.sourcePath)
    };
    await this.persist(this.cache);
  }

  async clear(): Promise<void> {
    this.cache = {};
    await this.persist(this.cache);
  }

  snapshot(): ConflictVerificationCache {
    return { ...this.cache };
  }
}

export function parseStoredVerificationCache(value: unknown): ConflictVerificationCache {
  if (!isRecord(value)) {
    return {};
  }
  const output: ConflictVerificationCache = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isBasicEntry(entry) || entry.cacheKey !== key) {
      continue;
    }
    output[key] = entry;
  }
  return output;
}

function isBasicEntry(value: unknown): value is CachedConflictVerification {
  if (!isRecord(value) || !isRecord(value.result)) {
    return false;
  }
  const result = value.result;
  return isNonEmptyString(value.cacheKey) &&
    isNonEmptyString(value.sourcePath) &&
    isNonEmptyString(value.conflictId) &&
    isNonEmptyString(value.existingClaim) &&
    isNonEmptyString(value.newClaim) &&
    Array.isArray(value.queries) &&
    value.queries.length > 0 &&
    value.queries.every(isNonEmptyString) &&
    value.provider === "tavily" &&
    typeof value.model === "string" &&
    result.status === "verified" &&
    result.conflictId === value.conflictId &&
    (result.resolution === "supersede" ||
      result.resolution === "refine" ||
      result.resolution === "unresolved") &&
    isNonEmptyString(result.conclusion) &&
    isNonEmptyString(result.reasoning) &&
    isConfidence(result.confidence) &&
    isNonEmptyString(result.verifiedAt) &&
    !Number.isNaN(Date.parse(result.verifiedAt)) &&
    Array.isArray(result.evidence) &&
    result.evidence.length > 0 &&
    result.evidence.length <= 5 &&
    result.evidence.every(isBasicEvidence);
}

function isBasicEvidence(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const validSourceType = value.sourceType === "official" ||
    value.sourceType === "paper" ||
    value.sourceType === "repository" ||
    value.sourceType === "research" ||
    value.sourceType === "engineering" ||
    value.sourceType === "media" ||
    value.sourceType === "community" ||
    value.sourceType === "unknown";
  const validSupports = value.supports === "existing" ||
    value.supports === "new" ||
    value.supports === "both" ||
    value.supports === "neither";
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isHttpUrl(value.url) &&
    typeof value.sourceTier === "number" &&
    Number.isInteger(value.sourceTier) &&
    value.sourceTier >= 0 &&
    value.sourceTier <= 4 &&
    validSourceType &&
    validSupports &&
    (value.excerpt === undefined || typeof value.excerpt === "string") &&
    isNonEmptyString(value.reasoning) &&
    isConfidence(value.confidence);
}

function isHttpUrl(value: unknown): boolean {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
