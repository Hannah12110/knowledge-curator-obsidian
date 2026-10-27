import { performanceReport, renderPerformanceReport, type ArticlePerformanceRecord, type CostConfig } from "./performance-metrics";
export const PERFORMANCE_ROOT = "KnowledgeCuratorValidation/performance";
export const PERFORMANCE_REPORT_ROOT = "KnowledgeCuratorValidation/reports";
export interface PerformanceAdapter { exists(path: string): Promise<boolean>; mkdir(path: string): Promise<unknown>; write(path: string, content: string): Promise<unknown>; read(path: string): Promise<string>; list(path: string): Promise<{ files: string[]; folders: string[] }>; }
const RECORD_KEYS = "schemaVersion runId articleId articleTitle createdAt status sampleKind articleCharCount articleTokenEstimate tokenEstimator claimExtractionCount retrievalCandidateCount deduplicatedPairCount filteredPairCount comparisonPairCount llmComparisonPairCount llmComparisonPairAttempts llmComparedCandidates llmInputTokens llmOutputTokens totalTokens tokenUsageSource comparisonInputTokens comparisonOutputTokens comparisonTokenUsageSource sourceAnalysisLatencyMs claimExtractionLatencyMs retrievalLatencyMs claimComparisonLatencyMs freshnessLatencyMs relationLatencyMs wikiWriteLatencyMs indexLatencyMs verificationLatencyMs proposalLatencyMs totalLatencyMs provider model estimatedCost currency errorCode".split(" ");
function project(record: ArticlePerformanceRecord): ArticlePerformanceRecord {
  return { ...Object.fromEntries(RECORD_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(record, key)).map((key) => [key, (record as unknown as Record<string, unknown>)[key]])),
    requests: record.requests.map(({ latencyMs, provider, model, inputTokens, outputTokens, totalTokens, tokenUsageSource, success, retry, stage }) => ({ latencyMs, provider, model, inputTokens, outputTokens, totalTokens, tokenUsageSource, success, retry, stage })) } as unknown as ArticlePerformanceRecord;
}
export class PerformanceRepository {
  private queue = Promise.resolve();
  constructor(private readonly adapter: PerformanceAdapter, private readonly getWikiRoot?: () => string) {}
  async costConfig(): Promise<CostConfig | null> {
    try { const path = `${PERFORMANCE_ROOT}/cost-config.json`; return await this.adapter.exists(path) ? JSON.parse(await this.adapter.read(path)) as CostConfig : null; }
    catch { return null; }
  }
  async records(): Promise<ArticlePerformanceRecord[]> {
    if (!await this.adapter.exists(PERFORMANCE_ROOT)) return [];
    const entries = await this.adapter.list(PERFORMANCE_ROOT), records: ArticlePerformanceRecord[] = [];
    for (const file of entries.files.filter((path) => path.endsWith(".json") && !path.endsWith("/cost-config.json"))) {
      try {
        const record = JSON.parse(await this.adapter.read(file)) as ArticlePerformanceRecord;
        if (record.schemaVersion === 1 && typeof record.runId === "string" && Array.isArray(record.requests) && Number.isFinite(record.totalLatencyMs) && ["real", "synthetic"].includes(record.sampleKind)) records.push(project(record));
      } catch { console.warn("Knowledge Curator ignored an invalid local performance record."); }
    }
    return records;
  }
  save(record: ArticlePerformanceRecord): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(async () => {
      await this.ensure(PERFORMANCE_ROOT);
      // Construct an allowlisted projection: never serialize arbitrary provider payloads.
      const clean = project(record);
      await this.adapter.write(`${PERFORMANCE_ROOT}/${record.runId.replace(/[^A-Za-z0-9_-]/gu, "-")}.json`, JSON.stringify(clean, null, 2));
      await this.report();
    });
    return this.queue;
  }
  async report(): Promise<void> {
    const report = performanceReport(await this.records()); await this.ensure(PERFORMANCE_REPORT_ROOT);
    await this.adapter.write(`${PERFORMANCE_REPORT_ROOT}/claim-comparison-performance.json`, JSON.stringify(report, null, 2));
    await this.adapter.write(`${PERFORMANCE_REPORT_ROOT}/claim-comparison-performance.md`, renderPerformanceReport(report));
  }
  private async ensure(path: string): Promise<void> {
    const wiki = this.getWikiRoot?.().trim().replace(/^\/+|\/+$/gu, "");
    if (wiki && [PERFORMANCE_ROOT, PERFORMANCE_REPORT_ROOT].some((root) => root === wiki || root.startsWith(`${wiki}/`) || wiki.startsWith(`${root}/`))) throw new Error("Developer metrics cannot overlap Wiki.");
    let current = "";
    for (const part of path.split("/")) { current = current ? `${current}/${part}` : part; if (!await this.adapter.exists(current)) await this.adapter.mkdir(current); }
  }
}
