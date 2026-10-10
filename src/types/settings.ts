export type KnowledgeCuratorMode = "test" | "production-preview";
export type ClaimComparisonMode = "legacy" | "claim";

export interface KnowledgeCuratorSettings {
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
  mode: "test",
  claimComparisonMode: "claim",
  claimRetrievalTopK: 5,
  inboxFolder: "inbox",
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
