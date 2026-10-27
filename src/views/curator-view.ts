import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { InboxItem, InboxScanResult } from "../types/knowledge";
import type { ClaimRecord } from "../types/claim";
import type { ClaimGraphSnapshot } from "../types/claim-graph";
import { ARTICLE_STATUS_LABELS, EMPTY_STATES, knowledgeDifferences, type ProductArticleResult, type KnowledgePointDisplay } from "../product/workflow-presenter";
import { BatchWorkspaceState, BATCH_STATUS_LABELS, type ArticleFilter, type BatchAnalysisJob } from "../product/batch-analysis";
import { groupGlobalGraph, globalNodeDetails, GLOBAL_RELATION_LABELS, MindMapViewport, type ChangeLogEntry } from "../product/global-workspace";

export const KNOWLEDGE_CURATOR_VIEW_TYPE = "knowledge-curator-sidebar";
export interface KnowledgeCuratorViewActions {
  onRefresh(): void; onSelectArticle(path: string): void; onAnalyze(ids: string[]): void; onOpenFile(path: string): void; onOpenSettings(): void;
  onCancelBatch?(): void; getGlobalGraph?(): ClaimGraphSnapshot; getClaims?(): ClaimRecord[];
  getHistory?(): Promise<{ entries: ChangeLogEntry[]; unreadable: number }>;
}
type ResultTab = "analysis" | "points";
type Page = "workspace" | "detail" | "graph" | "history" | "history-detail";
export class KnowledgeCuratorView extends ItemView {
  readonly workspaceState = new BatchWorkspaceState();
  private inbox: InboxScanResult | null = null;
  private inboxError: string | null = null;
  private result: ProductArticleResult | null = null;
  private progress: string | null = null;
  private error: string | null = null;
  private failed = false;
  private tab: ResultTab = "analysis";
  private page: Page = "workspace";
  private job: BatchAnalysisJob | null = null;
  private historyEntries: ChangeLogEntry[] = [];
  private historyUnreadable = 0;
  private historyLoading = false;
  private historyError = false;
  private historyRequest = 0;
  private historyEntry: ChangeLogEntry | null = null;
  private readonly viewport = new MindMapViewport();
  private readonly expandedGroups = new Set<string>();
  private graphNode: string | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly actions: KnowledgeCuratorViewActions) { super(leaf); }
  getViewType(): string { return KNOWLEDGE_CURATOR_VIEW_TYPE; }
  getDisplayText(): string { return "Knowledge Curator"; }
  getIcon(): string { return "library-big"; }
  async onOpen(): Promise<void> { this.render(); this.actions.onRefresh(); }
  async onClose(): Promise<void> { this.historyRequest++; }
  getSelectedArticle(): string | null { return this.workspaceState.activeArticleId; }
  selectArticle(path: string): void {
    if (this.workspaceState.activeArticleId !== path) { this.result = null; this.tab = "analysis"; }
    this.workspaceState.activeArticleId = path; this.page = "detail"; this.error = null; this.failed = false; this.render();
  }
  showInbox(result: InboxScanResult): void {
    this.inbox = result; this.inboxError = null;
    if (result.state === "ready") for (const id of this.workspaceState.selectedArticleIds) if (!result.items.some((item) => item.path === id)) this.workspaceState.selectedArticleIds.delete(id);
    this.render();
  }
  showInboxError(message: string): void { this.inboxError = message; this.render(); }
  showProgress(message: string): void { this.progress = message; this.error = null; this.failed = false; this.render(); }
  finishProgress(): void { this.progress = null; this.render(); }
  showResult(result: ProductArticleResult | null): void { if (result === null || result.sourcePath === this.workspaceState.activeArticleId) this.result = result; this.error = null; this.failed = false; this.render(); }
  showError(message: string, failed = false): void { this.error = message; this.failed = failed; this.progress = null; this.render(); }
  showBatchJob(job: BatchAnalysisJob): void { this.job = job; this.render(); }
  showGlobalGraph(): void { this.page = "graph"; this.error = null; this.render(); }
  showHistoryPage(): void {
    this.page = "history"; this.historyLoading = true; this.historyError = false; const request = ++this.historyRequest; this.render();
    void (this.actions.getHistory?.() ?? Promise.resolve({ entries: [], unreadable: 0 })).then((result) => {
      if (request !== this.historyRequest) return;
      this.historyEntries = result.entries; this.historyUnreadable = result.unreadable; this.historyLoading = false; this.render();
    }).catch((error) => { console.error("Knowledge Curator history display failed", error); if (request === this.historyRequest) { this.historyError = true; this.historyLoading = false; this.render(); } });
  }
  private items(): InboxItem[] { return this.inbox?.state === "ready" ? this.inbox.items : []; }
  private busy(): boolean { return this.job?.status === "running" || this.progress !== null; }
  private title(path: string): string { const item = this.items().find((item) => item.path === path); const frontmatter = item?.frontmatter?.title; return typeof frontmatter === "string" ? frontmatter : item?.basename ?? path.split("/").pop()?.replace(/\.md$/iu, "") ?? path; }

  private render(): void {
    const scroll = this.contentEl.scrollTop, container = this.contentEl;
    container.empty(); container.addClass("knowledge-curator-view", "kc-workflow", "kc-batch-workspace");
    const header = container.createDiv({ cls: "kc-heading" }); const title = header.createDiv();
    title.createEl("h2", { text: "Knowledge Curator" }); title.createEl("p", { text: "把文章整理成可维护的知识点", cls: "kc-muted" });
    const settings = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "打开知识整理设置", title: "设置" } }); setIcon(settings, "settings"); settings.addEventListener("click", () => this.actions.onOpenSettings());
    const nav = container.createDiv({ cls: "kc-navigation", attr: { "aria-label": "知识整理导航" } });
    for (const [page, label] of [["workspace", "文章工作台"], ["graph", "知识关系图"], ["history", "变更记录"]] as const) {
      const current = this.page === page || (page === "workspace" && this.page === "detail") || (page === "history" && this.page === "history-detail");
      const button = nav.createEl("button", { text: label, cls: current ? "is-active" : "", attr: { "aria-current": current ? "page" : "false" } });
      button.addEventListener("click", () => { if (page === "history") this.showHistoryPage(); else { this.page = page; this.render(); } });
    }
    if (this.error !== null && this.page !== "detail") container.createEl("p", { text: this.error, cls: "kc-error", attr: { role: "alert" } });
    if (this.page === "workspace") { this.renderWorkspace(container); this.renderBatch(container); }
    if (this.page === "detail") { this.renderDetail(container); if (this.job?.status === "running") this.renderBatch(container); }
    if (this.page === "graph") this.renderGlobalGraph(container);
    if (this.page === "history" || this.page === "history-detail") this.renderHistory(container);
    this.contentEl.scrollTop = scroll;
  }
  private renderWorkspace(container: HTMLElement): void {
    container.createEl("h3", { text: "文章工作台" });
    if (this.inboxError !== null) container.createEl("p", { text: this.inboxError, cls: "kc-error" });
    const items = this.items(), selection = this.workspaceState.selection(items), cta = this.workspaceState.cta(items);
    const filters = container.createDiv({ cls: "kc-filter-bar", attr: { "aria-label": "文章筛选" } });
    for (const [id, label] of [["all", "全部"], ["pending", "未分析"], ["analyzed", "已分析"], ["failed", "分析失败"]] as Array<[ArticleFilter, string]>) {
      const button = filters.createEl("button", { text: label, cls: this.workspaceState.filter === id ? "is-active" : "", attr: { "aria-pressed": String(this.workspaceState.filter === id) } });
      button.addEventListener("click", () => { this.workspaceState.filter = id; this.render(); });
    }
    const select = container.createDiv({ cls: "kc-select-all" });
    const label = select.createEl("label"); const all = label.createEl("input", { attr: { type: "checkbox", "aria-label": "全选当前筛选结果" } });
    all.checked = selection.all; all.indeterminate = selection.indeterminate; all.disabled = this.busy() || selection.visible.length === 0;
    all.addEventListener("change", () => { this.workspaceState.toggleAll(items); this.render(); }); label.createSpan({ text: "全选当前结果" });
    select.createSpan({ text: `已选择 ${selection.checked.length} 篇`, cls: "kc-muted" });
    if (selection.hiddenCount > 0) container.createEl("p", { text: `其他筛选下还有 ${selection.hiddenCount} 篇已勾选，已保留；本次仅分析当前筛选的选择。`, cls: "kc-muted" });
    const primary = container.createEl("button", { text: cta.label, cls: "mod-cta kc-primary" }); primary.disabled = this.busy() || cta.disabled;
    primary.addEventListener("click", () => this.actions.onAnalyze([...cta.ids]));
    const list = container.createEl("section", { cls: "kc-batch-articles", attr: { "aria-label": "文章列表" } });
    const listHeader = list.createDiv({ cls: "kc-section-heading" }); listHeader.createEl("h4", { text: `${selection.visible.length} 篇文章` });
    const refresh = listHeader.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "刷新文章列表" } }); setIcon(refresh, "refresh-cw"); refresh.addEventListener("click", () => this.actions.onRefresh());
    if (this.inbox === null) list.createEl("p", { text: "正在读取文章…", cls: "kc-muted" });
    else if (selection.visible.length === 0) list.createEl("p", { text: items.length === 0 ? EMPTY_STATES.articles : "当前筛选下没有文章", cls: "kc-empty" });
    for (const item of selection.visible) {
      const active = this.workspaceState.activeArticleId === item.path, checked = this.workspaceState.selectedArticleIds.has(item.path);
      const row = list.createDiv({ cls: `kc-batch-row${active ? " is-active-article" : ""}${checked ? " is-checked" : ""}` });
      const checkbox = row.createEl("input", { attr: { type: "checkbox", "aria-label": `选择文章：${this.title(item.path)}` } });
      checkbox.checked = checked; checkbox.disabled = this.busy();
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => { this.workspaceState.toggle(item.path); this.render(); });
      const card = row.createEl("button", { cls: "kc-article", attr: { "aria-current": active ? "true" : "false", title: this.title(item.path) } });
      const text = card.createSpan({ cls: "kc-article-text" }); text.createEl("strong", { text: this.title(item.path) });
      text.createEl("time", { text: new Date(item.modified).toLocaleDateString(), attr: { datetime: new Date(item.modified).toISOString() } });
      card.createSpan({ text: item.status === "pending" ? "未分析" : ARTICLE_STATUS_LABELS[item.status], cls: `kc-badge kc-${item.status}` });
      const chevron = card.createSpan({ cls: "kc-chevron", attr: { "aria-hidden": "true" } }); setIcon(chevron, "chevron-right");
      card.addEventListener("click", () => this.actions.onSelectArticle(item.path));
    }
  }
  private renderBatch(container: HTMLElement): void {
    if (this.job === null) return;
    const job = this.job, section = container.createEl("section", { cls: "kc-batch-progress", attr: { "aria-label": "批量分析进度", "aria-live": "polite" } });
    section.createEl("h3", { text: job.status === "running" ? `正在分析 ${job.total} 篇文章` : job.status === "cancelled" ? "批量分析已停止" : "批量分析已结束" });
    section.createEl("p", { text: `已完成 ${job.completed} · 处理中 ${job.running} · 等待 ${job.pending} · 失败 ${job.failed}${job.cancelled ? ` · 已取消 ${job.cancelled}` : ""}` });
    const processed = job.completed + job.failed;
    const meter = section.createEl("progress", { attr: { max: String(job.total), value: String(processed), "aria-label": "已处理文章数" } }); meter.setAttribute("title", `${processed} / ${job.total}`);
    section.createEl("p", { text: `${processed} / ${job.total}`, cls: "kc-muted" });
    if (job.currentArticleId !== undefined) section.createEl("p", { text: `正在分析：${this.title(job.currentArticleId)}` });
    if (job.currentStage !== undefined) section.createEl("p", { text: job.currentStage, cls: "kc-progress" });
    if (job.status === "running") {
      const cancel = section.createEl("button", { text: job.cancelRequested ? "当前文章结束后停止" : "取消后续任务" }); cancel.disabled = job.cancelRequested;
      cancel.addEventListener("click", () => this.actions.onCancelBatch?.());
      section.createEl("p", { text: "取消不会中断当前请求；当前文章完成后停止后续任务，保留已完成的更新。", cls: "kc-muted" });
    }
    for (const task of job.tasks.filter((task) => task.status === "failed")) {
      const row = section.createDiv({ cls: "kc-error" });
      const open = row.createEl("button", { text: `${this.title(task.articleId)} · ${BATCH_STATUS_LABELS[task.status]}`, cls: "kc-file-link" }); open.addEventListener("click", () => this.actions.onSelectArticle(task.articleId));
      row.createEl("p", { text: task.error ?? "分析失败，请重新选择后重试。" });
    }
  }
  private renderDetail(container: HTMLElement): void {
    this.back(container, "← 返回文章列表", () => { this.page = "workspace"; this.render(); });
    const id = this.workspaceState.activeArticleId;
    container.createEl("h3", { text: id === null ? "文章详情" : this.title(id) });
    const item = this.items().find((item) => item.path === id);
    if (item !== undefined) container.createEl("p", { text: item.status === "pending" ? "未分析" : ARTICLE_STATUS_LABELS[item.status], cls: "kc-muted" });
    if (this.error !== null) { const error = container.createDiv({ cls: "kc-error", attr: { role: "alert" } }); if (this.failed) error.createEl("strong", { text: "分析失败" }); error.createEl("p", { text: this.error }); }
    if (this.result === null) { container.createEl("p", { text: "尚无有效分析结果。返回列表，只勾选这篇文章即可分析或重试。", cls: "kc-empty" }); return; }
    const result = this.result, tabs = container.createDiv({ cls: "kc-tabs", attr: { role: "tablist", "aria-label": "分析结果分类" } });
    for (const [id, label] of [["analysis", "文章分析"], ["points", "知识点"]] as const) {
      const tab = tabs.createEl("button", { text: label, cls: this.tab === id ? "is-active" : "", attr: { role: "tab", id: `kc-tab-${id}`, "aria-selected": String(this.tab === id), "aria-controls": "kc-result-panel", tabindex: this.tab === id ? "0" : "-1" } });
      tab.addEventListener("click", () => { this.tab = id; this.render(); this.contentEl.querySelector<HTMLButtonElement>(`#kc-tab-${id}`)?.focus(); });
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); this.tab = event.key === "Home" ? "analysis" : event.key === "End" ? "points" : this.tab === "analysis" ? "points" : "analysis";
        this.render(); this.contentEl.querySelector<HTMLButtonElement>(`#kc-tab-${this.tab}`)?.focus();
      });
    }
    const panel = container.createDiv({ cls: "kc-result-panel", attr: { role: "tabpanel", id: "kc-result-panel", "aria-labelledby": `kc-tab-${this.tab}` } });
    if (this.tab === "analysis") this.renderAnalysis(panel, result); else this.renderPoints(panel, result);
    const update = container.createDiv({ cls: "kc-update", attr: { role: "status" } }); update.createEl("p", { text: result.updateMessage });
    if (result.wikiPath !== undefined) this.fileLink(update, result.wikiPath, "查看知识文档");
    for (const warning of result.warnings) update.createEl("p", { text: warning, cls: "kc-warning" });
  }
  private renderAnalysis(panel: HTMLElement, result: ProductArticleResult): void {
    const a = result.analysis, p = result.preferences;
    this.metric(panel, "质量", p.quality ? { A: "优秀", B: "良好", C: "一般", D: "需谨慎" }[a.sourceQuality.grade] : "未检测", p.quality ? a.sourceQuality.reason : "已在分析偏好中关闭。");
    const conflicts = this.metric(panel, "冲突", p.conflicts ? `${a.conflicts.length} 处` : "未检测", !p.conflicts ? "已在分析偏好中关闭。" : a.conflicts.length === 0 ? "未发现明显口径冲突。" : `${result.verifications.length} 处已完成外部核验；其他差异需结合来源判断。`);
    if (p.conflicts) for (const conflict of a.conflicts) {
      conflicts.createEl("p", { text: `文章：${conflict.newClaim}` }); conflicts.createEl("p", { text: `已有知识：${conflict.existingClaim}` });
      conflicts.createEl("p", { text: conflict.explanation }); this.fileLink(conflicts, conflict.existingFile, "查看已有知识");
      const verification = result.verifications.find((item) => item.newClaim === conflict.newClaim && item.existingClaim === conflict.existingClaim);
      if (verification !== undefined) conflicts.createEl("p", { text: verification.result.conclusion });
    }
    const duplicateCount = a.claimAnalysis?.comparisons.filter((item) => item.relation === "reinforce").length ?? a.duplicateWith.length;
    const duplicates = this.metric(panel, "重复", p.duplicates ? `${duplicateCount} 处` : "未检测", p.duplicates ? "已覆盖的重复内容不会重复写入。" : "已在分析偏好中关闭。");
    if (p.duplicates) for (const item of a.claimAnalysis?.comparisons.filter((item) => item.relation === "reinforce") ?? []) duplicates.createEl("p", { text: item.candidateStatement });
    this.metric(panel, "时效性", p.freshness ? result.freshness.text : "未检测", p.freshness ? result.freshness.detail : "已在分析偏好中关闭。");
    const differences = knowledgeDifferences(a), additions = differences.filter((item) => item.kind === "新增知识").length;
    const delta = this.metric(panel, "新增 / 差异", `${additions} 条新增 · ${differences.length - additions} 条补充`, "仅展示已有分析数据支持的新增知识或补充知识，不把重复内容换句话计为新增。");
    for (const difference of differences) { delta.createEl("p", { text: `${difference.kind}：${difference.text}` }); if (difference.detail) delta.createEl("p", { text: difference.detail, cls: "kc-muted" }); }
  }
  private renderPoints(panel: HTMLElement, result: ProductArticleResult): void {
    panel.createEl("h4", { text: `知识点（${result.points.length}）` });
    if (result.points.length === 0) panel.createEl("p", { text: EMPTY_STATES.points, cls: "kc-empty" });
    result.points.forEach((point, index) => { const details = panel.createEl("details", { cls: "kc-point kc-detail" }); details.createEl("summary", { text: `${index + 1}. ${point.text}` }); this.pointDetails(details, point); });
  }
  private renderGlobalGraph(container: HTMLElement): void {
    container.createEl("h3", { text: "知识关系思维导图" });
    container.createEl("p", { text: "AI 建议关系：不是已验证事实；知识关系不会自动合并或删除文档。", cls: "kc-muted" });
    const graph = this.actions.getGlobalGraph?.();
    if (graph === undefined || graph.nodes.length === 0) { container.createEl("p", { text: "暂未发现知识关联。分析并更新知识库后，可在这里查看整个知识库的关系。", cls: "kc-empty" }); return; }
    if (!["ready", "partial"].includes(graph.stats.status)) container.createEl("p", { text: "以下为已有关系记录，可能尚未反映最近的知识更新。", cls: "kc-warning" });
    const groups = groupGlobalGraph(graph); container.createEl("p", { text: `${groups.length} 个主题或文档 · ${graph.nodes.length} 个知识点 · ${graph.edges.length} 条关系`, cls: "kc-muted" });
    const toolbar = container.createDiv({ cls: "kc-map-tools" });
    const viewport = container.createDiv({ cls: "kc-global-viewport", attr: { tabindex: "0", "aria-label": "知识关系图画布，可拖动平移，滚轮缩放，方向键平移" } });
    const canvas = viewport.createDiv({ cls: "kc-global-canvas" });
    const transform = () => { canvas.style.transform = this.viewport.transform(); };
    for (const [text, action] of [["缩小", () => this.viewport.zoom(1 / 1.2)], ["放大", () => this.viewport.zoom(1.2)], ["重置视图", () => this.viewport.reset()]] as Array<[string, () => void]>) {
      const button = toolbar.createEl("button", { text }); button.addEventListener("click", () => { action(); transform(); });
    }
    let drag: { x: number; y: number; pointer: number } | null = null;
    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button, summary, input, a")) return;
      drag = { x: event.clientX, y: event.clientY, pointer: event.pointerId }; viewport.setPointerCapture?.(event.pointerId); event.preventDefault();
    });
    viewport.addEventListener("pointermove", (event) => { if (drag === null) return; this.viewport.pan(event.clientX - drag.x, event.clientY - drag.y); drag.x = event.clientX; drag.y = event.clientY; transform(); });
    const release = () => { if (drag !== null && viewport.hasPointerCapture?.(drag.pointer)) viewport.releasePointerCapture(drag.pointer); drag = null; };
    viewport.addEventListener("pointerup", release); viewport.addEventListener("pointercancel", release);
    viewport.addEventListener("wheel", (event) => { event.preventDefault(); this.viewport.zoom(Math.exp(-event.deltaY * .002)); transform(); }, { passive: false });
    viewport.addEventListener("keydown", (event) => {
      const directions: Record<string, [number, number]> = { ArrowLeft: [24, 0], ArrowRight: [-24, 0], ArrowUp: [0, 24], ArrowDown: [0, -24] };
      if (event.target !== viewport) return; const delta = directions[event.key]; if (delta !== undefined) { event.preventDefault(); this.viewport.pan(...delta); transform(); }
    });
    for (const group of groups) {
      const details = canvas.createEl("details", { cls: "kc-global-group" }); details.open = this.expandedGroups.has(group.title);
      details.createEl("summary", { text: `${group.title} · ${group.nodes.length} 个知识点` });
      details.addEventListener("toggle", () => { if (details.open) this.expandedGroups.add(group.title); else this.expandedGroups.delete(group.title); });
      const drawNode = (parent: HTMLElement, node: typeof group.nodes[number]) => { const button = parent.createEl("button", { text: node.statement.length > 80 ? `${node.statement.slice(0, 80)}…` : node.statement, cls: "kc-global-node" }); button.addEventListener("click", () => { this.graphNode = node.claimId; this.render(); }); };
      for (const node of group.nodes.slice(0, 5)) drawNode(details, node);
      if (group.nodes.length > 5) { const more = details.createEl("details"); more.createEl("summary", { text: `展开其余 ${group.nodes.length - 5} 个知识点` }); for (const node of group.nodes.slice(5)) drawNode(more, node); }
      for (const edge of group.relations.slice(0, 10)) {
        const from = graph.nodes.find((node) => node.claimId === edge.fromClaimId), to = graph.nodes.find((node) => node.claimId === edge.toClaimId);
        details.createEl("p", { text: `${from?.statement.slice(0, 24) ?? "知识点"} → ${GLOBAL_RELATION_LABELS[edge.relation]} → ${to?.statement.slice(0, 24) ?? "知识点"}`, cls: "kc-map-relation" });
      }
      if (group.relations.length > 10) details.createEl("p", { text: "画布显示前 10 条一级关系；点击知识点可查看该点全部关系。", cls: "kc-muted" });
    }
    transform();
    if (graph.edges.length === 0) container.createEl("p", { text: EMPTY_STATES.relations, cls: "kc-empty" });
    if (this.graphNode !== null) {
      const detail = globalNodeDetails(graph, this.graphNode, this.actions.getClaims?.() ?? []);
      if (detail !== null) {
        const panel = container.createDiv({ cls: "kc-detail" }); panel.createEl("h4", { text: "知识点详情" }); panel.createEl("p", { text: detail.node.statement });
        this.fileLink(panel, detail.wikiPath, `来源 Wiki：${detail.wikiPath}`);
        for (const path of detail.sourceArticles) this.fileLink(panel, path, `来源文章：${path}`);
        if (detail.updatedAt !== undefined) panel.createEl("p", { text: `更新时间：${new Date(detail.updatedAt).toLocaleString()}` });
        else panel.createEl("p", { text: `建立时间：${new Date(detail.node.createdAt).toLocaleString()}` });
        for (const relation of detail.relations) panel.createEl("p", { text: `${relation.direction} ${relation.label}：${relation.other?.statement ?? "对应知识点暂不可用"}` });
      }
    }
  }
  private renderHistory(container: HTMLElement): void {
    if (this.page === "history-detail" && this.historyEntry !== null) {
      const entry = this.historyEntry; this.back(container, "← 返回变更记录", () => { this.page = "history"; this.render(); });
      container.createEl("h3", { text: entry.articleTitle }); container.createEl("p", { text: new Date(entry.timestamp).toLocaleString() });
      container.createEl("p", { text: entry.decision === "accepted" ? "已更新知识文档" : "该建议已拒绝，未写入知识文档" });
      this.fileLink(container, entry.source, "来源文章"); for (const path of entry.wikiFiles) this.fileLink(container, path, `知识文档：${path}`);
      container.createEl("p", { text: "以下为原更新记录中的变更片段，不是完整文件快照。", cls: "kc-muted" });
      for (const change of entry.changes) {
        const section = container.createDiv({ cls: "kc-history-change" }); section.createEl("h4", { text: "变更前" }); section.createEl("pre", { text: change.before ?? "原记录未包含变更前片段。" });
        section.createEl("h4", { text: "变更后" }); section.createEl("pre", { text: change.after }); section.createEl("p", { text: `原因：${change.reason}` });
        for (const source of change.sourceClaims) section.createEl("p", { text: `来源知识：${source}`, cls: "kc-muted" });
      }
      return;
    }
    container.createEl("h3", { text: "变更记录" });
    if (this.historyLoading) { container.createEl("p", { text: "正在读取更新记录…" }); return; }
    if (this.historyError) { container.createEl("p", { text: "暂时无法读取变更记录，请重新打开此页。", cls: "kc-error" }); return; }
    if (this.historyUnreadable > 0) container.createEl("p", { text: `${this.historyUnreadable} 条记录未能读取，其他记录正常显示。`, cls: "kc-warning" });
    if (this.historyEntries.length === 0) container.createEl("p", { text: "暂无变更记录。更新知识库后，可在这里查看修改内容和来源。", cls: "kc-empty" });
    for (const entry of this.historyEntries) {
      const card = container.createEl("button", { cls: "kc-history-card" }); card.createEl("time", { text: new Date(entry.timestamp).toLocaleString() }); card.createEl("strong", { text: entry.articleTitle });
      card.createEl("p", { text: entry.decision === "rejected" ? "已拒绝 · 未写入" : `新增知识 ${entry.addedCount} · 补充知识 ${entry.refinedCount}${entry.conflictCount === undefined ? "" : ` · 冲突 ${entry.conflictCount}`}${entry.duplicateSkippedCount === undefined ? "" : ` · 跳过重复 ${entry.duplicateSkippedCount}`}` });
      card.createEl("p", { text: `${entry.decision === "accepted" ? "更新" : "目标"}：${entry.wikiFiles.join("、")}` }); card.addEventListener("click", () => { this.historyEntry = entry; this.page = "history-detail"; this.render(); });
    }
  }
  private pointDetails(container: HTMLElement, point: KnowledgePointDisplay): void {
    this.fileLink(container, point.sourcePath, "来源文章"); for (const path of point.wikiPaths) this.fileLink(container, path, `对应知识文档：${path.split("/").pop()?.replace(/\.md$/u, "") ?? path}`);
    if (point.updatedAt !== undefined) container.createEl("p", { text: `更新时间：${new Date(point.updatedAt).toLocaleString()}`, cls: "kc-muted" });
  }
  private metric(container: HTMLElement, label: string, value: string, detail: string): HTMLElement {
    const metric = container.createEl("details", { cls: "kc-metric" }); const summary = metric.createEl("summary"); summary.createSpan({ text: label }); summary.createEl("strong", { text: value }); metric.createEl("p", { text: detail, cls: "kc-muted" }); return metric;
  }
  private back(container: HTMLElement, label: string, action: () => void): void { const button = container.createEl("button", { text: label, cls: "kc-back" }); button.addEventListener("click", action); }
  private fileLink(container: HTMLElement, path: string, label: string): void { const link = container.createEl("button", { text: label, cls: "kc-file-link" }); link.addEventListener("click", () => this.actions.onOpenFile(path)); }
}
