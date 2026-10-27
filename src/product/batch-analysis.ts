import type { InboxItem } from "../types/knowledge";
import type { ArticlePerformanceRecord } from "../services/performance-metrics";

export type ArticleFilter = "all" | "pending" | "analyzed" | "failed";
export type BatchTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export const BATCH_STATUS_LABELS: Record<BatchTaskStatus, string> = { pending: "等待", running: "处理中", completed: "完成", failed: "失败", cancelled: "已取消" };
export interface BatchArticleTask { articleId: string; status: BatchTaskStatus; startedAt?: string; finishedAt?: string; error?: string; metrics?: ArticlePerformanceRecord; }
export interface BatchAnalysisJob {
  id: string; createdAt: string; articleIds: string[]; status: BatchTaskStatus; total: number; completed: number; running: number; failed: number; pending: number; cancelled: number;
  currentArticleId?: string; currentStage?: string; startedAt?: string; finishedAt?: string; cancelRequested: boolean; tasks: BatchArticleTask[];
}

export class BatchWorkspaceState {
  activeArticleId: string | null = null;
  readonly selectedArticleIds = new Set<string>();
  filter: ArticleFilter = "pending";
  visible(items: InboxItem[]): InboxItem[] {
    return items.filter((item) => this.filter === "all" || (this.filter === "pending" ? item.status === "pending" || item.status === "analyzing" : item.status === this.filter));
  }
  toggle(id: string): void { if (this.selectedArticleIds.has(id)) this.selectedArticleIds.delete(id); else this.selectedArticleIds.add(id); }
  selection(items: InboxItem[]) {
    const visible = this.visible(items), checked = visible.filter((item) => this.selectedArticleIds.has(item.path));
    return { visible, checked, all: visible.length > 0 && checked.length === visible.length, indeterminate: checked.length > 0 && checked.length < visible.length,
      hiddenCount: [...this.selectedArticleIds].filter((id) => items.some((item) => item.path === id) && !visible.some((item) => item.path === id)).length };
  }
  toggleAll(items: InboxItem[]): void {
    const { visible, all } = this.selection(items);
    for (const item of visible) { if (all) this.selectedArticleIds.delete(item.path); else this.selectedArticleIds.add(item.path); }
  }
  targetIds(items: InboxItem[]): string[] {
    const { visible, checked } = this.selection(items);
    if (checked.length > 0) return checked.map((item) => item.path);
    return this.filter === "pending" ? visible.filter((item) => item.status === "pending").map((item) => item.path) : [];
  }
  cta(items: InboxItem[]) {
    const { checked } = this.selection(items), ids = this.targetIds(items);
    return { ids, label: checked.length > 0 ? `分析所选 ${checked.length} 篇` : this.filter === "pending" && ids.length > 0 ? "分析全部未分析文章" : items.some((item) => item.status === "pending") ? "请先勾选文章" : "暂无待分析文章", disabled: ids.length === 0 };
  }
}

export class BatchAnalysisQueue {
  private job: BatchAnalysisJob | null = null;
  private listeners = new Set<(job: BatchAnalysisJob) => void>();
  private disposed = false;
  snapshot(): BatchAnalysisJob | null { return this.job === null ? null : structuredClone(this.job); }
  isRunning(): boolean { return this.job?.status === "running"; }
  subscribe(listener: (job: BatchAnalysisJob) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  cancel(): void { if (this.job?.status === "running") { this.job.cancelRequested = true; this.emit(); } }
  dispose(): void { this.cancel(); this.disposed = true; this.listeners.clear(); }
  async start(ids: string[], run: (id: string, progress: (stage: string) => void) => Promise<{ metrics?: ArticlePerformanceRecord } | void>): Promise<BatchAnalysisJob> {
    if (this.disposed || this.isRunning()) throw new Error("Batch queue unavailable.");
    const articleIds = [...new Set(ids)];
    if (articleIds.length === 0) throw new Error("Empty batch.");
    const now = new Date().toISOString();
    this.job = { id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now, articleIds, status: "running", total: articleIds.length,
      completed: 0, running: 0, failed: 0, pending: articleIds.length, cancelled: 0, startedAt: now, cancelRequested: false,
      tasks: articleIds.map((articleId) => ({ articleId, status: "pending" })) };
    this.emit();
    for (const task of this.job.tasks) {
      if (this.job.cancelRequested || this.disposed) { task.status = "cancelled"; task.finishedAt = new Date().toISOString(); continue; }
      task.status = "running"; task.startedAt = new Date().toISOString(); this.job.currentArticleId = task.articleId; this.job.currentStage = "分析文章"; this.emit();
      try {
        const result = await run(task.articleId, (stage) => { if (this.job !== null) { this.job.currentStage = stage; this.emit(); } });
        task.status = "completed"; task.metrics = result?.metrics;
      } catch (error) {
        task.status = "failed";
        task.error = typeof (error as { userMessage?: unknown })?.userMessage === "string" ? (error as { userMessage: string }).userMessage : "分析失败，请检查配置后重试。";
        task.metrics = (error as { metrics?: ArticlePerformanceRecord })?.metrics;
      }
      task.finishedAt = new Date().toISOString(); this.job.currentArticleId = undefined; this.emit();
    }
    this.job.status = this.job.tasks.some((task) => task.status === "cancelled") ? "cancelled" : this.job.tasks.some((task) => task.status === "failed") ? "failed" : "completed";
    this.job.finishedAt = new Date().toISOString(); this.job.currentArticleId = undefined; this.job.currentStage = undefined; this.emit();
    return this.snapshot()!;
  }
  private emit(): void {
    if (this.job === null) return;
    for (const status of ["completed", "running", "failed", "pending", "cancelled"] as const) this.job[status] = this.job.tasks.filter((task) => task.status === status).length;
    for (const listener of this.listeners) listener(this.snapshot()!);
  }
}
