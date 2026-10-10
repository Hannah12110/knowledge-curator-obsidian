import { ItemView, WorkspaceLeaf } from "obsidian";
import type { MarkdownFileInfo } from "../types/file-info";
import type { InboxItem, InboxScanResult } from "../types/knowledge";
import type { KnowledgePR } from "../types/knowledge-pr";
import type { CachedConflictVerification } from "../types/verification";
import type { KnowledgeCuratorMode } from "../types/settings";
import type { WorkflowState } from "../types/workflow";
import type { ClaimStoreStats } from "../types/claim";
import type { MaintenanceFilter, MaintenanceSnapshot } from "../types/maintenance";
import type {
  ClaimGraphNeighbor,
  ClaimGraphSnapshot,
  KnowledgeCompressionProposal
} from "../types/claim-graph";
import {
  CLAIM_GRAPH_RELEASE_NOTICE,
  COMPRESSION_RELEASE_NOTICE
} from "../knowledge/claim-graph-release-boundary";
import { countRelations } from "../services/claim-analysis-aggregator";
import type {
  AnalysisRecommendation,
  KnowledgeGain,
  RawRecommendation,
  SourceAnalysis
} from "../types/source-analysis";

export const KNOWLEDGE_CURATOR_VIEW_TYPE = "knowledge-curator-sidebar";

export interface KnowledgeCuratorViewActions {
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
  onAnalyze: (path: string) => void;
  onViewAnalysis: (path: string) => void;
  onReanalyze: (path: string) => void;
  onGenerateKnowledgePR: (path: string) => void;
  onViewKnowledgePR: (path: string) => void;
  onVerifyConflicts: (path: string) => void;
  onAcceptKnowledgePR: (sourcePath: string, prId: string) => void;
  onRejectKnowledgePR: (sourcePath: string, prId: string) => void;
  onOpenExternalSource: (url: string) => void;
  getMode: () => KnowledgeCuratorMode;
  getClaimStoreStats: () => ClaimStoreStats;
  getMaintenanceSnapshot: (filter?: MaintenanceFilter) => MaintenanceSnapshot;
  onScanFreshness: () => void;
  onVerifyFreshness: (claimId: string, forceRefresh: boolean) => void;
  onGenerateMaintenancePR: (claimId: string) => void;
  getClaimGraphSnapshot: () => ClaimGraphSnapshot;
  getClaimGraphNeighbors: (claimId: string) => ClaimGraphNeighbor[];
  getCompressionProposals: () => Promise<KnowledgeCompressionProposal[]>;
  onBuildClaimGraph: () => void;
  onVerifyGraphConflict: (edgeId: string) => void;
}

type InboxViewState =
  | { state: "loading" }
  | { state: "loaded"; result: InboxScanResult }
  | { state: "error"; message: string };

type CuratorViewMode = "inbox" | "analysis" | "knowledge-pr" | "maintenance" | "claim-graph";

export class KnowledgeCuratorView extends ItemView {
  private fileInfo: MarkdownFileInfo | null = null;
  private inspectionError: string | null = null;
  private inboxState: InboxViewState = { state: "loading" };
  private viewMode: CuratorViewMode = "inbox";
  private analysisResult: {
    sourcePath: string;
    title: string;
    analysis: SourceAnalysis;
    knowledgePR: KnowledgePR | null;
    verifications: CachedConflictVerification[];
  } | null = null;
  private knowledgePRResult: {
    sourceTitle: string;
    pr: KnowledgePR;
    busyMessage: string | null;
    decisionMessage: string | null;
    error: string | null;
  } | null = null;
  private knowledgePRLoading = false;
  private knowledgePRError: string | null = null;
  private conflictVerificationLoading = false;
  private conflictVerificationError: string | null = null;
  private claimDetailsExpanded = false;
  private maintenanceFilter: MaintenanceFilter = "all";
  private maintenanceBusy: string | null = null;
  private maintenanceError: string | null = null;
  private claimGraphBusy: string | null = null;
  private claimGraphError: string | null = null;
  private claimGraphMessage: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly actions: KnowledgeCuratorViewActions
  ) {
    super(leaf);
  }

  getViewType(): string {
    return KNOWLEDGE_CURATOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Knowledge Curator";
  }

  getIcon(): string {
    return "library-big";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.actions.onRefresh();
  }

  async onClose(): Promise<void> {
    // No view-scoped resources to release in Phase 5.
  }

  showInboxLoading(): void {
    this.inboxState = { state: "loading" };
    this.render();
  }

  showInbox(result: InboxScanResult): void {
    this.inboxState = { state: "loaded", result };
    this.render();
  }

  showInboxError(message: string): void {
    this.inboxState = { state: "error", message };
    this.render();
  }

  showFileInfo(fileInfo: MarkdownFileInfo): void {
    this.fileInfo = fileInfo;
    this.inspectionError = null;
    this.render();
  }

  showError(message: string): void {
    this.inspectionError = message;
    this.render();
  }

  showAnalysis(
    sourcePath: string,
    title: string,
    analysis: SourceAnalysis,
    knowledgePR: KnowledgePR | null = null,
    verifications: CachedConflictVerification[] = []
  ): void {
    console.debug("[Knowledge Curator] rendering analysis detail", {
      sourcePath
    });
    this.analysisResult = { sourcePath, title, analysis, knowledgePR, verifications };
    this.claimDetailsExpanded = false;
    this.knowledgePRLoading = false;
    this.knowledgePRError = null;
    this.conflictVerificationLoading = false;
    this.conflictVerificationError = null;
    this.viewMode = "analysis";
    this.render();
  }

  showConflictVerificationLoading(): void {
    this.conflictVerificationLoading = true;
    this.conflictVerificationError = null;
    this.render();
  }

  showConflictVerificationError(message: string): void {
    this.conflictVerificationLoading = false;
    this.conflictVerificationError = message;
    this.render();
  }

  showKnowledgePRLoading(): void {
    this.knowledgePRLoading = true;
    this.knowledgePRError = null;
    this.render();
  }

  showKnowledgePRError(message: string): void {
    this.knowledgePRLoading = false;
    this.knowledgePRError = message;
    this.render();
  }

  showKnowledgePR(sourceTitle: string, pr: KnowledgePR): void {
    if (this.analysisResult !== null) {
      this.analysisResult.knowledgePR = pr;
    }
    this.knowledgePRResult = {
      sourceTitle,
      pr,
      busyMessage: null,
      decisionMessage: null,
      error: null
    };
    this.knowledgePRLoading = false;
    this.knowledgePRError = null;
    this.viewMode = "knowledge-pr";
    this.render();
  }

  showKnowledgePRDecisionLoading(message: string): void {
    if (this.knowledgePRResult !== null) {
      this.knowledgePRResult.busyMessage = message;
      this.knowledgePRResult.error = null;
      this.render();
    }
  }

  showKnowledgePRDecision(pr: KnowledgePR, message: string): void {
    if (this.knowledgePRResult !== null) {
      this.knowledgePRResult.pr = pr;
      this.knowledgePRResult.busyMessage = null;
      this.knowledgePRResult.decisionMessage = message;
      this.knowledgePRResult.error = null;
    }
    if (this.analysisResult !== null) {
      this.analysisResult.knowledgePR = pr;
    }
    this.render();
  }

  showKnowledgePRDecisionError(message: string): void {
    if (this.knowledgePRResult !== null) {
      this.knowledgePRResult.busyMessage = null;
      this.knowledgePRResult.error = message;
      this.render();
    }
  }

  showMaintenance(busyMessage: string | null = null, error: string | null = null): void {
    this.viewMode = "maintenance";
    this.maintenanceBusy = busyMessage;
    this.maintenanceError = error;
    this.render();
  }

  showClaimGraph(
    busyMessage: string | null = null,
    error: string | null = null,
    message: string | null = null
  ): void {
    this.viewMode = "claim-graph";
    this.claimGraphBusy = busyMessage;
    this.claimGraphError = error;
    this.claimGraphMessage = message;
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("knowledge-curator-view");

    container.createEl("h2", { text: "Knowledge Curator" });
    container.createEl("p", {
      cls: "knowledge-curator-status",
      text: "状态：MVP COMPLETE · Claim Graph 人工复核"
    });
    const navigation = container.createDiv({ cls: "knowledge-curator-actions" });
    const inboxButton = navigation.createEl("button", { text: "待处理文章" });
    inboxButton.addEventListener("click", () => { this.viewMode = "inbox"; this.render(); });
    const maintenanceButton = navigation.createEl("button", { text: "知识维护" });
    maintenanceButton.addEventListener("click", () => this.showMaintenance());
    const graphButton = navigation.createEl("button", { text: "知识关系建议" });
    graphButton.addEventListener("click", () => this.showClaimGraph());
    this.renderClaimStoreStatus(container);
    container.createEl("p", {
      cls: "knowledge-curator-status",
      text: this.actions.getMode() === "test"
        ? "当前模式：测试模式"
        : "当前模式：正式知识库预览（只读）"
    });

    if (this.viewMode === "knowledge-pr" && this.knowledgePRResult !== null) {
      this.renderKnowledgePRPage(container, this.knowledgePRResult);
      return;
    }

    if (this.viewMode === "analysis" && this.analysisResult !== null) {
      this.renderAnalysisPage(container, this.analysisResult);
      return;
    }

    if (this.viewMode === "maintenance") {
      this.renderMaintenance(container);
      return;
    }

    if (this.viewMode === "claim-graph") {
      this.renderClaimGraph(container);
      return;
    }

    this.renderInbox(container);

    if (this.inspectionError !== null) {
      container.createEl("p", {
        cls: "knowledge-curator-error knowledge-curator-inspection",
        text: this.inspectionError
      });
    }

    if (this.fileInfo !== null) {
      const section = container.createDiv({
        cls: "knowledge-curator-inspection"
      });
      section.createEl("h3", { text: "已选择的 Markdown" });
      const details = section.createEl("dl", {
        cls: "knowledge-curator-file-info"
      });
      this.addDetail(details, "文件名", this.fileInfo.basename);
      this.addDetail(details, "路径", this.fileInfo.path);
      this.addDetail(details, "大小", `${this.fileInfo.sizeInBytes} 字节`);
      this.addDetail(details, "行数", String(this.fileInfo.lineCount));
      this.addDetail(details, "字数", String(this.fileInfo.wordCount));
      this.addDetail(
        details,
        "修改时间",
        new Date(this.fileInfo.modifiedAt).toLocaleString()
      );
    }
  }

  private renderClaimGraph(container: HTMLElement): void {
    const snapshot = this.actions.getClaimGraphSnapshot();
    const stats = snapshot.stats;
    container.createEl("h3", { text: "知识关系建议" });
    const health = container.createDiv({ cls: "knowledge-curator-card" });
    health.createEl("h4", { text: "知识健康概览" });
    health.createEl("p", {
      text: `Claim ${stats.totalClaims} · Relation ${stats.totalRelations} · 冲突 ${stats.conflicts} · 重复 ${stats.duplicates} · 孤立 Claim ${stats.orphanClaims}`
    });
    health.createEl("p", {
      cls: "knowledge-curator-item-meta",
      text: CLAIM_GRAPH_RELEASE_NOTICE
    });
    health.createEl("p", {
      cls: "knowledge-curator-item-meta",
      text: `状态：${this.getClaimGraphStatusText(stats.status)}` +
        (stats.lastUpdated === undefined ? "" : ` · 最近更新：${this.formatDate(Date.parse(stats.lastUpdated))}`)
    });
    if (stats.message !== undefined) health.createEl("p", { text: stats.message });
    if (stats.status === "building" && stats.progress !== undefined) {
      health.createEl("p", { text: `正在判断关系 ${stats.progress.completed}/${stats.progress.total}` });
    }
    const buildButton = health.createEl("button", {
      cls: "mod-cta",
      text: stats.status === "not_built" ? "生成关系建议" : "重新生成关系建议"
    });
    buildButton.disabled = this.claimGraphBusy !== null || stats.status === "building";
    buildButton.addEventListener("click", () => {
      this.claimGraphBusy = "build";
      this.claimGraphError = null;
      this.render();
      this.actions.onBuildClaimGraph();
    });
    health.createEl("p", {
      cls: "knowledge-curator-item-meta",
      text: "构建会把检索出的少量 Claim Pair 发送给 LLM 分类；不会修改任何 Markdown。"
    });
    if (this.claimGraphError !== null) health.createEl("p", { cls: "knowledge-curator-error", text: this.claimGraphError });
    if (this.claimGraphMessage !== null) health.createEl("p", { cls: "knowledge-curator-pr-success", text: this.claimGraphMessage });

    container.createEl("h4", { text: `AI 建议关系（${snapshot.edges.length}）` });
    if (snapshot.edges.length === 0) {
      container.createEl("p", { cls: "knowledge-curator-empty", text: "尚未生成 Claim 关系建议。" });
    }
    const nodes = new Map(snapshot.nodes.map((node) => [node.claimId, node]));
    for (const edge of snapshot.edges) {
      const from = nodes.get(edge.fromClaimId);
      const to = nodes.get(edge.toClaimId);
      if (from === undefined || to === undefined) continue;
      const card = container.createDiv({ cls: "knowledge-curator-card" });
      card.createEl("strong", { text: `建议关系：${this.getClaimGraphRelationText(edge.relation)}` });
      card.createEl("p", { text: `Claim：${from.statement}` });
      card.createEl("p", { text: `相关知识：${to.statement}` });
      card.createEl("p", { text: `置信度：${Math.round(edge.confidence * 100)}%` });
      card.createEl("p", { cls: "knowledge-curator-item-meta", text: `${from.sourcePath} → ${to.sourcePath}` });
      if (edge.relation === "contradicts") {
        const verify = card.createEl("button", {
          text: this.claimGraphBusy === `verify:${edge.id}` ? "验证中…" : "验证冲突"
        });
        verify.disabled = this.claimGraphBusy !== null;
        verify.addEventListener("click", () => {
          this.claimGraphBusy = `verify:${edge.id}`;
          this.claimGraphError = null;
          this.render();
          this.actions.onVerifyGraphConflict(edge.id);
        });
      }
    }

    container.createEl("h4", { text: "自主知识压缩" });
    container.createEl("p", {
      cls: "knowledge-curator-item-meta",
      text: COMPRESSION_RELEASE_NOTICE
    });
  }

  private getClaimGraphStatusText(status: ClaimGraphSnapshot["stats"]["status"]): string {
    return ({
      not_built: "尚未建立",
      building: "构建中",
      ready: "就绪",
      stale: "需要重建",
      partial: "部分可用",
      corrupt: "无法读取"
    })[status];
  }

  private getClaimGraphRelationText(relation: ClaimGraphSnapshot["edges"][number]["relation"]): string {
    return ({
      duplicate: "重复",
      supports: "支撑",
      refines: "补充",
      contradicts: "冲突",
      depends_on: "依赖"
    })[relation];
  }

  private renderMaintenance(container: HTMLElement): void {
    const snapshot = this.actions.getMaintenanceSnapshot(this.maintenanceFilter);
    container.createEl("h3", { text: "知识维护" });
    const stats = snapshot.stats;
    container.createEl("p", {
      text: stats.status === "corrupt"
        ? stats.message ?? "知识维护数据无法读取，可重新扫描。"
        : `${stats.totalClaims} Claims · 严重风险 ${stats.critical} · 高风险 ${stats.high} · 中风险 ${stats.medium} · 低风险 ${stats.low}`
    });
    container.createEl("p", { text: `从未验证：${stats.neverVerified}` });
    if (stats.lastScannedAt !== undefined) container.createEl("p", { text: `最近扫描：${this.formatDate(Date.parse(stats.lastScannedAt))}` });
    const controls = container.createDiv({ cls: "knowledge-curator-actions" });
    const scan = controls.createEl("button", { text: this.maintenanceBusy === "scan" ? "扫描中…" : "扫描知识时效风险" });
    scan.disabled = this.maintenanceBusy !== null;
    scan.addEventListener("click", () => { this.maintenanceBusy = "scan"; this.maintenanceError = null; this.render(); this.actions.onScanFreshness(); });
    const filter = controls.createEl("select");
    for (const [value, label] of [["all", "全部"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["verified", "已验证"], ["unverified", "未验证"]] as Array<[MaintenanceFilter, string]>) {
      const option = filter.createEl("option", { text: label });
      option.value = value;
      option.selected = this.maintenanceFilter === value;
    }
    filter.addEventListener("change", () => { this.maintenanceFilter = filter.value as MaintenanceFilter; this.render(); });
    if (this.maintenanceError !== null) container.createEl("p", { cls: "knowledge-curator-error", text: this.maintenanceError });
    if (stats.status === "not_scanned" || stats.status === "corrupt") {
      container.createEl("p", { text: "请先执行本地风险扫描。扫描不会联网，也不会修改 Markdown。" });
      return;
    }
    if (snapshot.items.length === 0) {
      container.createEl("p", { text: "当前筛选条件下没有 Claim。" });
      return;
    }
    for (const item of snapshot.items) {
      const card = container.createDiv({ cls: "knowledge-curator-card" });
      card.createEl("h4", { text: item.claim.statement });
      card.createEl("p", { text: `风险：${this.getFreshnessRiskText(item.record.freshnessRisk)} (${item.record.riskScore.toFixed(2)})` });
      card.createEl("p", { text: `原因：${item.record.explanation}` });
      card.createEl("p", { text: `来源：${item.sourcePath}` });
      card.createEl("p", { text: item.record.lastVerifiedAt === undefined ? "最近验证：未验证" : `最近验证：${this.formatDate(Date.parse(item.record.lastVerifiedAt))}` });
      if (item.verification !== undefined) {
        card.createEl("p", { text: `结果：${this.getFreshnessResolutionText(item.verification.resolution)} · 置信度 ${item.verification.confidence.toFixed(2)}` });
        card.createEl("p", { text: item.verification.conclusion });
        const evidenceList = card.createEl("ul");
        for (const evidence of item.verification.evidence) {
          const row = evidenceList.createEl("li");
          const link = row.createEl("button", { text: `${evidence.title} · Tier ${evidence.sourceTier}` });
          link.addEventListener("click", () => this.actions.onOpenExternalSource(evidence.url));
        }
      }
      const actions = card.createDiv({ cls: "knowledge-curator-actions" });
      const operationKey = `verify:${item.claim.id}`;
      const verify = actions.createEl("button", { text: item.record.lastVerifiedAt === undefined ? "验证此知识" : "重新验证" });
      verify.disabled = this.maintenanceBusy !== null;
      verify.addEventListener("click", () => {
        this.maintenanceBusy = operationKey; this.maintenanceError = null; this.render();
        this.actions.onVerifyFreshness(item.claim.id, item.record.lastVerifiedAt !== undefined);
      });
      if (item.verification?.resolution === "needs_refinement" || item.verification?.resolution === "stale") {
        const pr = actions.createEl("button", { text: "生成知识维护建议" });
        pr.disabled = this.maintenanceBusy !== null;
        pr.addEventListener("click", () => { this.maintenanceBusy = `pr:${item.claim.id}`; this.render(); this.actions.onGenerateMaintenancePR(item.claim.id); });
      }
    }
  }

  private renderInbox(container: HTMLElement): void {
    const header = container.createDiv({ cls: "knowledge-curator-section-header" });
    header.createEl("h3", { text: "待处理文章" });
    const refreshButton = header.createEl("button", {
      cls: "knowledge-curator-refresh",
      text: "刷新"
    });
    refreshButton.addEventListener("click", this.actions.onRefresh);

    if (this.inboxState.state === "loading") {
      refreshButton.disabled = true;
      container.createEl("p", {
        cls: "knowledge-curator-empty",
        text: "正在读取待处理目录…"
      });
      return;
    }

    if (this.inboxState.state === "error") {
      container.createEl("p", {
        cls: "knowledge-curator-error",
        text: this.inboxState.message
      });
      return;
    }

    const { result } = this.inboxState;
    if (result.state === "missing") {
      container.createEl("p", {
        cls: "knowledge-curator-error",
        text: "未找到待处理目录。"
      });
      container.createEl("p", {
        cls: "knowledge-curator-empty",
        text: `当前配置路径：${result.configuredPath || "（空）"}`
      });
      container.createEl("p", {
        cls: "knowledge-curator-empty",
        text: "请创建该目录，或在插件设置中更新路径。"
      });
      return;
    }

    const fileCount = result.items.length;
    container.createEl("p", {
      cls: "knowledge-curator-count",
      text: `${fileCount} 篇文章`
    });

    if (fileCount === 0) {
      container.createEl("p", {
        cls: "knowledge-curator-empty",
        text: "待处理目录暂无文章。"
      });
      container.createEl("p", {
        cls: "knowledge-curator-empty",
        text: "可以通过 Obsidian Web Clipper 或手动将 Markdown 文件放入待处理目录。"
      });
      return;
    }

    const list = container.createDiv({ cls: "knowledge-curator-inbox-list" });
    for (const item of result.items) {
      this.renderInboxItem(list, item);
    }
  }

  private renderClaimStoreStatus(container: HTMLElement): void {
    const stats = this.actions.getClaimStoreStats();
    const section = container.createDiv({ cls: "knowledge-curator-claim-store-status" });
    section.createEl("strong", { text: "Claim Store" });
    if (stats.status === "not_built") {
      section.createEl("span", { text: " · 尚未建立" });
      return;
    }
    if (stats.status === "corrupt") {
      section.createEl("span", { text: " · 无法读取，请重新构建" });
      return;
    }
    if (stats.status === "building" && stats.progress !== undefined) {
      section.createEl("span", {
        text: ` · 正在建立 ${stats.progress.completed}/${stats.progress.total} Wiki`
      });
      return;
    }
    const status = stats.status === "partial" ? "部分可用" : "就绪";
    section.createEl("span", {
      text: ` · ${status} · ${stats.totalClaims} Claims · ${stats.indexedWiki} Wiki · ${stats.failedFiles} 失败`
    });
  }

  private renderInboxItem(container: HTMLElement, item: InboxItem): void {
    const card = container.createDiv({ cls: "knowledge-curator-inbox-item" });
    card.createEl("h4", { text: this.getInboxTitle(item) });
    const statusText = this.getStatusText(item);
    card.createEl("p", {
      cls: item.status === "failed"
        ? "knowledge-curator-item-status is-failed"
        : "knowledge-curator-item-status",
      text: statusText
    });
    if (item.analysisError !== undefined) {
      card.createEl("p", {
        cls: "knowledge-curator-error knowledge-curator-item-error",
        text: item.analysisError
      });
    }
    card.createEl("p", {
      cls: "knowledge-curator-item-meta",
      text: `修改时间：${this.formatDate(item.modified)}`
    });

    const actions = card.createDiv({ cls: "knowledge-curator-item-actions" });
    const openButton = actions.createEl("button", { text: "打开" });
    openButton.addEventListener("click", () => {
      this.actions.onOpenFile(item.path);
    });

    const workflow = item.workflowState ?? item.status;
    if (workflow === "pending") {
      this.addActionButton(actions, "分析", () => this.actions.onAnalyze(item.path));
    } else if (workflow === "analyzing") {
      const analyzingButton = actions.createEl("button", { text: "分析中…" });
      analyzingButton.disabled = true;
    } else if (workflow === "verifying") {
      const verifyingButton = actions.createEl("button", { text: "验证中…" });
      verifyingButton.disabled = true;
    } else if (workflow === "needs_verification") {
      this.addActionButton(actions, "验证冲突", () => this.actions.onVerifyConflicts(item.path));
      this.addViewAnalysisButton(actions, item);
    } else if (workflow === "verified" || workflow === "analyzed") {
      this.addActionButton(actions, "生成知识更新建议", () => {
        this.actions.onGenerateKnowledgePR(item.path);
      });
      this.addViewAnalysisButton(actions, item);
    } else if (workflow === "pr_draft") {
      this.addActionButton(actions, "查看更新建议", () => this.actions.onViewKnowledgePR(item.path));
      this.addViewAnalysisButton(actions, item);
    } else if (workflow === "pr_stale") {
      this.addActionButton(actions, "重新生成", () => this.actions.onGenerateKnowledgePR(item.path));
      this.addViewAnalysisButton(actions, item);
    } else if (workflow === "accepted" || workflow === "rejected") {
      this.addViewAnalysisButton(actions, item);
      this.addActionButton(actions, "重新分析", () => this.actions.onReanalyze(item.path));
    } else if (item.status === "analyzed") {
      this.addViewAnalysisButton(actions, item);
      this.addActionButton(actions, "重新分析", () => this.actions.onReanalyze(item.path));
    } else {
      this.addActionButton(actions, "重试", () => this.actions.onAnalyze(item.path));
    }
  }

  private addViewAnalysisButton(container: HTMLElement, item: InboxItem): void {
    this.addActionButton(container, "查看分析", () => {
      console.debug("[Knowledge Curator] view-analysis clicked", {
        sourcePath: item.path
      });
      this.actions.onViewAnalysis(item.path);
    });
  }

  private renderAnalysisPage(
    container: HTMLElement,
    result: {
      sourcePath: string;
      title: string;
      analysis: SourceAnalysis;
      knowledgePR: KnowledgePR | null;
      verifications: CachedConflictVerification[];
    }
  ): void {
    const backButton = container.createEl("button", {
      cls: "knowledge-curator-back",
      text: "← 返回待处理文章"
    });
    backButton.addEventListener("click", () => {
      this.viewMode = "inbox";
      this.analysisResult = null;
      this.render();
    });
    this.renderAnalysis(
      container,
      result.title,
      result.analysis,
      result.verifications
    );
    if (result.analysis.conflicts.length > 0) {
      const verificationActions = container.createDiv({
        cls: "knowledge-curator-verification-actions"
      });
      const verifiedCount = result.verifications.length;
      verificationActions.createEl("p", {
        cls: "knowledge-curator-item-meta",
        text: `冲突验证：${verifiedCount}/${result.analysis.conflicts.length}`
      });
      if (verifiedCount < result.analysis.conflicts.length || this.conflictVerificationError !== null) {
        const verifyButton = verificationActions.createEl("button", {
          cls: "mod-cta",
          text: this.conflictVerificationLoading ? "验证中…" : "验证全部冲突"
        });
        verifyButton.disabled = this.conflictVerificationLoading;
        verifyButton.addEventListener("click", () => {
          this.actions.onVerifyConflicts(result.sourcePath);
        });
      } else {
        verificationActions.createEl("p", {
          cls: "knowledge-curator-pr-success",
          text: "当前文章的全部冲突已完成验证。"
        });
      }
      if (this.conflictVerificationError !== null) {
        verificationActions.createEl("p", {
          cls: "knowledge-curator-error",
          text: this.conflictVerificationError
        });
      }
    }
    const actions = container.createDiv({ cls: "knowledge-curator-pr-actions" });
    if (result.analysis.recommendation === "reject") {
      actions.createEl("p", {
        cls: "knowledge-curator-empty",
        text: "当前建议：不摄入，不默认生成 Knowledge PR。"
      });
    } else {
      if (result.knowledgePR !== null) {
        if (result.knowledgePR.status === "stale") {
          actions.createEl("p", {
            cls: "knowledge-curator-item-status",
            text: "验证结果已更新，请重新生成知识更新建议。"
          });
        }
        const label = result.knowledgePR.status === "stale"
          ? "查看已失效的知识更新建议"
          : "查看知识更新建议";
        this.addActionButton(actions, label, () => {
          this.showKnowledgePR(result.title, result.knowledgePR!);
        });
      }
      const generateButton = actions.createEl("button", {
        text: this.knowledgePRLoading
          ? "正在生成知识更新建议…"
          : result.knowledgePR?.status === "stale"
            ? "重新生成知识更新建议"
            : "生成知识更新建议"
      });
      generateButton.disabled = this.knowledgePRLoading;
      generateButton.addEventListener("click", () => {
        this.actions.onGenerateKnowledgePR(result.sourcePath);
      });
    }
    if (this.knowledgePRError !== null) {
      actions.createEl("p", {
        cls: "knowledge-curator-error",
        text: this.knowledgePRError
      });
    }
  }

  private renderKnowledgePRPage(
    container: HTMLElement,
    result: {
      sourceTitle: string;
      pr: KnowledgePR;
      busyMessage: string | null;
      decisionMessage: string | null;
      error: string | null;
    }
  ): void {
    const backButton = container.createEl("button", {
      cls: "knowledge-curator-back",
      text: result.pr.origin === "maintenance" ? "← 返回知识维护" : "← 返回分析"
    });
    backButton.addEventListener("click", () => {
      this.viewMode = result.pr.origin === "maintenance" ? "maintenance" : "analysis";
      this.render();
    });

    const section = container.createDiv({ cls: "knowledge-curator-pr" });
    section.createEl("h3", { text: result.pr.origin === "maintenance" ? "知识维护建议" : "知识更新建议" });
    const summary = section.createEl("dl", {
      cls: "knowledge-curator-analysis-summary"
    });
    this.addDetail(summary, "来源", result.sourceTitle);
    this.addDetail(summary, "目标 Wiki", result.pr.target.path);
    this.addDetail(summary, "操作", result.pr.target.operation === "update" ? "更新" : "新建");
    this.addDetail(summary, "置信度", `${Math.round(result.pr.confidence * 100)}%`);
    this.addDetail(summary, "Raw 建议", this.getRawRecommendationText(result.pr.rawRecommendation));
    this.addDetail(summary, "状态", this.getKnowledgePRStatusText(result.pr.status));
    if (result.pr.maintenanceContext !== undefined) {
      this.addDetail(summary, "验证结果", this.getFreshnessResolutionText(result.pr.maintenanceContext.freshnessResolution));
    }
    this.addDetail(
      summary,
      "写入模式",
      this.actions.getMode() === "test" ? "测试模式" : "正式知识库预览（只读）"
    );
    section.createEl("p", { text: result.pr.summary });

    section.createEl("h4", { text: `修改内容（${result.pr.changes.length} 项）` });
    for (let index = 0; index < result.pr.changes.length; index += 1) {
      const change = result.pr.changes[index];
      if (change === undefined) {
        continue;
      }
      const card = section.createDiv({ cls: "knowledge-curator-change" });
      card.createEl("h5", { text: `修改 ${index + 1}` });
      const details = card.createEl("dl", {
        cls: "knowledge-curator-analysis-summary"
      });
      this.addDetail(details, "类型", change.type.toUpperCase());
      this.addDetail(details, "位置", change.section ?? "未指定章节");
      this.addDetail(details, "置信度", `${Math.round(change.confidence * 100)}%`);
      card.createEl("h6", { text: "当前内容" });
      card.createEl("pre", {
        cls: "knowledge-curator-diff knowledge-curator-diff-before",
        text: change.before ?? "（新建文件，无现有内容）"
      });
      card.createEl("h6", { text: "建议内容" });
      card.createEl("pre", {
        cls: "knowledge-curator-diff knowledge-curator-diff-after",
        text: change.after
      });
      card.createEl("h6", { text: "原因" });
      card.createEl("p", { text: change.reason });
      card.createEl("h6", { text: "对应 Phase 2 判断" });
      const claims = card.createEl("ul", { cls: "knowledge-curator-analysis-list" });
      for (const claim of change.sourceClaims) {
        claims.createEl("li", { text: claim });
      }
    }

    section.createEl("h4", { text: "依据" });
    const evidence = section.createEl("ul", { cls: "knowledge-curator-analysis-list" });
    for (const item of result.pr.evidence) {
      const row = evidence.createEl("li");
      row.createEl("strong", { text: item.sourceTitle });
      if (item.kind === "external") {
        row.createEl("p", { text: item.url });
        row.createEl("p", {
          text: `Tier ${item.sourceTier} · 支持：${item.supports} · 置信度 ${Math.round(item.confidence * 100)}%`
        });
        row.createEl("p", { text: item.conclusion });
        this.addActionButton(row, "查看来源", () => {
          this.actions.onOpenExternalSource(item.url);
        });
      } else {
        row.createEl("p", { text: item.sourcePath });
        if (item.claim !== undefined) {
          row.createEl("p", { text: item.claim });
        }
      }
      if (item.excerpt !== undefined) {
        row.createEl("blockquote", { text: item.excerpt });
      }
    }

    if (result.busyMessage !== null) {
      section.createEl("p", {
        cls: "knowledge-curator-empty",
        text: result.busyMessage
      });
    }
    if (result.decisionMessage !== null) {
      section.createEl("p", {
        cls: "knowledge-curator-pr-success",
        text: result.decisionMessage
      });
    }
    if (result.error !== null) {
      section.createEl("p", {
        cls: "knowledge-curator-error",
        text: result.error
      });
    }

    const actions = section.createDiv({ cls: "knowledge-curator-pr-actions" });
    if (result.pr.status === "draft") {
      const acceptButton = actions.createEl("button", {
        cls: "mod-cta",
        text: this.actions.getMode() === "test" ? "接受更新" : "正式知识库写入尚未开放"
      });
      const rejectButton = actions.createEl("button", { text: "拒绝更新" });
      const isBusy = result.busyMessage !== null;
      acceptButton.disabled = isBusy || this.actions.getMode() !== "test";
      rejectButton.disabled = isBusy;
      acceptButton.addEventListener("click", () => {
        this.actions.onAcceptKnowledgePR(result.pr.sourcePath, result.pr.id);
      });
      rejectButton.addEventListener("click", () => {
        this.actions.onRejectKnowledgePR(result.pr.sourcePath, result.pr.id);
      });
    }
  }

  private renderAnalysis(
    container: HTMLElement,
    title: string,
    analysis: SourceAnalysis,
    verifications: CachedConflictVerification[]
  ): void {
    const section = container.createDiv({ cls: "knowledge-curator-analysis" });
    section.createEl("h3", { text: "文章分析" });
    const summary = section.createEl("dl", { cls: "knowledge-curator-analysis-summary" });
    this.addDetail(summary, "标题", title);
    this.addDetail(summary, "主题", analysis.topic);
    this.addDetail(summary, "来源质量", analysis.sourceQuality.grade);
    this.addDetail(summary, "与现有知识重合度", `${Math.round(analysis.overlap * 100)}%`);
    this.addDetail(summary, "知识增益", this.getKnowledgeGainText(analysis.knowledgeGain));
    this.addDetail(summary, "建议", this.getRecommendationText(analysis.recommendation));
    this.addDetail(summary, "Raw 建议", this.getRawRecommendationText(analysis.rawRecommendation));

    this.renderClaimAnalysis(section, analysis);

    section.createEl("h4", { text: "来源质量评分" });
    const quality = section.createEl("dl", { cls: "knowledge-curator-analysis-summary" });
    this.addDetail(quality, "权威性", `${analysis.sourceQuality.authority}/5`);
    this.addDetail(quality, "证据充分度", `${analysis.sourceQuality.evidence}/5`);
    this.addDetail(quality, "一手来源", `${analysis.sourceQuality.primarySource}/5`);
    this.addDetail(quality, "时效性", `${analysis.sourceQuality.recency}/5`);
    this.addDetail(quality, "独立性", `${analysis.sourceQuality.independence}/5`);
    this.addDetail(quality, "可复现性", `${analysis.sourceQuality.reproducibility}/5`);
    section.createEl("p", { text: analysis.sourceQuality.reason });

    this.renderRelatedNotes(section, analysis);
    this.renderClaims(section, analysis);
    this.renderConflicts(section, analysis, verifications);

    section.createEl("h4", { text: "判断理由" });
    section.createEl("p", { text: analysis.reason });
  }

  private renderClaimAnalysis(container: HTMLElement, analysis: SourceAnalysis): void {
    if (analysis.claimAnalysis === undefined) {
      container.createEl("p", {
        cls: "knowledge-curator-empty",
        text: "当前结果来自 Legacy Document Mode。"
      });
      return;
    }
    const counts = countRelations(analysis.claimAnalysis.comparisons);
    const summary = container.createDiv({ cls: "knowledge-curator-claim-summary" });
    summary.createEl("h4", { text: "知识点对比" });
    summary.createEl("p", {
      text: `共识别 ${analysis.claimAnalysis.candidateClaims.length} 条核心 Claim · 新增 ${counts.add} · 补充 ${counts.refine} · 已有 ${counts.reinforce} · 冲突 ${counts.challenge}`
    });
    summary.createEl("p", {
      cls: "knowledge-curator-item-meta",
      text: `已有知识覆盖 ${Math.round(analysis.claimAnalysis.coverage * 100)}%`
    });
    const toggle = summary.createEl("button", {
      text: this.claimDetailsExpanded ? "收起知识点对比" : "查看知识点对比"
    });
    toggle.addEventListener("click", () => {
      this.claimDetailsExpanded = !this.claimDetailsExpanded;
      this.render();
    });
    if (!this.claimDetailsExpanded) return;
    const candidateMap = new Map(
      analysis.claimAnalysis.candidateClaims.map((claim) => [claim.id, claim])
    );
    for (const comparison of analysis.claimAnalysis.comparisons) {
      const candidate = candidateMap.get(comparison.candidateClaimId);
      const card = summary.createDiv({ cls: "knowledge-curator-claim-comparison" });
      card.createEl("strong", { text: this.getClaimRelationText(comparison.relation) });
      card.createEl("p", { text: `新文章：${candidate?.statement ?? comparison.candidateStatement}` });
      card.createEl("p", {
        text: comparison.existingStatement === undefined
          ? "已有知识：未找到等价 Claim"
          : `已有知识：${comparison.existingStatement}`
      });
      if (comparison.coverage !== undefined) {
        card.createEl("p", {
          text: `已有知识覆盖：${this.getClaimCoverageText(comparison.coverage.coverage)}`
        });
        if (comparison.coverage.coveredAspects.length > 0) {
          card.createEl("p", {
            text: `已覆盖：${comparison.coverage.coveredAspects.join("；")}`
          });
        }
        if (comparison.coverage.uncoveredAspects.length > 0) {
          card.createEl("p", {
            text: `新增：${comparison.coverage.uncoveredAspects.join("；")}`
          });
        }
        if (comparison.coverage.conflictingAspects.length > 0) {
          card.createEl("p", {
            text: `冲突：${comparison.coverage.conflictingAspects.join("；")}`
          });
        }
      }
      card.createEl("p", { text: `置信度：${Math.round(comparison.confidence * 100)}%` });
      card.createEl("p", { text: comparison.reasoning });
    }
  }

  private getClaimCoverageText(value: "none" | "partial" | "full" | "conflicting"): string {
    return ({
      none: "未覆盖",
      partial: "部分覆盖",
      full: "已覆盖",
      conflicting: "存在冲突"
    })[value];
  }

  private getClaimRelationText(relation: "add" | "reinforce" | "refine" | "challenge" | "supersede"): string {
    return ({
      add: "ADD · 新增知识",
      reinforce: "REINFORCE · 已有知识支持",
      refine: "REFINE · 补充边界",
      challenge: "CHALLENGE · 冲突待验证",
      supersede: "SUPERSEDE · 验证后替代"
    })[relation];
  }

  private renderRelatedNotes(container: HTMLElement, analysis: SourceAnalysis): void {
    container.createEl("h4", { text: `相关知识（${analysis.relatedNotes.length}）` });
    if (analysis.relatedNotes.length === 0) {
      container.createEl("p", { cls: "knowledge-curator-empty", text: "未识别到相关知识。" });
      return;
    }
    const list = container.createEl("ul", { cls: "knowledge-curator-analysis-list" });
    for (const note of analysis.relatedNotes) {
      const item = list.createEl("li");
      item.createEl("strong", { text: note.title });
      item.createEl("span", {
        text: ` · ${Math.round(note.relevance * 100)}% · ${note.reason}`
      });
    }
  }

  private renderClaims(container: HTMLElement, analysis: SourceAnalysis): void {
    container.createEl("h4", { text: `新增知识（${analysis.newClaims.length} 条）` });
    if (analysis.newClaims.length === 0) {
      container.createEl("p", { cls: "knowledge-curator-empty", text: "未识别到新增知识。" });
      return;
    }
    const list = container.createEl("ol", { cls: "knowledge-curator-analysis-list" });
    for (const claim of analysis.newClaims) {
      const item = list.createEl("li");
      item.createEl("p", { text: claim.statement });
      item.createEl("small", {
        text: `${claim.type} · ${claim.novelty} · 置信度 ${Math.round(claim.confidence * 100)}%`
      });
      if (claim.sourceExcerpt !== undefined) {
        item.createEl("blockquote", { text: claim.sourceExcerpt });
      }
    }
  }

  private renderConflicts(
    container: HTMLElement,
    analysis: SourceAnalysis,
    verifications: CachedConflictVerification[]
  ): void {
    container.createEl("h4", { text: `潜在冲突（${analysis.conflicts.length} 条）` });
    if (analysis.conflicts.length === 0) {
      container.createEl("p", { cls: "knowledge-curator-empty", text: "未识别到潜在冲突。" });
      return;
    }
    const list = container.createEl("ol", { cls: "knowledge-curator-analysis-list" });
    for (const conflict of analysis.conflicts) {
      const item = list.createEl("li");
      item.createEl("p", { text: `现有：${conflict.existingClaim}` });
      item.createEl("p", { text: `新文章：${conflict.newClaim}` });
      item.createEl("small", {
        text: `${conflict.type} · 未验证 · 置信度 ${Math.round(conflict.confidence * 100)}% · ${conflict.existingFile}`
      });
      item.createEl("p", { text: conflict.explanation });
      const verified = verifications.find((entry) =>
        entry.existingClaim === conflict.existingClaim &&
        entry.newClaim === conflict.newClaim
      );
      if (verified === undefined) {
        item.createEl("p", {
          cls: "knowledge-curator-item-status",
          text: "验证状态：未验证"
        });
        continue;
      }
      const result = verified.result;
      const verification = item.createDiv({
        cls: "knowledge-curator-conflict-verification"
      });
      verification.createEl("h5", { text: "验证结果" });
      const details = verification.createEl("dl", {
        cls: "knowledge-curator-analysis-summary"
      });
      this.addDetail(details, "结论类型", this.getResolutionText(result.resolution));
      this.addDetail(details, "置信度", `${Math.round(result.confidence * 100)}%`);
      this.addDetail(details, "验证时间", this.formatDate(Date.parse(result.verifiedAt)));
      verification.createEl("h6", { text: "结论" });
      verification.createEl("p", { text: result.conclusion });
      verification.createEl("h6", { text: "判断理由" });
      verification.createEl("p", { text: result.reasoning });
      verification.createEl("h6", { text: "外部证据" });
      const evidenceList = verification.createEl("ol", {
        cls: "knowledge-curator-analysis-list"
      });
      for (const evidence of result.evidence) {
        const evidenceItem = evidenceList.createEl("li");
        evidenceItem.createEl("strong", { text: evidence.title });
        evidenceItem.createEl("p", {
          text: `${this.getSourceTierText(evidence.sourceTier)} · 支持：${this.getEvidenceSupportText(evidence.supports)} · 置信度 ${Math.round(evidence.confidence * 100)}%`
        });
        if (evidence.excerpt !== undefined) {
          evidenceItem.createEl("blockquote", { text: evidence.excerpt });
        }
        evidenceItem.createEl("p", { text: evidence.reasoning });
        this.addActionButton(evidenceItem, "查看来源", () => {
          this.actions.onOpenExternalSource(evidence.url);
        });
      }
    }
  }

  private getStatusText(item: InboxItem): string {
    const workflowLabels: Record<WorkflowState, string> = {
      pending: "待分析",
      analyzing: "分析中",
      analyzed: "已分析",
      needs_verification: "有冲突待验证",
      verifying: "验证中",
      verified: "冲突已验证",
      pr_draft: "待审核知识更新",
      pr_stale: "知识更新建议已失效",
      accepted: "已接受",
      rejected: "已拒绝",
      failed: "处理失败"
    };
    if (item.workflowState !== undefined) {
      return workflowLabels[item.workflowState];
    }
    if (item.status === "analyzing") {
      return "分析中";
    }
    if (item.status === "analyzed") {
      return "已分析";
    }
    if (item.status === "failed") {
      return item.analysisError === undefined ? "读取失败" : "分析失败";
    }
    return "待处理";
  }

  private getKnowledgeGainText(value: KnowledgeGain): string {
    return ({ high: "高", medium: "中", low: "低", none: "无" })[value];
  }

  private getRecommendationText(value: AnalysisRecommendation): string {
    return ({
      reject: "不摄入",
      extract_only: "仅提取增量",
      merge: "摄入并融合",
      review: "需要进一步审核"
    })[value];
  }

  private getRawRecommendationText(value: RawRecommendation): string {
    return ({
      keep: "建议保留原文",
      extract_only: "提取后不保留原文",
      reject: "不保留原文",
      replace_canonical: "建议替换现有核心来源"
    })[value];
  }

  private getKnowledgePRStatusText(status: KnowledgePR["status"]): string {
    return ({
      draft: "待审核",
      accepted: "已接受",
      rejected: "已拒绝",
      stale: "验证结果已更新，请重新生成知识更新建议"
    })[status];
  }

  private getResolutionText(value: "supersede" | "refine" | "unresolved"): string {
    return ({
      supersede: "新知识替代旧知识",
      refine: "补充适用条件后融合",
      unresolved: "暂无法确定"
    })[value];
  }

  private getSourceTierText(value: 0 | 1 | 2 | 3 | 4): string {
    return ({
      0: "Tier 0 · 官方 / 一手权威",
      1: "Tier 1 · 高可信一手来源",
      2: "Tier 2 · 高质量专业来源",
      3: "Tier 3 · 一般二手来源",
      4: "Tier 4 · 低可信来源"
    })[value];
  }

  private getFreshnessRiskText(value: "low" | "medium" | "high" | "critical"): string {
    return ({ low: "低", medium: "中", high: "高", critical: "严重" })[value];
  }

  private getFreshnessResolutionText(value: "still_valid" | "needs_refinement" | "stale" | "disputed" | "insufficient_evidence"): string {
    return ({
      still_valid: "仍然有效",
      needs_refinement: "需要补充边界",
      stale: "已经过时",
      disputed: "存在争议",
      insufficient_evidence: "证据不足"
    })[value];
  }

  private getEvidenceSupportText(value: "existing" | "new" | "both" | "neither"): string {
    return ({
      existing: "现有知识",
      new: "新知识",
      both: "两者",
      neither: "均不直接支持"
    })[value];
  }

  private addActionButton(
    container: HTMLElement,
    text: string,
    action: () => void
  ): void {
    const button = container.createEl("button", { text });
    button.addEventListener("click", action);
  }

  private getInboxTitle(item: InboxItem): string {
    const title = item.frontmatter?.title;
    return typeof title === "string" && title.trim().length > 0
      ? title.trim()
      : item.basename;
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private addDetail(container: HTMLElement, label: string, value: string): void {
    container.createEl("dt", { text: label });
    container.createEl("dd", { text: value });
  }
}
