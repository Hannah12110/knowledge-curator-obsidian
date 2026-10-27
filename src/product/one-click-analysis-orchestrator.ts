import type { CachedSourceAnalysis } from "../types/analysis";
import type { KnowledgePR } from "../types/knowledge-pr";
import type { CachedConflictVerification } from "../types/verification";
import type { AnalysisPreferences } from "../types/settings";
import type { FreshnessDisplay } from "./workflow-presenter";

export const WORKFLOW_PROGRESS = {
  analysis: "正在分析文章…", comparison: "正在检查已有知识…", points: "正在整理知识点…", write: "正在更新知识库…"
} as const;
export type WorkflowProgress = typeof WORKFLOW_PROGRESS[keyof typeof WORKFLOW_PROGRESS];
export interface OneClickWorkflowPorts {
  prepareIndex(): Promise<void>;
  analyze(progress: (stage: WorkflowProgress) => void): Promise<CachedSourceAnalysis>;
  verifyConflicts(entry: CachedSourceAnalysis): Promise<CachedConflictVerification[]>;
  assessFreshness(entry: CachedSourceAnalysis): Promise<FreshnessDisplay>;
  previousUpdate(): Promise<KnowledgePR | null>;
  generateUpdate(entry: CachedSourceAnalysis, verifications: CachedConflictVerification[]): Promise<KnowledgePR>;
  assertUnchanged(): Promise<void>;
  write(pr: KnowledgePR, entry: CachedSourceAnalysis, verifications: CachedConflictVerification[]): Promise<{ claimStoreUpdated?: boolean }>;
  refreshIndex(path: string): Promise<void>;
  buildRelations(): Promise<{ failedPairs: number }>;
  log(error: unknown): void;
}
export interface OneClickWorkflowOutcome {
  entry: CachedSourceAnalysis;
  verifications: CachedConflictVerification[];
  freshness: FreshnessDisplay;
  wikiPath?: string;
  updateMessage: string;
  warnings: string[];
}

export class OneClickAnalysisOrchestrator {
  private busy = false;
  private disposed = false;
  isBusy(): boolean { return this.busy; }
  dispose(): void { this.disposed = true; }

  async run(ports: OneClickWorkflowPorts, preferences: AnalysisPreferences, progress: (stage: WorkflowProgress) => void): Promise<OneClickWorkflowOutcome> {
    if (this.busy) throw Object.assign(new Error("Workflow already running."), { code: "busy" });
    this.assertActive();
    this.busy = true;
    try {
      progress(WORKFLOW_PROGRESS.comparison);
      if (preferences.extractKnowledge) await ports.prepareIndex();
      this.assertActive();
      progress(WORKFLOW_PROGRESS.analysis);
      const entry = await ports.analyze(progress);
      this.assertActive();
      let verifications: CachedConflictVerification[] = [];
      const warnings: string[] = [];
      progress(WORKFLOW_PROGRESS.comparison);
      if (preferences.conflicts && entry.analysis.conflicts.length > 0) {
        verifications = await ports.verifyConflicts(entry);
        if (verifications.length < entry.analysis.conflicts.length) warnings.push("部分冲突尚未完成外部核验；不会据此自动替换已有结论。");
      }
      progress(WORKFLOW_PROGRESS.points);
      const freshness = preferences.freshness
        ? await ports.assessFreshness(entry)
        : { text: "未检测", detail: "已在分析偏好中关闭时效性检测。" };
      const previous = await ports.previousUpdate();
      let wikiPath: string | undefined;
      let updateMessage = preferences.updateWiki ? "未发现需要写入的知识增量。" : "已关闭自动更新知识库。";
      const writable = preferences.updateWiki && preferences.extractKnowledge && entry.analysis.recommendation !== "reject" &&
        (entry.analysis.newClaims.length > 0 || entry.analysis.conflicts.length > 0);
      if (previous !== null) {
        wikiPath = previous.target.path;
        updateMessage = "这篇文章已更新过知识库，本次未重复写入。";
        // Recover a prior post-write indexing failure without replaying the Wiki change.
        if (preferences.extractKnowledge) {
          try { await ports.refreshIndex(wikiPath); }
          catch (error) { ports.log(error); warnings.push("已有知识更新仍保留，但知识索引更新失败，请在设置中重试。"); }
        }
      } else if (writable) {
        progress(WORKFLOW_PROGRESS.write);
        const pr = await ports.generateUpdate(entry, verifications);
        this.assertActive();
        await ports.assertUnchanged();
        const written = await ports.write(pr, entry, verifications);
        wikiPath = pr.target.path;
        const count = new Set(pr.changes.flatMap((change) => change.sourceClaims)).size;
        updateMessage = `已更新 ${count} 个知识点。`;
        if (written.claimStoreUpdated === false) warnings.push("知识文档已更新，但知识索引更新失败，请在设置中更新索引；重新分析不会重复写入。");
      } else if (!preferences.extractKnowledge && preferences.updateWiki) {
        updateMessage = "提取知识点已关闭，本次未写入知识库。";
      } else if (entry.analysis.recommendation === "reject") {
        updateMessage = entry.analysis.claimAnalysis?.comparisons.length && entry.analysis.claimAnalysis.comparisons.every((item) => item.relation === "reinforce")
          ? "内容已被现有知识覆盖，本次未重复写入。" : "这篇文章暂不适合纳入知识库，未写入。";
      }
      if (preferences.generateRelations && preferences.extractKnowledge) {
        this.assertActive();
        progress(WORKFLOW_PROGRESS.points);
        try {
          const graph = await ports.buildRelations();
          if (graph.failedPairs > 0) warnings.push("部分知识关联未能生成，可重新分析补全。");
        } catch (error) {
          ports.log(error);
          warnings.push(wikiPath === undefined ? "知识关联暂未生成，可重新分析重试。" : "知识文档已保留，知识关联暂未生成；重新分析不会重复写入。");
        }
      }
      return { entry, verifications, freshness, wikiPath, updateMessage, warnings };
    } finally { this.busy = false; }
  }
  private assertActive(): void {
    if (this.disposed) throw Object.assign(new Error("Workflow disposed."), { code: "cancelled" });
  }
}
