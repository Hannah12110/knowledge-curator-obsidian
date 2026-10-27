import { App, Notice } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { AnalysisCacheService, ANALYSIS_CACHE_SCHEMA_VERSION } from "../services/analysis-cache-service";
import type { AnalysisService } from "../services/analysis-service";
import type { ConflictVerificationService } from "../services/conflict-verification-service";
import type { KnowledgePRCacheService } from "../services/knowledge-pr-cache-service";
import type { KnowledgePRService } from "../services/knowledge-pr-service";
import type { KnowledgeWriteService } from "../services/knowledge-write-service";
import type { VaultService } from "../services/vault-service";
import type { KnowledgeCuratorSettings } from "../types/settings";
import type { ClaimStoreService } from "../services/claim-store-service";
import type { MaintenanceService } from "../services/maintenance-service";
import type { FreshnessVerificationService } from "../services/freshness-verification-service";
import type { ClaimGraphService } from "../services/claim-graph-service";
import type { CachedSourceAnalysis } from "../types/analysis";
import type { ClaimRecord } from "../types/claim";
import { FreshnessRiskService } from "../services/freshness-risk-service";
import { sha256Text } from "../services/content-hash";
import { configuredWritableWikiRoot, isInsideWritableWikiScope, isSafeVaultFolder } from "../services/write-scope-guard";
import { OneClickAnalysisOrchestrator, WORKFLOW_PROGRESS } from "../product/one-click-analysis-orchestrator";
import {
  mapKnowledgePoints, selectAnalysisTarget, userWorkflowError,
  type ProductArticleResult, type FreshnessDisplay
} from "../product/workflow-presenter";
import { KnowledgeCuratorView, KNOWLEDGE_CURATOR_VIEW_TYPE } from "../views/curator-view";

export class CuratorController {
  private readonly orchestrator = new OneClickAnalysisOrchestrator();
  private readonly results = new Map<string, ProductArticleResult>();
  private readonly states = new Map<string, { status: "analyzing" | "analyzed" | "failed"; modified: number }>();
  private selection = 0;
  private readonly scans = new WeakMap<KnowledgeCuratorView, number>();
  private disposed = false;
  private running = false;

  constructor(
    private readonly app: App,
    private readonly vaultService: VaultService,
    private readonly analysisService: AnalysisService,
    private readonly analysisCacheService: AnalysisCacheService,
    private readonly knowledgePRService: KnowledgePRService,
    private readonly knowledgeWriteService: KnowledgeWriteService,
    private readonly knowledgePRCacheService: KnowledgePRCacheService,
    private readonly conflictVerificationService: ConflictVerificationService,
    private readonly getSettings: () => KnowledgeCuratorSettings,
    private readonly claimStoreService: ClaimStoreService,
    private readonly maintenanceService: MaintenanceService,
    private readonly freshnessVerificationService: FreshnessVerificationService,
    private readonly claimGraphService: ClaimGraphService,
    private readonly verificationCacheService?: import("../services/verification-cache-service").VerificationCacheService
  ) {}

  dispose(): void { this.disposed = true; this.orchestrator.dispose(); }
  isBusy(): boolean { return this.running || this.orchestrator.isBusy(); }

  createView(leaf: WorkspaceLeaf): KnowledgeCuratorView {
    let view: KnowledgeCuratorView;
    view = new KnowledgeCuratorView(leaf, {
      onRefresh: () => this.refreshInbox(view),
      onSelectArticle: (path) => this.selectArticle(path, view),
      onAnalyze: () => { void this.analyze(view); },
      onOpenFile: (path) => { void this.openFile(path); },
      onOpenSettings: () => {
        // Obsidian's setting tab navigation is not part of its public type surface.
        const settings = this.app as unknown as { setting: { open(): void; openTabById(id: string): void } };
        settings.setting.open(); settings.setting.openTabById("knowledge-curator");
      }
    });
    return view;
  }

  openSidebar(): void {
    void this.activateView().catch((error) => { console.error("Knowledge Curator open failed", error); new Notice("无法打开知识整理侧边栏。"); });
  }
  // Retained command now selects the active article instead of opening an engineering inspector.
  openMarkdownFilePicker(): void {
    void this.activateView().then((view) => {
      const file = this.app.workspace.getActiveFile();
      if (file !== null && this.isArticle(file.path)) this.selectArticle(file.path, view);
      else view.showError("请先选择一篇待分析文章");
    });
  }
  refreshSidebarState(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(KNOWLEDGE_CURATOR_VIEW_TYPE)) {
      if (leaf.view instanceof KnowledgeCuratorView) this.refreshInbox(leaf.view);
    }
  }

  private isArticle(path: string): boolean {
    const settings = this.getSettings();
    return isSafeVaultFolder(path) && this.vaultService.getMarkdownFile(path) !== null &&
      (this.vaultService.isInInboxScope(path) || (settings.mode === "normal" && this.vaultService.isInRawScope(path))) && !this.vaultService.isInWikiScope(path);
  }

  private refreshInbox(view: KnowledgeCuratorView): void {
    const request = (this.scans.get(view) ?? 0) + 1;
    this.scans.set(view, request);
    void this.vaultService.scanInbox().then((result) => {
      if (this.disposed || request !== this.scans.get(view)) return;
      if (result.state === "ready") result.items = result.items.map((item) => {
        const state = this.states.get(item.path);
        const cached = this.analysisCacheService.getValid(item.path, item.modified, this.vaultService.getConfiguredRetrievalScope());
        return { ...item, status: state?.modified === item.modified ? state.status : cached === null ? item.status : "analyzed" };
      });
      view.showInbox(result);
    }).catch((error) => { console.error("Knowledge Curator scan failed", error); view.showInboxError("无法读取待处理目录，请检查知识范围设置。"); });
  }

  private selectArticle(path: string, view: KnowledgeCuratorView): void {
    view.selectArticle(path);
    void this.openFile(path);
    const request = ++this.selection;
    const file = this.vaultService.getMarkdownFile(path);
    if (file === null) { view.showError("文章已移动或不存在，请重新选择。"); return; }
    const cached = this.analysisCacheService.getValid(path, file.stat.mtime, this.vaultService.getConfiguredRetrievalScope());
    const result = this.results.get(path);
    if (cached === null) { view.showResult(null); return; }
    if (result !== undefined && result.analysis === cached.analysis) { view.showResult(result); return; }
    const settings = this.getSettings();
    void Promise.all([this.assessFreshness(cached, false), this.verificationCacheService?.listValidForSource({
      sourcePath: path, topic: cached.analysis.topic, conflicts: cached.analysis.conflicts, provider: settings.searchProvider, model: settings.llmModel
    }) ?? Promise.resolve([])]).then(([freshness, verifications]) => {
      if (request !== this.selection || this.disposed) return;
      const pr = this.knowledgePRCacheService.get(path);
      const wikiPath = pr?.status === "accepted" && isInsideWritableWikiScope(pr.target.path, settings.wikiFolder) ? pr.target.path : undefined;
      view.showResult({ sourcePath: path, title: this.vaultService.getDisplayTitle(file), analysis: cached.analysis,
        preferences: { ...this.getSettings().analysisPreferences }, points: this.getSettings().analysisPreferences.extractKnowledge ? mapKnowledgePoints(cached.analysis, path, this.claimStoreService.getClaims(), wikiPath) : [],
        verifications, freshness, graph: this.claimGraphService.getSnapshot(), wikiPath,
        updateMessage: wikiPath === undefined ? "已载入上次文章分析。" : "已载入上次分析；这篇文章已有知识更新记录。", warnings: [] });
    }).catch((error) => { console.error("Knowledge Curator restore failed", error); if (request === this.selection) view.showError("暂时无法读取上次结果，请重新分析。"); });
  }

  private async analyze(view: KnowledgeCuratorView): Promise<void> {
    if (this.isBusy()) return;
    const path = selectAnalysisTarget(this.app.workspace.getActiveFile(), view.getSelectedArticle(), (candidate) => this.isArticle(candidate));
    if (path === null) { view.showError("请先选择一篇待分析文章"); return; }
    this.running = true;
    ++this.selection;
    const settings = structuredClone(this.getSettings());
    const preferences = settings.analysisPreferences;
    const file = this.vaultService.getMarkdownFile(path)!;
    const modified = file.stat.mtime;
    view.selectArticle(path);
    this.states.set(path, { status: "analyzing", modified });
    view.showResult(null);
    view.showProgress(WORKFLOW_PROGRESS.analysis);
    try {
      configuredWritableWikiRoot(settings);
      if (![settings.llmBaseUrl, settings.llmApiKey, settings.llmModel].every((value) => value.trim().length > 0)) {
        throw Object.assign(new Error("AI configuration incomplete"), { code: "missing_configuration" });
      }
      const sourceHash = await sha256Text(await this.vaultService.readMarkdown(file));
      const assertUnchanged = async (): Promise<void> => {
        if (this.disposed) throw Object.assign(new Error("Plugin unloaded"), { code: "cancelled" });
        if (JSON.stringify(settings) !== JSON.stringify(this.getSettings())) throw Object.assign(new Error("Settings changed"), { code: "configuration_changed" });
        const current = this.vaultService.getMarkdownFile(path);
        if (current === null || current.stat.mtime !== modified || await sha256Text(await this.vaultService.readMarkdown(current)) !== sourceHash) {
          throw Object.assign(new Error("Source changed"), { code: "stale_source" });
        }
      };
      const outcome = await this.orchestrator.run({
        prepareIndex: async () => {
          const result = await this.claimStoreService.build({ rebuild: this.claimStoreService.getStats().status === "corrupt" });
          if (result.stats.failedFiles > 0) throw Object.assign(new Error("Incomplete knowledge index"), { code: "index_incomplete" });
          await assertUnchanged();
        },
        analyze: async (progress) => {
          await assertUnchanged();
          const result = await this.analysisService.analyzeSource(file, { allowEmptyStore: true, extractKnowledge: preferences.extractKnowledge,
            onProgress: (stage) => progress(stage === "extract" ? WORKFLOW_PROGRESS.points : WORKFLOW_PROGRESS.comparison) });
          await assertUnchanged();
          const entry: CachedSourceAnalysis = { schemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION, sourcePath: path, sourceModified: modified,
            analyzedAt: new Date().toISOString(), analysis: result.analysis, context: result.context };
          await this.analysisCacheService.set(entry);
          return entry;
        },
        verifyConflicts: async (entry) => settings.searchApiKey.trim().length === 0 ? [] : this.conflictVerificationService.verifyAll(file, entry),
        assessFreshness: (entry) => this.assessFreshness(entry, true),
        previousUpdate: async () => {
          const pr = this.knowledgePRCacheService.get(path);
          if (pr?.status !== "accepted" || pr.sourceFingerprint.hash !== sourceHash || !isInsideWritableWikiScope(pr.target.path, configuredWritableWikiRoot(settings))) return null;
          if (this.vaultService.getMarkdownFile(pr.target.path) === null) throw Object.assign(new Error("Prior updated Wiki missing"), { code: "stale_target" });
          return pr;
        },
        generateUpdate: async (entry, verifications) => {
          await assertUnchanged();
          return (await this.knowledgePRService.generate(file, entry, verifications)).pr;
        },
        assertUnchanged,
        write: (pr, entry, verifications) => this.knowledgeWriteService.accept(pr, entry, verifications),
        refreshIndex: (wikiPath) => this.claimStoreService.reindexWiki(wikiPath),
        buildRelations: async () => {
          await assertUnchanged();
          if (this.claimStoreService.getClaims().length === 0) return { failedPairs: 0 };
          return (await this.claimGraphService.build()).stats;
        },
        log: (error) => console.error("Knowledge Curator optional workflow stage failed", error)
      }, preferences, (message) => { if (!this.disposed) view.showProgress(message); });
      if (this.disposed) return;
      const result: ProductArticleResult = { sourcePath: path, title: this.vaultService.getDisplayTitle(file), analysis: outcome.entry.analysis,
        preferences, points: preferences.extractKnowledge ? mapKnowledgePoints(outcome.entry.analysis, path, this.claimStoreService.getClaims(), outcome.wikiPath) : [],
        verifications: outcome.verifications, freshness: outcome.freshness, graph: this.claimGraphService.getSnapshot(),
        wikiPath: outcome.wikiPath, updateMessage: outcome.updateMessage, warnings: outcome.warnings };
      this.results.set(path, result);
      this.states.set(path, { status: "analyzed", modified });
      view.showResult(result);
    } catch (error) {
      console.error("Knowledge Curator one-click workflow failed", error);
      this.states.set(path, { status: "failed", modified });
      if (!this.disposed) view.showError(userWorkflowError(error), true);
    } finally {
      this.running = false;
      if (!this.disposed) { view.finishProgress(); this.refreshInbox(view); }
    }
  }

  private async assessFreshness(entry: CachedSourceAnalysis, external: boolean): Promise<FreshnessDisplay> {
    const candidates = entry.analysis.claimAnalysis?.candidateClaims ?? [];
    if (candidates.length === 0) return { text: "信息不足", detail: "暂未提取到可供时效性判断的知识点，不能确认内容是否过期。" };
    const risk = new FreshnessRiskService();
    const records = await Promise.all(candidates.map((candidate) => risk.assess({ claim: { ...candidate,
      status: "active", provenance: [], createdAt: entry.analyzedAt, updatedAt: entry.analyzedAt } as ClaimRecord, sourceModified: entry.sourceModified })));
    const risky = records.filter((record) => record.freshnessRisk === "high" || record.freshnessRisk === "critical");
    const settings = this.getSettings();
    let failed = 0;
    const conclusions: string[] = [];
    if (external && settings.searchApiKey.trim().length > 0) {
      await this.maintenanceService.scan();
      const ids = new Set(entry.analysis.claimAnalysis?.comparisons.flatMap((item) => item.existingClaimId === undefined ? [] : [item.existingClaimId]) ?? []);
      const relevant = this.maintenanceService.getSnapshot().items.filter((item) => ids.has(item.claim.id) && ["high", "critical"].includes(item.record.freshnessRisk)).slice(0, 3);
      for (const item of relevant) {
        try { const verified = await this.freshnessVerificationService.verify(item.claim.id, false); conclusions.push(verified.result.conclusion); }
        catch (error) { console.error("Knowledge Curator external freshness check failed", error); failed++; }
      }
    }
    return { text: risky.length > 0 ? `${risky.length} 个知识点需关注` : "未发现明显风险",
      detail: `当前文章采用本地风险判断，不代表事实已经外部证实。${conclusions.length > 0 ? `相关已有知识的外部核验结论：${conclusions.join("；")}。` : "本次未完成外部时效核验。"}${failed > 0 ? "部分外部核验失败。" : ""}` };
  }

  private async openFile(path: string): Promise<void> {
    const file = this.vaultService.getMarkdownFile(path);
    if (file === null) { new Notice("文档已移动或不存在。"); return; }
    await this.app.workspace.getLeaf(false).openFile(file);
  }
  private async activateView(): Promise<KnowledgeCuratorView> {
    let leaf = this.app.workspace.getLeavesOfType(KNOWLEDGE_CURATOR_VIEW_TYPE)[0] ?? this.app.workspace.getRightLeaf(false);
    if (leaf === null) throw new Error("Cannot create sidebar");
    if (!(leaf.view instanceof KnowledgeCuratorView)) await leaf.setViewState({ type: KNOWLEDGE_CURATOR_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view as KnowledgeCuratorView;
  }
}
