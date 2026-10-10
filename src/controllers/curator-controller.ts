import { App, Notice } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import { AnalysisCacheService } from "../services/analysis-cache-service";
import { ANALYSIS_CACHE_SCHEMA_VERSION } from "../services/analysis-cache-service";
import { AnalysisService } from "../services/analysis-service";
import { ConflictVerificationService } from "../services/conflict-verification-service";
import { KnowledgePRCacheService } from "../services/knowledge-pr-cache-service";
import { KnowledgePRService } from "../services/knowledge-pr-service";
import { KnowledgeWriteService } from "../services/knowledge-write-service";
import { VerificationCacheService } from "../services/verification-cache-service";
import { VaultService } from "../services/vault-service";
import type { SourceAnalysis } from "../types/source-analysis";
import type { ClaimAnalysisContextSnapshot } from "../types/analysis";
import { CLAIM_RETRIEVAL_VERSION } from "../services/claim-retrieval-service";
import { CLAIM_COMPARISON_VERSION } from "../services/claim-comparison-service";
import type { KnowledgeCuratorSettings } from "../types/settings";
import type { CachedConflictVerification } from "../types/verification";
import { createCuratorError } from "../types/errors";
import { deriveWorkflowState } from "../types/workflow";
import {
  KnowledgeCuratorView,
  KNOWLEDGE_CURATOR_VIEW_TYPE
} from "../views/curator-view";
import { MarkdownFileSuggestModal } from "../views/markdown-file-suggest-modal";
import { ConfirmActionModal } from "../views/confirm-action-modal";
import { ClaimStoreService } from "../services/claim-store-service";
import { MaintenanceService } from "../services/maintenance-service";
import { FreshnessVerificationService } from "../services/freshness-verification-service";
import { MaintenancePRService } from "../services/maintenance-pr-service";
import { ClaimGraphService } from "../services/claim-graph-service";

export class CuratorController {
  private readonly analysisStates = new Map<string, RuntimeAnalysisState>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly vaultService: VaultService,
    private readonly analysisService: AnalysisService,
    private readonly analysisCacheService: AnalysisCacheService,
    private readonly knowledgePRService: KnowledgePRService,
    private readonly knowledgeWriteService: KnowledgeWriteService,
    private readonly knowledgePRCacheService: KnowledgePRCacheService,
    private readonly conflictVerificationService: ConflictVerificationService,
    private readonly verificationCacheService: VerificationCacheService,
    private readonly getSettings: () => KnowledgeCuratorSettings,
    private readonly claimStoreService: ClaimStoreService,
    private readonly maintenanceService: MaintenanceService,
    private readonly freshnessVerificationService: FreshnessVerificationService,
    private readonly maintenancePRService: MaintenancePRService,
    private readonly claimGraphService: ClaimGraphService
  ) {}

  createView(leaf: WorkspaceLeaf): KnowledgeCuratorView {
    let view: KnowledgeCuratorView;
    view = new KnowledgeCuratorView(leaf, {
      onRefresh: () => this.refreshInbox(view),
      onOpenFile: (path) => this.openInboxFile(path),
      onAnalyze: (path) => this.analyzeInboxFile(path),
      onViewAnalysis: (path) => this.showCachedAnalysis(path),
      onReanalyze: (path) => this.analyzeInboxFile(path),
      onGenerateKnowledgePR: (path) => this.generateKnowledgePR(path),
      onViewKnowledgePR: (path) => this.showCachedKnowledgePR(path),
      onVerifyConflicts: (path) => this.verifyConflicts(path),
      onAcceptKnowledgePR: (sourcePath, prId) => this.acceptKnowledgePR(sourcePath, prId),
      onRejectKnowledgePR: (sourcePath, prId) => this.rejectKnowledgePR(sourcePath, prId),
      onOpenExternalSource: (url) => this.openExternalSource(url),
      getMode: () => this.getSettings().mode,
      getClaimStoreStats: () => this.claimStoreService.getStats(),
      getMaintenanceSnapshot: (filter) => this.maintenanceService.getSnapshot(filter),
      onScanFreshness: () => this.scanFreshnessRisk(),
      onVerifyFreshness: (claimId, forceRefresh) => this.verifyFreshness(claimId, forceRefresh),
      onGenerateMaintenancePR: (claimId) => this.generateMaintenancePR(claimId)
      ,
      getClaimGraphSnapshot: () => this.claimGraphService.getSnapshot(),
      getClaimGraphNeighbors: (claimId) => this.claimGraphService.getNeighbors(claimId),
      getCompressionProposals: () => this.claimGraphService.getCompressionProposals(),
      onBuildClaimGraph: () => this.buildClaimGraph(),
      onVerifyGraphConflict: (edgeId) => this.verifyGraphConflict(edgeId)
    });
    return view;
  }

  private buildClaimGraph(): void {
    const operationKey = "claim-graph:build";
    if (!this.beginOperation(operationKey)) return;
    this.getOpenView()?.showClaimGraph("build");
    void this.claimGraphService.build()
      .then((result) => {
        this.endOperation(operationKey);
        this.getOpenView()?.showClaimGraph();
        new Notice(`知识关系构建完成：${result.stats.totalRelations} 条关系，${result.stats.conflicts} 条冲突。`);
      })
      .catch((error: unknown) => {
        this.endOperation(operationKey);
        const message = createCuratorError("analysis", error, "知识关系构建失败，请重试。").message;
        console.error("Knowledge Curator Claim Graph build failed.", error);
        this.getOpenView()?.showClaimGraph(null, message);
      });
  }

  private verifyGraphConflict(edgeId: string): void {
    const snapshot = this.claimGraphService.getSnapshot();
    const edge = snapshot.edges.find((item) => item.id === edgeId && item.relation === "contradicts");
    if (edge === undefined) {
      new Notice("未找到可验证的冲突关系。");
      return;
    }
    const from = snapshot.nodes.find((node) => node.claimId === edge.fromClaimId);
    const to = snapshot.nodes.find((node) => node.claimId === edge.toClaimId);
    if (from === undefined || to === undefined) {
      new Notice("冲突关系引用的 Claim 已不存在，请重建 Claim Graph。");
      return;
    }
    const operationKey = `claim-graph:verify:${edgeId}`;
    if (!this.beginOperation(operationKey)) return;
    this.getOpenView()?.showClaimGraph(`verify:${edgeId}`);
    void this.conflictVerificationService.verifyClaimGraphConflict({
      topic: from.topic ?? to.topic ?? "Knowledge Graph",
      existingClaim: to.statement,
      existingFile: to.sourcePath,
      challengedClaim: from.statement,
      challengedFile: from.sourcePath,
      confidence: edge.confidence
    }).then((result) => {
      this.endOperation(operationKey);
      this.getOpenView()?.showClaimGraph(null, null, `${result.result.resolution} · ${result.result.conclusion}`);
      new Notice("知识关系冲突已通过 Phase 4 外部证据链验证；未修改 Wiki。");
    }).catch((error: unknown) => {
      this.endOperation(operationKey);
      const message = createCuratorError("verification", error, "知识关系冲突验证失败。").message;
      console.error("Knowledge Curator graph conflict verification failed.", error);
      this.getOpenView()?.showClaimGraph(null, message);
    });
  }

  openSidebar(): void {
    void this.activateView().catch((error: unknown) => {
      this.reportError("无法打开 Knowledge Curator 侧边栏。", error);
    });
  }

  refreshSidebarState(): void {
    this.refreshOpenView();
  }

  openMarkdownFilePicker(): void {
    const files = this.vaultService.getMarkdownFiles();
    if (files.length === 0) {
      new Notice("当前 Vault 中没有 Markdown 文件。");
      return;
    }

    new MarkdownFileSuggestModal(this.app, files, (file) => {
      void this.inspectFile(file);
    }).open();
  }

  private refreshInbox(view: KnowledgeCuratorView): void {
    view.showInboxLoading();

    void this.vaultService.scanInbox()
      .then((result) => view.showInbox(this.decorateAnalysisStates(result)))
      .catch((error: unknown) => {
        console.error("Knowledge Curator could not scan the Inbox.", error);
        view.showInboxError("无法扫描当前配置的待处理目录。");
      });
  }

  private analyzeInboxFile(path: string): void {
    if (this.analysisStates.get(path)?.status === "analyzing") {
      return;
    }
    const file = this.vaultService.getMarkdownFile(path);
    if (file === null) {
      new Notice("文件已不存在或已被移动。");
      this.refreshOpenView();
      return;
    }

    this.analysisStates.set(path, {
      status: "analyzing",
      modified: file.stat.mtime
    });
    this.refreshOpenView();

    void this.analysisService.analyzeSource(file)
      .then(async (result) => {
        this.analysisStates.set(path, {
          status: "analyzed",
          modified: file.stat.mtime,
          analysis: result.analysis,
          claimContext: result.context.claimContext
        });
        try {
          await this.analysisCacheService.set({
            schemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION,
            sourcePath: path,
            sourceModified: file.stat.mtime,
            analyzedAt: new Date().toISOString(),
            analysis: result.analysis,
            context: result.context
          });
        } catch (error: unknown) {
          console.error("Knowledge Curator could not cache analysis.", error);
          new Notice("分析已完成，但结果缓存失败。下次可能需要重新分析。");
        }

        const view = this.getOpenView();
        view?.showAnalysis(
          path,
          this.vaultService.getDisplayTitle(file),
          result.analysis,
          this.knowledgePRCacheService.get(path),
          []
        );
        this.refreshOpenView();
      })
      .catch((error: unknown) => {
        const curatorError = createCuratorError("analysis", error, "分析失败，请稍后重试。");
        const message = curatorError.message;
        console.error("Knowledge Curator source analysis failed.", error);
        this.analysisStates.set(path, {
          status: "failed",
          modified: file.stat.mtime,
          error: message
        });
        new Notice(message);
        this.refreshOpenView();
      });
  }

  private showCachedAnalysis(path: string): void {
    const file = this.vaultService.getMarkdownFile(path);
    if (file === null) {
      new Notice("文件已不存在或已被移动。");
      this.refreshOpenView();
      return;
    }
    const runtimeState = this.analysisStates.get(path);
    const runtimeMatches = runtimeState?.modified === file.stat.mtime &&
      claimContextsEqual(runtimeState.claimContext, this.getCurrentClaimContext());
    const runtimeAnalysis = runtimeMatches && runtimeState?.status === "analyzed"
      ? runtimeState.analysis
      : undefined;
    const cachedAnalysis = this.analysisCacheService.getAnalysis(
      path,
      file.stat.mtime,
      this.vaultService.getConfiguredRetrievalScope(),
      this.getCurrentClaimContext()
    );
    const analysis = runtimeAnalysis ?? cachedAnalysis;
    console.debug("[Knowledge Curator] cache lookup", {
      sourcePath: path,
      found: cachedAnalysis !== null
    });
    console.debug("[Knowledge Curator] analysis status", {
      sourcePath: path,
      runtimeStatus: runtimeState?.status ?? "none",
      runtimeMtimeMatches: runtimeMatches,
      analysisFound: analysis !== null && analysis !== undefined
    });
    if (analysis === undefined || analysis === null) {
      this.analysisStates.delete(path);
      new Notice("未找到有效的分析结果，请重新分析该文章。");
      this.refreshOpenView();
      return;
    }
    const view = this.getOpenView();
    if (view === null) {
      new Notice("无法打开分析详情，请重新打开 Knowledge Curator 侧边栏。");
      return;
    }
    void this.getValidVerifications(path, analysis)
      .then((verifications) => {
        const activeView = this.getOpenView();
        if (activeView !== null) {
          activeView.showAnalysis(
            path,
            this.vaultService.getDisplayTitle(file),
            analysis,
            this.knowledgePRCacheService.get(path),
            verifications
          );
        }
      })
      .catch((error: unknown) => {
        console.error("Knowledge Curator could not restore conflict verification cache.", error);
        this.getOpenView()?.showAnalysis(
          path,
          this.vaultService.getDisplayTitle(file),
          analysis,
          this.knowledgePRCacheService.get(path),
          []
        );
      });
  }

  private verifyConflicts(path: string): void {
    const operationKey = `verify:${path}`;
    if (!this.beginOperation(operationKey)) {
      return;
    }
    const file = this.vaultService.getMarkdownFile(path);
    if (file === null) {
      this.endOperation(operationKey);
      new Notice("文件已不存在或已被移动。");
      return;
    }
    const analysisEntry = this.analysisCacheService.getValid(
      path,
      file.stat.mtime,
      this.vaultService.getConfiguredRetrievalScope(),
      this.getCurrentClaimContext()
    );
    if (analysisEntry === null) {
      this.endOperation(operationKey);
      new Notice("未找到有效的 Phase 2 分析，请先重新分析文章。");
      return;
    }
    if (analysisEntry.analysis.conflicts.length === 0) {
      this.endOperation(operationKey);
      new Notice("当前文章没有需要验证的冲突，不会发起外部搜索。");
      return;
    }
    this.getOpenView()?.showConflictVerificationLoading();
    void this.conflictVerificationService.verifyAll(file, analysisEntry)
      .then((verifications) => {
        this.endOperation(operationKey);
        this.getOpenView()?.showAnalysis(
          path,
          this.vaultService.getDisplayTitle(file),
          analysisEntry.analysis,
          this.knowledgePRCacheService.get(path),
          verifications
        );
        new Notice("冲突验证完成。已有 draft Knowledge PR 已标记为失效。");
      })
      .catch((error: unknown) => {
        this.endOperation(operationKey);
        const curatorError = createCuratorError(
          "verification",
          error,
          "冲突验证失败，请稍后重试。"
        );
        const message = curatorError.message;
        console.error("Knowledge Curator conflict verification failed.", error);
        this.getOpenView()?.showConflictVerificationError(message);
        new Notice(message);
      });
  }

  private generateKnowledgePR(path: string): void {
    const operationKey = `pr:${path}`;
    if (!this.beginOperation(operationKey)) {
      return;
    }
    const file = this.vaultService.getMarkdownFile(path);
    if (file === null) {
      this.endOperation(operationKey);
      new Notice("文件已不存在或已被移动。");
      return;
    }
    const analysisEntry = this.analysisCacheService.getValid(
      path,
      file.stat.mtime,
      this.vaultService.getConfiguredRetrievalScope(),
      this.getCurrentClaimContext()
    );
    if (analysisEntry === null) {
      this.endOperation(operationKey);
      new Notice("未找到有效的 Phase 2 分析，请先重新分析文章。");
      return;
    }
    const view = this.getOpenView();
    view?.showKnowledgePRLoading();
    void this.getValidVerifications(path, analysisEntry.analysis)
      .then((verifications) => this.knowledgePRService.generate(
        file,
        analysisEntry,
        verifications
      ))
      .then((result) => {
        this.endOperation(operationKey);
        const activeView = this.getOpenView();
        activeView?.showKnowledgePR(
          this.vaultService.getDisplayTitle(file),
          result.pr
        );
      })
      .catch((error: unknown) => {
        this.endOperation(operationKey);
        const curatorError = createCuratorError(
          "pr",
          error,
          "生成知识更新建议失败，请稍后重试。"
        );
        const message = curatorError.message;
        console.error("Knowledge Curator Knowledge PR generation failed.", error);
        this.getOpenView()?.showKnowledgePRError(message);
        new Notice(message);
      });
  }

  private showCachedKnowledgePR(path: string): void {
    const pr = this.knowledgePRCacheService.get(path);
    const file = this.vaultService.getMarkdownFile(path);
    if (pr === null || file === null) {
      new Notice("未找到当前 Knowledge PR，请重新生成。");
      this.refreshOpenView();
      return;
    }
    this.getOpenView()?.showKnowledgePR(this.vaultService.getDisplayTitle(file), pr);
  }

  private scanFreshnessRisk(): void {
    const operationKey = "freshness:scan";
    if (!this.beginOperation(operationKey)) return;
    void this.maintenanceService.scan()
      .then((result) => {
        this.endOperation(operationKey);
        this.getOpenView()?.showMaintenance();
        new Notice(`知识时效风险扫描完成：${result.stats.totalClaims} Claims，未发起网络请求。`);
      })
      .catch((error: unknown) => {
        this.endOperation(operationKey);
        const message = createCuratorError("freshness_scan", error, "知识时效风险扫描失败。").message;
        console.error("Knowledge Curator freshness scan failed.", error);
        this.getOpenView()?.showMaintenance(null, message);
      });
  }

  private verifyFreshness(claimId: string, forceRefresh: boolean): void {
    const operationKey = `freshness:verify:${claimId}`;
    if (!this.beginOperation(operationKey)) return;
    void this.freshnessVerificationService.verify(claimId, forceRefresh)
      .then((entry) => {
        this.endOperation(operationKey);
        this.getOpenView()?.showMaintenance();
        new Notice(`知识时效验证完成：${freshnessResolutionText(entry.result.resolution)}。`);
      })
      .catch((error: unknown) => {
        this.endOperation(operationKey);
        const message = createCuratorError("freshness_verification", error, "知识时效验证失败，请稍后重试。").message;
        console.error("Knowledge Curator freshness verification failed.", error);
        this.getOpenView()?.showMaintenance(null, message);
        new Notice(message);
      });
  }

  private generateMaintenancePR(claimId: string): void {
    const operationKey = `maintenance:pr:${claimId}`;
    if (!this.beginOperation(operationKey)) return;
    const claim = this.maintenanceService.getClaim(claimId);
    const record = this.maintenanceService.getRecord(claimId);
    const verification = record?.latestVerificationId === undefined
      ? null
      : this.maintenanceService.getVerification(record.latestVerificationId);
    if (claim === null || verification === null) {
      this.endOperation(operationKey);
      this.getOpenView()?.showMaintenance(null, "请先完成该 Claim 的外部验证。");
      return;
    }
    void this.maintenancePRService.generate(claim, verification)
      .then((pr) => {
        this.endOperation(operationKey);
        this.getOpenView()?.showKnowledgePR(claim.statement, pr);
      })
      .catch((error: unknown) => {
        this.endOperation(operationKey);
        const message = createCuratorError("maintenance_pr", error, "生成知识维护建议失败。").message;
        console.error("Knowledge Curator Maintenance PR generation failed.", error);
        this.getOpenView()?.showMaintenance(null, message);
        new Notice(message);
      });
  }

  private acceptKnowledgePR(sourcePath: string, prId: string): void {
    if (this.getSettings().mode !== "test") {
      new Notice("正式知识库写入尚未开放。");
      return;
    }
    const pr = this.knowledgePRCacheService.get(sourcePath);
    if (pr === null || pr.id !== prId) {
      return;
    }
    new ConfirmActionModal(this.app, {
      title: "确认接受知识更新",
      message: `确认接受这次知识更新？\n目标 Wiki：${pr.target.path}\n当前模式：测试模式`,
      confirmText: "确认接受",
      onConfirm: () => this.executeAcceptKnowledgePR(sourcePath, prId)
    }).open();
  }

  private executeAcceptKnowledgePR(sourcePath: string, prId: string): void {
    const operationKey = `accept:${prId}`;
    if (!this.beginOperation(operationKey)) {
      return;
    }
    const cachedPR = this.knowledgePRCacheService.get(sourcePath);
    if (cachedPR?.origin === "maintenance") {
      const context = cachedPR.maintenanceContext;
      const verification = context === undefined ? null : this.maintenanceService.getVerification(context.verificationId);
      if (cachedPR.id !== prId || context === undefined || verification === null) {
        this.endOperation(operationKey);
        new Notice("Maintenance PR 或验证结果已失效，请重新生成。");
        return;
      }
      this.getOpenView()?.showKnowledgePRDecisionLoading("正在安全写入测试 Wiki…");
      void this.knowledgeWriteService.acceptMaintenance(cachedPR, verification)
        .then(async (result) => {
          await this.maintenanceService.handleAccepted(context.claimId);
          this.endOperation(operationKey);
          this.getOpenView()?.showKnowledgePRDecision(result.pr, `维护更新已接受。History：${result.historyPath}`);
          new Notice(result.claimStoreWarning ?? "Maintenance PR 已接受，测试 Wiki 与 Claim Store 已更新。");
        })
        .catch((error: unknown) => {
          this.endOperation(operationKey);
          const message = createCuratorError("write", error, "接受 Maintenance PR 失败。").message;
          console.error("Knowledge Curator could not accept Maintenance PR.", error);
          this.getOpenView()?.showKnowledgePRDecisionError(message);
          new Notice(message);
        });
      return;
    }
    const decision = this.getDecisionInputs(sourcePath, prId);
    if (decision === null) {
      this.endOperation(operationKey);
      return;
    }
    this.getOpenView()?.showKnowledgePRDecisionLoading("正在安全写入测试 Wiki…");
    void this.getValidVerifications(sourcePath, decision.analysisEntry.analysis)
      .then((verifications) => this.knowledgeWriteService.accept(
        decision.pr,
        decision.analysisEntry,
        verifications
      ))
      .then((result) => {
        this.endOperation(operationKey);
        this.getOpenView()?.showKnowledgePRDecision(
          result.pr,
          result.claimStoreWarning === undefined
            ? `更新已接受并写入，Claim Store 已从最终 Wiki 更新。History：${result.historyPath}`
            : `更新已接受并写入。${result.claimStoreWarning} History：${result.historyPath}`
        );
        new Notice(result.claimStoreWarning ?? "Knowledge PR 已接受，测试 Wiki 与 Claim Store 更新成功。");
      })
      .catch((error: unknown) => {
        this.endOperation(operationKey);
        const curatorError = createCuratorError(
          "write",
          error,
          "接受 Knowledge PR 失败，未确认写入结果。"
        );
        const message = curatorError.message;
        console.error("Knowledge Curator could not accept Knowledge PR.", error);
        this.getOpenView()?.showKnowledgePRDecisionError(message);
        new Notice(message);
      });
  }

  private rejectKnowledgePR(sourcePath: string, prId: string): void {
    const operationKey = `reject:${prId}`;
    if (!this.beginOperation(operationKey)) {
      return;
    }
    const pr = this.knowledgePRCacheService.get(sourcePath);
    if (pr === null || pr.id !== prId) {
      this.endOperation(operationKey);
      new Notice("未找到当前 Knowledge PR，请重新生成。");
      return;
    }
    this.getOpenView()?.showKnowledgePRDecisionLoading("正在记录拒绝决定…");
    void this.knowledgeWriteService.reject(pr)
      .then((result) => {
        this.endOperation(operationKey);
        this.getOpenView()?.showKnowledgePRDecision(
          result.pr,
          `更新已拒绝，未修改 Wiki。History：${result.historyPath}`
        );
        new Notice("Knowledge PR 已拒绝，Wiki 未修改。");
      })
      .catch((error: unknown) => {
        this.endOperation(operationKey);
        const curatorError = createCuratorError("history", error, "拒绝 Knowledge PR 失败。");
        const message = curatorError.message;
        console.error("Knowledge Curator could not reject Knowledge PR.", error);
        this.getOpenView()?.showKnowledgePRDecisionError(message);
        new Notice(message);
      });
  }

  private getDecisionInputs(sourcePath: string, prId: string): {
    pr: NonNullable<ReturnType<KnowledgePRCacheService["get"]>>;
    analysisEntry: NonNullable<ReturnType<AnalysisCacheService["getValid"]>>;
  } | null {
    const pr = this.knowledgePRCacheService.get(sourcePath);
    const file = this.vaultService.getMarkdownFile(sourcePath);
    if (pr === null || pr.id !== prId || file === null) {
      new Notice("Knowledge PR 或 Source 已失效，请重新生成。");
      return null;
    }
    const analysisEntry = this.analysisCacheService.getValid(
      sourcePath,
      file.stat.mtime,
      this.vaultService.getConfiguredRetrievalScope(),
      this.getCurrentClaimContext()
    );
    if (analysisEntry === null) {
      new Notice("Phase 2 分析已失效，请重新分析。");
      return null;
    }
    return { pr, analysisEntry };
  }

  private openInboxFile(path: string): void {
    const file = this.vaultService.getMarkdownFile(path);
    if (file === null) {
      new Notice("文件已不存在或已被移动。");
      this.refreshOpenView();
      return;
    }

    void this.app.workspace.getLeaf(false).openFile(file)
      .catch((error: unknown) => {
        this.reportError(`无法打开文件：${path}`, error);
      });
  }

  private openExternalSource(url: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Unsupported external URL protocol.");
      }
      globalThis.open(parsed.toString(), "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      this.reportError("无法打开外部来源。", error);
    }
  }

  private async getValidVerifications(
    sourcePath: string,
    analysis: SourceAnalysis
  ): Promise<CachedConflictVerification[]> {
    const settings = this.getSettings();
    return await this.verificationCacheService.listValidForSource({
      sourcePath,
      topic: analysis.topic,
      conflicts: analysis.conflicts,
      provider: settings.searchProvider,
      model: settings.llmModel
    });
  }

  private refreshOpenView(): void {
    const view = this.getOpenView();
    if (view !== null) {
      this.refreshInbox(view);
    }
  }

  private getOpenView(): KnowledgeCuratorView | null {
    const leaf = this.app.workspace
      .getLeavesOfType(KNOWLEDGE_CURATOR_VIEW_TYPE)[0];
    return leaf?.view instanceof KnowledgeCuratorView ? leaf.view : null;
  }

  private decorateAnalysisStates(result: Awaited<ReturnType<VaultService["scanInbox"]>>): Awaited<ReturnType<VaultService["scanInbox"]>> {
    if (result.state !== "ready") {
      return result;
    }
    return {
      ...result,
      items: result.items.map((item) => {
        if (item.status === "failed") {
          return { ...item, workflowState: "failed" as const };
        }
        const runtimeState = this.analysisStates.get(item.path);
        if (
          runtimeState !== undefined &&
          runtimeState.modified === item.modified &&
          (runtimeState.status !== "analyzed" ||
            claimContextsEqual(runtimeState.claimContext, this.getCurrentClaimContext())) &&
          (runtimeState.status !== "analyzed" || runtimeState.analysis !== undefined)
        ) {
          return {
            ...item,
            status: runtimeState.status,
            analysis: runtimeState.analysis,
            analysisError: runtimeState.error,
            workflowState: runtimeState.status === "analyzing"
              ? "analyzing" as const
              : runtimeState.status === "failed"
                ? "failed" as const
                : this.getWorkflowState(item.path, runtimeState.analysis)
          };
        }
        if (runtimeState !== undefined) {
          this.analysisStates.delete(item.path);
        }
        const cached = this.analysisCacheService.getValid(
          item.path,
          item.modified,
          this.vaultService.getConfiguredRetrievalScope(),
          this.getCurrentClaimContext()
        );
        return cached === null
          ? { ...item, workflowState: "pending" as const }
          : {
              ...item,
              status: "analyzed" as const,
              analysis: cached.analysis,
              workflowState: this.getWorkflowState(item.path, cached.analysis)
            };
      })
    };
  }

  private getWorkflowState(path: string, analysis?: SourceAnalysis) {
    const settings = this.getSettings();
    const pr = this.knowledgePRCacheService.get(path);
    const verifiedConflictCount = analysis === undefined
      ? 0
      : this.verificationCacheService.countMatchingForSource({
          sourcePath: path,
          conflicts: analysis.conflicts,
          provider: settings.searchProvider,
          model: settings.llmModel
        });
    return deriveWorkflowState({
      runtimeState: this.inFlight.has(`verify:${path}`) ? "verifying" : undefined,
      hasAnalysis: analysis !== undefined,
      conflictCount: analysis?.conflicts.length ?? 0,
      verifiedConflictCount,
      prStatus: pr?.status
    }).state;
  }

  private getCurrentClaimContext(): ClaimAnalysisContextSnapshot {
    const settings = this.getSettings();
    return {
      mode: settings.claimComparisonMode,
      topK: settings.claimComparisonMode === "claim" ? settings.claimRetrievalTopK : 0,
      claimStoreRevision: settings.claimComparisonMode === "claim"
        ? this.claimStoreService.getRevision()
        : "legacy",
      retrievalVersion: settings.claimComparisonMode === "claim"
        ? CLAIM_RETRIEVAL_VERSION
        : "legacy-document",
      comparisonVersion: settings.claimComparisonMode === "claim"
        ? CLAIM_COMPARISON_VERSION
        : "legacy-document"
    };
  }

  private beginOperation(key: string): boolean {
    if (this.inFlight.has(key)) {
      return false;
    }
    this.inFlight.add(key);
    return true;
  }

  private endOperation(key: string): void {
    this.inFlight.delete(key);
  }

  private async inspectFile(file: TFile): Promise<void> {
    try {
      const fileInfo = await this.vaultService.getMarkdownMetadata(file);
      const view = await this.activateView();
      view.showFileInfo(fileInfo);
    } catch (error: unknown) {
      try {
        const view = await this.activateView();
        view.showError("无法读取所选 Markdown 文件。");
      } catch (viewError: unknown) {
        console.error("Knowledge Curator could not display the read error.", viewError);
      }

      this.reportError("Knowledge Curator 无法读取所选文件。", error);
    }
  }

  private async activateView(): Promise<KnowledgeCuratorView> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(KNOWLEDGE_CURATOR_VIEW_TYPE)[0] ?? null;

    if (leaf === null) {
      leaf = workspace.getRightLeaf(false);
      if (leaf === null) {
        throw new Error("无法创建右侧边栏叶片。");
      }
      await leaf.setViewState({
        type: KNOWLEDGE_CURATOR_VIEW_TYPE,
        active: true
      });
    }

    await workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (!(view instanceof KnowledgeCuratorView)) {
      throw new Error("Knowledge Curator 侧边栏初始化失败。");
    }

    return view;
  }

  private reportError(message: string, error: unknown): void {
    console.error(message, error);
    new Notice(message);
  }
}

interface RuntimeAnalysisState {
  status: "analyzing" | "analyzed" | "failed";
  modified: number;
  analysis?: SourceAnalysis;
  claimContext?: ClaimAnalysisContextSnapshot;
  error?: string;
}

function claimContextsEqual(
  left: ClaimAnalysisContextSnapshot | undefined,
  right: ClaimAnalysisContextSnapshot
): boolean {
  return left !== undefined &&
    left.mode === right.mode &&
    left.topK === right.topK &&
    left.claimStoreRevision === right.claimStoreRevision &&
    left.retrievalVersion === right.retrievalVersion &&
    left.comparisonVersion === right.comparisonVersion;
}

function freshnessResolutionText(value: "still_valid" | "needs_refinement" | "stale" | "disputed" | "insufficient_evidence"): string {
  return ({
    still_valid: "当前知识仍然有效",
    needs_refinement: "需要补充适用边界",
    stale: "现有知识已经过时",
    disputed: "当前证据存在争议",
    insufficient_evidence: "外部证据不足"
  })[value];
}
