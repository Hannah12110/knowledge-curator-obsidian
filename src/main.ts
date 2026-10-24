import { Notice, Plugin } from "obsidian";
import { CuratorController } from "./controllers/curator-controller";
import { AnalysisCacheService } from "./services/analysis-cache-service";
import { AnalysisService } from "./services/analysis-service";
import { ClaimExtractionService } from "./services/claim-extraction-service";
import { ClaimStoreRepository } from "./services/claim-store-repository";
import { ClaimStoreService } from "./services/claim-store-service";
import { ClaimGraphRepository } from "./services/claim-graph-repository";
import { ClaimGraphCandidateService } from "./services/claim-graph-candidate-service";
import { ClaimGraphRelationService } from "./services/claim-graph-relation-service";
import { ClaimGraphService } from "./services/claim-graph-service";
import { ClaimEvolutionService } from "./services/claim-evolution-service";
import { KnowledgeCompressionService } from "./services/knowledge-compression-service";
import { ClaimRetrievalService } from "./services/claim-retrieval-service";
import { ClaimComparisonService } from "./services/claim-comparison-service";
import { ComparisonCacheService } from "./services/comparison-cache-service";
import { ConflictVerificationService } from "./services/conflict-verification-service";
import { HistoryService } from "./services/history-service";
import { ObsidianKnowledgeFileStore } from "./services/knowledge-file-store";
import { KnowledgePRCacheService } from "./services/knowledge-pr-cache-service";
import { KnowledgePRService } from "./services/knowledge-pr-service";
import { KnowledgeWriteService } from "./services/knowledge-write-service";
import { FreshnessRiskService } from "./services/freshness-risk-service";
import { FreshnessVerificationService } from "./services/freshness-verification-service";
import { MaintenancePRService } from "./services/maintenance-pr-service";
import { MaintenanceService } from "./services/maintenance-service";
import { MaintenanceStoreRepository } from "./services/maintenance-store-repository";
import { LlmService } from "./services/llm-service";
import { RetrievalService } from "./services/retrieval-service";
import { TavilySearchProvider } from "./services/search-provider";
import {
  getSidebarRestoreStorageKey,
  rememberSidebarOpenState,
  shouldRestoreSidebar
} from "./services/sidebar-restore-state";
import {
  getStoredAnalysisCache,
  getStoredComparisonCache,
  getStoredKnowledgePRCache,
  getStoredVerificationCache,
  migrateSettings
} from "./services/settings-migration";
import { VerificationCacheService } from "./services/verification-cache-service";
import { VaultService } from "./services/vault-service";
import { KnowledgeCuratorSettingTab } from "./settings";
import { DEFAULT_SETTINGS } from "./types/settings";
import type { AnalysisCache } from "./types/analysis";
import type { ComparisonCache } from "./types/comparison-cache";
import type { KnowledgePRCache } from "./types/knowledge-pr";
import type { ConflictVerificationCache } from "./types/verification";
import type { KnowledgeCuratorSettings } from "./types/settings";
import {
  KNOWLEDGE_CURATOR_VIEW_TYPE
} from "./views/curator-view";

export default class KnowledgeCuratorPlugin extends Plugin {
  settings: KnowledgeCuratorSettings = DEFAULT_SETTINGS;
  private curatorController: CuratorController | null = null;
  private analysisCache: AnalysisCache = {};
  private knowledgePRCache: KnowledgePRCache = {};
  private verificationCache: ConflictVerificationCache = {};
  private comparisonCache: ComparisonCache = {};
  private analysisCacheService: AnalysisCacheService | null = null;
  private knowledgePRCacheService: KnowledgePRCacheService | null = null;
  private verificationCacheService: VerificationCacheService | null = null;
  private comparisonCacheService: ComparisonCacheService | null = null;
  private historyService: HistoryService | null = null;
  private claimStoreService: ClaimStoreService | null = null;
  private claimGraphService: ClaimGraphService | null = null;
  private maintenanceService: MaintenanceService | null = null;
  private sidebarRestoreStorageKey = "";
  private persistQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    await this.loadSettings();
    const vaultService = new VaultService(
      this.app.vault,
      this.app.metadataCache,
      () => this.settings
    );
    const retrievalService = new RetrievalService(
      vaultService,
      () => this.settings
    );
    const llmService = new LlmService(() => this.settings);
    const claimExtractionService = new ClaimExtractionService(llmService);
    const claimStoreService = new ClaimStoreService(
      vaultService,
      claimExtractionService,
      new ClaimStoreRepository(this.app.vault)
    );
    await claimStoreService.initialize();
    this.claimStoreService = claimStoreService;
    this.register(() => claimStoreService.cancelBuild());
    this.register(claimStoreService.subscribe(() => this.curatorController?.refreshSidebarState()));
    const maintenanceService = new MaintenanceService(
      claimStoreService,
      vaultService,
      new FreshnessRiskService(),
      new MaintenanceStoreRepository(this.app.vault)
    );
    await maintenanceService.initialize();
    this.maintenanceService = maintenanceService;
    this.register(maintenanceService.subscribe(() => this.curatorController?.refreshSidebarState()));
    const claimRetrievalService = new ClaimRetrievalService(
      () => claimStoreService.getClaims()
    );
    const comparisonCacheService = new ComparisonCacheService(
      this.comparisonCache,
      async (cache) => {
        this.comparisonCache = cache;
        await this.persistPluginData();
      }
    );
    this.comparisonCacheService = comparisonCacheService;
    const claimComparisonService = new ClaimComparisonService(
      llmService,
      (id) => claimStoreService.getClaims().find((claim) => claim.id === id),
      {
        cache: comparisonCacheService,
        getProviderContext: () => ({
          provider: getProviderIdentity(this.settings.llmBaseUrl),
          model: this.settings.llmModel
        })
      }
    );
    const analysisService = new AnalysisService(
      vaultService,
      retrievalService,
      llmService,
      claimExtractionService,
      claimRetrievalService,
      claimComparisonService,
      claimStoreService,
      () => this.settings
    );
    const analysisCacheService = new AnalysisCacheService(
      this.analysisCache,
      async (cache) => {
        this.analysisCache = cache;
        await this.persistPluginData();
      }
    );
    this.analysisCacheService = analysisCacheService;
    const knowledgePRCacheService = new KnowledgePRCacheService(
      this.knowledgePRCache,
      async (cache) => {
        this.knowledgePRCache = cache;
        await this.persistPluginData();
      }
    );
    this.knowledgePRCacheService = knowledgePRCacheService;
    const verificationCacheService = new VerificationCacheService(
      this.verificationCache,
      async (cache) => {
        this.verificationCache = cache;
        await this.persistPluginData();
      }
    );
    this.verificationCacheService = verificationCacheService;
    const knowledgePRService = new KnowledgePRService(
      vaultService,
      llmService,
      knowledgePRCacheService
    );
    const searchProvider = new TavilySearchProvider(() => this.settings);
    const conflictVerificationService = new ConflictVerificationService(
      vaultService,
      searchProvider,
      llmService,
      verificationCacheService,
      knowledgePRCacheService,
      () => this.settings.llmModel,
      () => this.settings.maxSearchResults
    );
    const claimGraphService = new ClaimGraphService(
      claimStoreService,
      new ClaimGraphRepository(this.app.vault),
      new ClaimGraphCandidateService(),
      new ClaimGraphRelationService(llmService),
      new ClaimEvolutionService(),
      new KnowledgeCompressionService()
    );
    await claimGraphService.initialize();
    this.claimGraphService = claimGraphService;
    this.register(claimGraphService.subscribe(() => this.curatorController?.refreshSidebarState()));
    const freshnessVerificationService = new FreshnessVerificationService(
      searchProvider,
      llmService,
      maintenanceService,
      () => this.settings.llmModel,
      () => this.settings.maxSearchResults
    );
    const maintenancePRService = new MaintenancePRService(
      vaultService,
      llmService,
      knowledgePRCacheService
    );
    const knowledgeFileStore = new ObsidianKnowledgeFileStore(this.app.vault);
    const historyService = new HistoryService(knowledgeFileStore);
    this.historyService = historyService;
    const knowledgeWriteService = new KnowledgeWriteService(
      knowledgeFileStore,
      historyService,
      knowledgePRCacheService,
      () => this.settings.mode,
      {
        reindexWiki: async (path) => claimStoreService.reindexWiki(path)
      }
    );
    const curatorController = new CuratorController(
      this.app,
      vaultService,
      analysisService,
      analysisCacheService,
      knowledgePRService,
      knowledgeWriteService,
      knowledgePRCacheService,
      conflictVerificationService,
      verificationCacheService,
      () => this.settings,
      claimStoreService,
      maintenanceService,
      freshnessVerificationService,
      maintenancePRService,
      claimGraphService
    );
    this.curatorController = curatorController;
    this.sidebarRestoreStorageKey = getSidebarRestoreStorageKey(
      this.app.vault.getName()
    );

    this.registerView(
      KNOWLEDGE_CURATOR_VIEW_TYPE,
      (leaf) => curatorController.createView(leaf)
    );

    this.addRibbonIcon("library-big", "打开 Knowledge Curator", () => {
      this.curatorController?.openSidebar();
    });

    this.addCommand({
      id: "open-knowledge-curator-sidebar",
      name: "打开侧边栏",
      callback: () => {
        this.curatorController?.openSidebar();
      }
    });

    this.addCommand({
      id: "inspect-markdown-file",
      name: "检查 Markdown 文件",
      callback: () => this.curatorController?.openMarkdownFilePicker()
    });

    this.addSettingTab(new KnowledgeCuratorSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (
        this.curatorController !== null &&
        shouldRestoreSidebar(
          globalThis.sessionStorage,
          this.sidebarRestoreStorageKey
        )
      ) {
        this.curatorController.openSidebar();
      }
    });
  }

  onunload(): void {
    const sidebarWasOpen = this.app.workspace
      .getLeavesOfType(KNOWLEDGE_CURATOR_VIEW_TYPE)
      .length > 0;
    const stateRecorded = rememberSidebarOpenState(
      globalThis.sessionStorage,
      this.sidebarRestoreStorageKey,
      sidebarWasOpen
    );
    if (!stateRecorded) {
      console.warn("Knowledge Curator could not remember Sidebar state for reload.");
    }
    this.curatorController = null;
    this.analysisCacheService = null;
    this.knowledgePRCacheService = null;
    this.verificationCacheService = null;
    this.comparisonCacheService = null;
    this.historyService = null;
    this.claimStoreService = null;
    this.claimGraphService = null;
    this.maintenanceService = null;
  }

  async loadSettings(): Promise<void> {
    try {
      const storedData = await this.loadData() as unknown;
      this.settings = migrateSettings(storedData);
      this.analysisCache = getStoredAnalysisCache(storedData);
      this.knowledgePRCache = getStoredKnowledgePRCache(storedData);
      this.verificationCache = getStoredVerificationCache(storedData);
      this.comparisonCache = getStoredComparisonCache(storedData);
    } catch (error: unknown) {
      console.error("Knowledge Curator could not load settings.", error);
      this.settings = { ...DEFAULT_SETTINGS };
      this.analysisCache = {};
      this.knowledgePRCache = {};
      this.verificationCache = {};
      this.comparisonCache = {};
      new Notice("Knowledge Curator 无法读取已保存设置，当前使用默认值。");
    }
  }

  async saveSettings(): Promise<void> {
    try {
      await this.persistPluginData();
    } catch (error: unknown) {
      console.error("Knowledge Curator could not save settings.", error);
      new Notice("Knowledge Curator 无法保存设置。");
    }
  }

  async clearAnalysisCache(): Promise<void> {
    await this.requireService(this.analysisCacheService, "分析缓存").clear();
    this.curatorController?.refreshSidebarState();
  }

  async clearVerificationCache(): Promise<void> {
    await this.requireService(this.verificationCacheService, "冲突验证缓存").clear();
    this.curatorController?.refreshSidebarState();
  }

  async clearComparisonCache(): Promise<number> {
    const removed = await this.requireService(this.comparisonCacheService, "Claim Comparison 缓存").clear();
    this.curatorController?.refreshSidebarState();
    return removed;
  }

  async clearDraftPRCache(): Promise<number> {
    const removed = await this.requireService(this.knowledgePRCacheService, "Knowledge PR 缓存").clearDrafts();
    this.curatorController?.refreshSidebarState();
    return removed;
  }

  async getHistoryCount(): Promise<number> {
    return await this.requireService(this.historyService, "History").count();
  }

  getMaintenanceStats() {
    return this.requireService(this.maintenanceService, "知识维护").getStats();
  }

  async scanFreshnessRisk() {
    const result = await this.requireService(this.maintenanceService, "知识维护").scan();
    this.curatorController?.refreshSidebarState();
    return result;
  }

  async clearFreshnessVerificationCache(): Promise<number> {
    const removed = await this.requireService(this.maintenanceService, "知识维护").clearVerificationCache();
    this.curatorController?.refreshSidebarState();
    return removed;
  }

  getClaimStoreStats() {
    return this.requireService(this.claimStoreService, "Claim Store").getStats();
  }

  getClaimGraphStats() {
    return this.requireService(this.claimGraphService, "Claim Graph").getStats();
  }

  async buildClaimGraph() {
    const result = await this.requireService(this.claimGraphService, "Claim Graph").build();
    this.curatorController?.refreshSidebarState();
    return result;
  }

  async buildClaimStore(rebuild: boolean, retryFailedOnly = false) {
    const result = await this.requireService(this.claimStoreService, "Claim Store")
      .build({ rebuild, retryFailedOnly });
    this.curatorController?.refreshSidebarState();
    return result;
  }

  cancelClaimStoreBuild(): void {
    this.claimStoreService?.cancelBuild();
  }

  refreshSidebarState(): void {
    this.curatorController?.refreshSidebarState();
  }

  private requireService<T>(service: T | null, name: string): T {
    if (service === null) {
      throw new Error(`${name}服务尚未初始化。`);
    }
    return service;
  }

  private async persistPluginData(): Promise<void> {
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(async () => this.saveData({
        ...this.settings,
        analysisCache: this.analysisCache,
        knowledgePRCache: this.knowledgePRCache,
        verificationCache: this.verificationCache,
        comparisonCache: this.comparisonCache
      }));
    await this.persistQueue;
  }
}

function getProviderIdentity(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).hostname.toLowerCase() || "openai-compatible";
  } catch {
    return "openai-compatible";
  }
}
