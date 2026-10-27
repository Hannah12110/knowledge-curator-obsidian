import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { InboxScanResult } from "../types/knowledge";
import {
  ARTICLE_STATUS_LABELS, EMPTY_STATES, articleRelations,
  type ProductArticleResult, type KnowledgePointDisplay
} from "../product/workflow-presenter";

export const KNOWLEDGE_CURATOR_VIEW_TYPE = "knowledge-curator-sidebar";
export interface KnowledgeCuratorViewActions {
  onRefresh(): void;
  onSelectArticle(path: string): void;
  onAnalyze(): void;
  onOpenFile(path: string): void;
  onOpenSettings(): void;
}
type ResultTab = "analysis" | "points" | "relations";

export class KnowledgeCuratorView extends ItemView {
  private selected: string | null = null;
  private inbox: InboxScanResult | null = null;
  private inboxError: string | null = null;
  private result: ProductArticleResult | null = null;
  private progress: string | null = null;
  private error: string | null = null;
  private failed = false;
  private tab: ResultTab = "analysis";

  constructor(leaf: WorkspaceLeaf, private readonly actions: KnowledgeCuratorViewActions) { super(leaf); }
  getViewType(): string { return KNOWLEDGE_CURATOR_VIEW_TYPE; }
  getDisplayText(): string { return "Knowledge Curator"; }
  getIcon(): string { return "library-big"; }
  async onOpen(): Promise<void> { this.render(); this.actions.onRefresh(); }
  async onClose(): Promise<void> { /* DOM listeners belong to discarded elements. */ }
  getSelectedArticle(): string | null { return this.selected; }
  selectArticle(path: string): void {
    if (this.selected !== path) { this.result = null; this.tab = "analysis"; }
    this.selected = path; this.error = null; this.failed = false; this.render();
  }
  showInbox(result: InboxScanResult): void { this.inbox = result; this.inboxError = null; this.render(); }
  showInboxError(message: string): void { this.inboxError = message; this.render(); }
  showProgress(message: string): void { this.progress = message; this.error = null; this.failed = false; this.render(); }
  finishProgress(): void { this.progress = null; this.render(); }
  showResult(result: ProductArticleResult | null): void { this.result = result; this.error = null; this.failed = false; this.render(); }
  showError(message: string, failed = false): void { this.error = message; this.failed = failed; this.progress = null; this.render(); }

  private render(): void {
    const scroll = this.contentEl.scrollTop;
    const container = this.contentEl;
    container.empty(); container.addClass("knowledge-curator-view", "kc-workflow");
    const header = container.createDiv({ cls: "kc-heading" });
    const title = header.createDiv();
    title.createEl("h2", { text: "Knowledge Curator" });
    title.createEl("p", { text: "把文章整理成可维护的知识点", cls: "kc-muted" });
    const settings = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "打开知识整理设置", title: "设置" } });
    setIcon(settings, "settings"); settings.addEventListener("click", () => this.actions.onOpenSettings());
    const primary = container.createEl("button", { text: this.progress ?? (this.failed ? "重新分析" : "一键分析文章"), cls: "mod-cta kc-primary" });
    primary.disabled = this.progress !== null;
    primary.addEventListener("click", () => this.actions.onAnalyze());
    container.setAttribute("aria-busy", String(this.progress !== null));
    if (this.progress !== null) container.createEl("p", { text: this.progress, cls: "kc-progress", attr: { role: "status", "aria-live": "polite" } });
    if (this.error !== null) {
      const error = container.createDiv({ cls: "kc-error", attr: { role: "alert" } });
      if (this.failed) error.createEl("strong", { text: "分析失败" });
      error.createEl("p", { text: this.error });
    }
    this.renderArticles(container);
    this.renderResult(container);
    this.contentEl.scrollTop = scroll;
  }

  private renderArticles(container: HTMLElement): void {
    const section = container.createEl("section", { cls: "kc-articles", attr: { "aria-label": "文章列表" } });
    const header = section.createDiv({ cls: "kc-section-heading" });
    header.createEl("h3", { text: "文章列表" });
    const refresh = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "刷新文章列表", title: "刷新文章列表" } });
    setIcon(refresh, "refresh-cw"); refresh.disabled = this.progress !== null;
    refresh.addEventListener("click", () => this.actions.onRefresh());
    if (this.inboxError !== null) { section.createEl("p", { text: this.inboxError, cls: "kc-error" }); return; }
    if (this.inbox === null) { section.createEl("p", { text: "正在读取文章…", cls: "kc-muted" }); return; }
    if (this.inbox.state === "missing" || this.inbox.items.length === 0) {
      section.createEl("p", { text: EMPTY_STATES.articles, cls: "kc-empty" });
      if (this.inbox.state === "missing") section.createEl("p", { text: `请创建 ${this.inbox.configuredPath}，或在设置中选择现有资料目录。`, cls: "kc-muted" });
      return;
    }
    for (const item of this.inbox.items) {
      const name = item.frontmatter?.title;
      const title = typeof name === "string" && name.trim().length > 0 ? name : item.basename;
      const card = section.createEl("button", { cls: `kc-article${this.selected === item.path ? " is-selected" : ""}`,
        attr: { "aria-pressed": String(this.selected === item.path), title } });
      card.disabled = this.progress !== null;
      const text = card.createSpan({ cls: "kc-article-text" });
      text.createEl("strong", { text: title });
      text.createEl("time", { text: new Date(item.modified).toLocaleDateString(), attr: { datetime: new Date(item.modified).toISOString() } });
      card.createSpan({ text: ARTICLE_STATUS_LABELS[item.status], cls: `kc-badge kc-${item.status}` });
      const chevron = card.createSpan({ cls: "kc-chevron", attr: { "aria-hidden": "true" } }); setIcon(chevron, "chevron-right");
      card.addEventListener("click", () => this.actions.onSelectArticle(item.path));
    }
  }

  private renderResult(container: HTMLElement): void {
    const section = container.createEl("section", { cls: "kc-results", attr: { "aria-label": "当前文章分析结果" } });
    section.createEl("h3", { text: "当前文章分析结果" });
    if (this.result === null) {
      section.createEl("p", { text: this.selected === null ? "请先选择一篇待分析文章" : "点击“一键分析文章”，整理这篇文章。", cls: "kc-empty" });
      return;
    }
    const result = this.result;
    section.createEl("p", { text: result.title, cls: "kc-result-title" });
    const tabs = section.createDiv({ cls: "kc-tabs", attr: { role: "tablist", "aria-label": "分析结果分类" } });
    const names: Array<[ResultTab, string]> = [["analysis", "文章分析"], ["points", "知识点"], ["relations", "知识关系"]];
    for (const [id, name] of names) {
      const tab = tabs.createEl("button", { text: name, cls: this.tab === id ? "is-active" : "", attr: {
        role: "tab", id: `kc-tab-${id}`, "aria-selected": String(this.tab === id), "aria-controls": "kc-result-panel",
        tabindex: this.tab === id ? "0" : "-1"
      } });
      tab.addEventListener("click", () => { this.tab = id; this.render(); this.contentEl.querySelector<HTMLButtonElement>(`#kc-tab-${id}`)?.focus(); });
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = names.findIndex(([key]) => key === id);
        this.tab = names[event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3]![0];
        this.render(); this.contentEl.querySelector<HTMLButtonElement>(`#kc-tab-${this.tab}`)?.focus();
      });
    }
    const panel = section.createDiv({ cls: "kc-result-panel", attr: { role: "tabpanel", id: "kc-result-panel", "aria-labelledby": `kc-tab-${this.tab}` } });
    if (this.tab === "analysis") this.renderAnalysis(panel, result);
    if (this.tab === "points") this.renderPoints(panel, result);
    if (this.tab === "relations") this.renderRelations(panel, result);
    const update = section.createDiv({ cls: "kc-update", attr: { role: "status" } });
    update.createEl("p", { text: result.updateMessage });
    if (result.wikiPath !== undefined) this.fileLink(update, result.wikiPath, "查看知识文档");
    for (const warning of result.warnings) update.createEl("p", { text: warning, cls: "kc-warning" });
  }

  private renderAnalysis(panel: HTMLElement, result: ProductArticleResult): void {
    const analysis = result.analysis, preferences = result.preferences;
    const quality = { A: "优秀", B: "良好", C: "一般", D: "需谨慎" }[analysis.sourceQuality.grade];
    this.metric(panel, "质量", preferences.quality ? quality : "未检测", preferences.quality ? analysis.sourceQuality.reason : "已在分析偏好中关闭。");
    this.metric(panel, "冲突", preferences.conflicts ? `${analysis.conflicts.length} 处` : "未检测",
      !preferences.conflicts ? "已在分析偏好中关闭。" : analysis.conflicts.length === 0 ? "未发现与已有知识的明显冲突。" :
        `${result.verifications.length} 处已完成外部核验；其余为需要检查的口径差异。`);
    if (preferences.conflicts) for (const conflict of analysis.conflicts) {
      const details = panel.createEl("details", { cls: "kc-detail" });
      details.createEl("summary", { text: conflict.newClaim });
      details.createEl("p", { text: `已有知识：${conflict.existingClaim}` });
      details.createEl("p", { text: conflict.explanation });
      this.fileLink(details, conflict.existingFile, "查看已有知识");
      const verification = result.verifications.find((item) => item.newClaim === conflict.newClaim && item.existingClaim === conflict.existingClaim);
      if (verification !== undefined) details.createEl("p", { text: verification.result.conclusion });
    }
    const duplicateCount = analysis.claimAnalysis === undefined ? analysis.duplicateWith.length :
      analysis.claimAnalysis.comparisons.filter((item) => item.relation === "reinforce").length;
    this.metric(panel, "重复", preferences.duplicates ? `${duplicateCount} 处` : "未检测", preferences.duplicates ? "根据已有知识比较判断，重复内容不会重复写入。" : "已在分析偏好中关闭。");
    this.metric(panel, "时效性", preferences.freshness ? result.freshness.text : "未检测", preferences.freshness ? result.freshness.detail : "已在分析偏好中关闭。");
  }
  private renderPoints(panel: HTMLElement, result: ProductArticleResult): void {
    panel.createEl("h4", { text: `知识点（${result.points.length}）` });
    if (result.points.length === 0) panel.createEl("p", { text: EMPTY_STATES.points, cls: "kc-empty" });
    result.points.forEach((point, index) => {
      const details = panel.createEl("details", { cls: "kc-point kc-detail" });
      details.createEl("summary", { text: `${index + 1}. ${point.text}` });
      this.pointDetails(details, point);
    });
  }
  private renderRelations(panel: HTMLElement, result: ProductArticleResult): void {
    panel.createEl("h4", { text: "知识关系思维导图" });
    panel.createEl("p", { text: "AI 建议关系：模型推测，需结合来源判断，不是已验证事实。", cls: "kc-muted" });
    // Retain the existing release boundary: no autonomous compression or Markdown rewriting by graph.
    panel.createEl("p", { text: "知识关系不会自动合并或删除文档。", cls: "kc-muted" });
    if (!result.preferences.generateRelations) { panel.createEl("p", { text: "已在分析偏好中关闭知识关系生成。", cls: "kc-empty" }); return; }
    const relations = articleRelations(result);
    if (relations.length === 0) { panel.createEl("p", { text: EMPTY_STATES.relations, cls: "kc-empty" }); return; }
    const map = panel.createDiv({ cls: "kc-mindmap", attr: { "aria-label": "知识关系思维导图" } });
    map.createDiv({ text: result.analysis.topic, cls: "kc-map-root" });
    const branches = map.createEl("ul", { cls: "kc-map-branches" });
    for (const relation of relations) {
      const branch = branches.createEl("li", { cls: "kc-map-branch" });
      for (const node of [relation.from, relation.to]) {
        const detail = branch.createEl("details", { cls: "kc-map-node" });
        detail.createEl("summary", { text: node.statement });
        this.fileLink(detail, node.sourcePath, "查看来源知识文档");
        if (node === relation.from) branch.createDiv({ text: `↓ ${relation.label}`, cls: "kc-map-relation" });
      }
    }
  }
  private pointDetails(container: HTMLElement, point: KnowledgePointDisplay): void {
    this.fileLink(container, point.sourcePath, "来源文章");
    for (const path of point.wikiPaths) this.fileLink(container, path, `对应知识文档：${path.split("/").pop()?.replace(/\.md$/u, "") ?? path}`);
    if (point.updatedAt !== undefined) container.createEl("p", { text: `更新时间：${new Date(point.updatedAt).toLocaleString()}`, cls: "kc-muted" });
  }
  private metric(container: HTMLElement, label: string, value: string, detail: string): void {
    const metric = container.createDiv({ cls: "kc-metric" });
    metric.createEl("h4", { text: label }); metric.createEl("strong", { text: value }); metric.createEl("p", { text: detail, cls: "kc-muted" });
  }
  private fileLink(container: HTMLElement, path: string, label: string): void {
    const link = container.createEl("button", { text: label, cls: "kc-file-link" });
    link.addEventListener("click", () => this.actions.onOpenFile(path));
  }
}
