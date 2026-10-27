export type KnowledgeCuratorMode = "normal" | "test" | "production-preview";
export type ClaimComparisonMode = "legacy" | "claim";

export interface AnalysisPreferences {
  quality: boolean;
  conflicts: boolean;
  duplicates: boolean;
  freshness: boolean;
  extractKnowledge: boolean;
  updateWiki: boolean;
  generateRelations: boolean;
}

export const DEFAULT_ANALYSIS_PREFERENCES: AnalysisPreferences = {
  quality: true, conflicts: true, duplicates: true, freshness: true,
  extractKnowledge: true, updateWiki: true, generateRelations: true
};

export interface KnowledgeCuratorSettings {
  analysisPreferences: AnalysisPreferences;
  mode: KnowledgeCuratorMode;
  claimComparisonMode: ClaimComparisonMode;
  claimRetrievalTopK: number;
  inboxFolder: string;
  rawFolders: string[];
  wikiFolder: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  maxRelatedNotes: number;
  searchProvider: "tavily";
  searchApiKey: string;
  maxSearchResults: number;
}

export const DEFAULT_SETTINGS: KnowledgeCuratorSettings = {
  mode: "normal",
  analysisPreferences: { ...DEFAULT_ANALYSIS_PREFERENCES },
  claimComparisonMode: "claim",
  claimRetrievalTopK: 5,
  inboxFolder: "raw",
  rawFolders: ["raw"],
  wikiFolder: "wiki",
  llmBaseUrl: "",
  llmApiKey: "",
  llmModel: "",
  maxRelatedNotes: 8,
  searchProvider: "tavily",
  searchApiKey: "",
  maxSearchResults: 5
};

export interface LegacyKnowledgeCuratorSettings {
  rawFolder?: unknown;
}
