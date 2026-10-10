import type { AnalysisCache } from "../types/analysis";
import type { KnowledgePRCache } from "../types/knowledge-pr";
import type { ConflictVerificationCache } from "../types/verification";
import type { ComparisonCache } from "../types/comparison-cache";
import {
  DEFAULT_SETTINGS
} from "../types/settings";
import type {
  KnowledgeCuratorSettings,
  LegacyKnowledgeCuratorSettings
} from "../types/settings";

export function migrateSettings(storedData: unknown): KnowledgeCuratorSettings {
  const stored = isRecord(storedData) ? storedData : {};
  const legacy = stored as Partial<KnowledgeCuratorSettings> & LegacyKnowledgeCuratorSettings;
  const rawFolders = normalizeRawFolders(legacy.rawFolders, legacy.rawFolder);
  const maxRelatedNotes = typeof legacy.maxRelatedNotes === "number" &&
    Number.isFinite(legacy.maxRelatedNotes)
    ? Math.min(20, Math.max(1, Math.round(legacy.maxRelatedNotes)))
    : DEFAULT_SETTINGS.maxRelatedNotes;
  const maxSearchResults = typeof legacy.maxSearchResults === "number" &&
    Number.isFinite(legacy.maxSearchResults)
    ? Math.min(10, Math.max(1, Math.round(legacy.maxSearchResults)))
    : DEFAULT_SETTINGS.maxSearchResults;
  const claimRetrievalTopK = typeof legacy.claimRetrievalTopK === "number" &&
    Number.isFinite(legacy.claimRetrievalTopK)
    ? Math.min(10, Math.max(3, Math.round(legacy.claimRetrievalTopK)))
    : DEFAULT_SETTINGS.claimRetrievalTopK;

  return {
    mode: legacy.mode === "production-preview" ? "production-preview" : "test",
    claimComparisonMode: legacy.claimComparisonMode === "legacy" ? "legacy" : "claim",
    claimRetrievalTopK,
    inboxFolder: readString(legacy.inboxFolder, DEFAULT_SETTINGS.inboxFolder),
    rawFolders,
    wikiFolder: readString(legacy.wikiFolder, DEFAULT_SETTINGS.wikiFolder),
    llmBaseUrl: readString(legacy.llmBaseUrl, DEFAULT_SETTINGS.llmBaseUrl),
    llmApiKey: readString(legacy.llmApiKey, DEFAULT_SETTINGS.llmApiKey),
    llmModel: readString(legacy.llmModel, DEFAULT_SETTINGS.llmModel),
    maxRelatedNotes,
    searchProvider: "tavily",
    searchApiKey: readString(legacy.searchApiKey, DEFAULT_SETTINGS.searchApiKey),
    maxSearchResults
  };
}

export function getStoredAnalysisCache(storedData: unknown): AnalysisCache {
  if (!isRecord(storedData)) {
    return {};
  }
  return isRecord(storedData.analysisCache)
    ? storedData.analysisCache as AnalysisCache
    : {};
}

export function getStoredKnowledgePRCache(storedData: unknown): KnowledgePRCache {
  if (!isRecord(storedData)) {
    return {};
  }
  return isRecord(storedData.knowledgePRCache)
    ? storedData.knowledgePRCache as KnowledgePRCache
    : {};
}

export function getStoredVerificationCache(storedData: unknown): ConflictVerificationCache {
  if (!isRecord(storedData)) {
    return {};
  }
  return isRecord(storedData.verificationCache)
    ? storedData.verificationCache as ConflictVerificationCache
    : {};
}

export function getStoredComparisonCache(storedData: unknown): ComparisonCache {
  if (!isRecord(storedData)) {
    return {};
  }
  return isRecord(storedData.comparisonCache)
    ? storedData.comparisonCache as ComparisonCache
    : {};
}

function normalizeRawFolders(rawFolders: unknown, legacyRawFolder: unknown): string[] {
  if (Array.isArray(rawFolders)) {
    const folders = uniqueStrings(rawFolders);
    if (folders.length > 0) {
      return folders;
    }
  }
  if (typeof legacyRawFolder === "string" && legacyRawFolder.trim().length > 0) {
    return [legacyRawFolder.trim()];
  }
  return [...DEFAULT_SETTINGS.rawFolders];
}

function uniqueStrings(values: unknown[]): string[] {
  const output: string[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized.length > 0 && output.indexOf(normalized) < 0) {
        output.push(normalized);
      }
    }
  }
  return output;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
