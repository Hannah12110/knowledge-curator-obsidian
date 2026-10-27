export type TokenUsageSource = "actual" | "estimated" | "unavailable";
export type PerformanceStage = "sourceAnalysis" | "claimExtraction" | "retrieval" | "claimComparison" | "freshness" | "relation" | "wikiWrite" | "index" | "verification" | "proposal" | "other";
export interface LlmRequestObservation {
  latencyMs: number; provider: string; model: string; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  tokenUsageSource: TokenUsageSource; success: boolean; retry: number;
}
export interface CostConfig { provider: string; model: string; inputPricePerMillion: number; outputPricePerMillion: number; currency: string; }
export interface ArticlePerformanceRecord {
  schemaVersion: 1; runId: string; articleId: string; articleTitle: string; createdAt: string; status: "completed" | "failed"; sampleKind: "real" | "synthetic";
  articleCharCount: number | null; articleTokenEstimate: number | null; tokenEstimator: string;
  claimExtractionCount: number; retrievalCandidateCount: number; deduplicatedPairCount: number; filteredPairCount: number; comparisonPairCount: number; llmComparisonPairCount: number; llmComparisonPairAttempts: number; llmComparedCandidates: number;
  llmInputTokens: number | null; llmOutputTokens: number | null; totalTokens: number | null; tokenUsageSource: TokenUsageSource;
  comparisonInputTokens: number | null; comparisonOutputTokens: number | null; comparisonTokenUsageSource: TokenUsageSource;
  sourceAnalysisLatencyMs: number; claimExtractionLatencyMs: number; retrievalLatencyMs: number; claimComparisonLatencyMs: number; freshnessLatencyMs: number; relationLatencyMs: number; wikiWriteLatencyMs: number;
  indexLatencyMs: number; verificationLatencyMs: number; proposalLatencyMs: number; totalLatencyMs: number; provider: string; model: string;
  estimatedCost: number | null; currency?: string; errorCode?: string; requests: Array<LlmRequestObservation & { stage: PerformanceStage }>;
}
export function estimateTokens(text: string): number {
  const nonAscii = [...text].filter((char) => char.charCodeAt(0) > 127).length;
  return Math.ceil(nonAscii / 1.5 + (text.length - nonAscii) / 4);
}
export function observeTokens(usage: unknown, input: string, output: string | null) {
  const data = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } | null;
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (valid(data?.prompt_tokens) && valid(data?.completion_tokens)) return { inputTokens: data.prompt_tokens, outputTokens: data.completion_tokens,
    totalTokens: valid(data.total_tokens) ? data.total_tokens : data.prompt_tokens + data.completion_tokens, tokenUsageSource: "actual" as const };
  return { inputTokens: estimateTokens(input), outputTokens: output === null ? null : estimateTokens(output),
    totalTokens: output === null ? null : estimateTokens(input) + estimateTokens(output), tokenUsageSource: output === null ? "unavailable" as const : "estimated" as const };
}
function tokenTotals(requests: LlmRequestObservation[]) {
  const sum = (key: "inputTokens" | "outputTokens" | "totalTokens") => requests.some((item) => item[key] === null) ? null : requests.reduce((total, item) => total + (item[key] ?? 0), 0);
  const tokenUsageSource: TokenUsageSource = requests.some((item) => item.tokenUsageSource === "unavailable") ? "unavailable" : requests.some((item) => item.tokenUsageSource === "estimated") ? "estimated" : "actual";
  return { input: sum("inputTokens"), output: sum("outputTokens"), total: sum("totalTokens"), source: tokenUsageSource };
}
export class ArticlePerformanceRecorder {
  private active: ArticlePerformanceRecord | null = null;
  private started = 0;
  private stage: PerformanceStage = "other";
  constructor(private readonly now = () => performance.now()) {}
  begin(articleId: string, articleTitle: string, provider: string, model: string, sampleKind: "real" | "synthetic" = "real"): void {
    if (this.active !== null) throw new Error("Performance scope already active.");
    this.started = this.now(); this.stage = "other";
    this.active = { schemaVersion: 1, runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, articleId, articleTitle, createdAt: new Date().toISOString(), status: "completed", sampleKind,
      articleCharCount: null, articleTokenEstimate: null, tokenEstimator: "non-ascii chars / 1.5 + ascii chars / 4; heuristic, not provider tokenizer",
      claimExtractionCount: 0, retrievalCandidateCount: 0, deduplicatedPairCount: 0, filteredPairCount: 0, comparisonPairCount: 0, llmComparisonPairCount: 0, llmComparisonPairAttempts: 0, llmComparedCandidates: 0,
      llmInputTokens: 0, llmOutputTokens: 0, totalTokens: 0, tokenUsageSource: "actual", comparisonInputTokens: 0, comparisonOutputTokens: 0, comparisonTokenUsageSource: "actual",
      sourceAnalysisLatencyMs: 0, claimExtractionLatencyMs: 0, retrievalLatencyMs: 0, claimComparisonLatencyMs: 0, freshnessLatencyMs: 0, relationLatencyMs: 0, wikiWriteLatencyMs: 0,
      indexLatencyMs: 0, verificationLatencyMs: 0, proposalLatencyMs: 0, totalLatencyMs: 0, provider, model, estimatedCost: null, requests: [] };
  }
  source(content: string): void { if (this.active !== null) { this.active.articleCharCount = content.length; this.active.articleTokenEstimate = estimateTokens(content); } }
  counts(values: Partial<Pick<ArticlePerformanceRecord, "claimExtractionCount" | "retrievalCandidateCount" | "deduplicatedPairCount" | "filteredPairCount" | "comparisonPairCount" | "llmComparisonPairCount" | "llmComparisonPairAttempts" | "llmComparedCandidates">>): void { if (this.active !== null) Object.assign(this.active, values); }
  observe = (observation: LlmRequestObservation): void => { if (this.active !== null) this.active.requests.push({ ...observation, stage: this.stage }); };
  async measure<T>(stage: PerformanceStage, work: () => T | Promise<T>): Promise<T> {
    const start = this.now(), previous = this.stage; this.stage = stage;
    try { return await work(); }
    finally {
      if (this.active !== null && stage !== "other") this.active[`${stage}LatencyMs`] += Math.max(0, this.now() - start);
      this.stage = previous;
    }
  }
  finish(status: "completed" | "failed", errorCode?: string, cost?: CostConfig | null): ArticlePerformanceRecord {
    if (this.active === null) throw new Error("No performance scope.");
    const record = this.active;
    record.status = status; record.errorCode = errorCode; record.totalLatencyMs = Math.max(0, this.now() - this.started);
    const all = tokenTotals(record.requests), comparison = tokenTotals(record.requests.filter((item) => item.stage === "claimComparison"));
    record.llmInputTokens = all.input; record.llmOutputTokens = all.output; record.totalTokens = all.total; record.tokenUsageSource = all.source;
    record.comparisonInputTokens = comparison.input; record.comparisonOutputTokens = comparison.output; record.comparisonTokenUsageSource = comparison.source;
    if (cost !== undefined && cost !== null && cost.provider === record.provider && cost.model === record.model && record.requests.every((request) => request.provider === record.provider && request.model === record.model) &&
      Number.isFinite(cost.inputPricePerMillion) && cost.inputPricePerMillion >= 0 && Number.isFinite(cost.outputPricePerMillion) && cost.outputPricePerMillion >= 0 &&
      all.input !== null && all.output !== null && typeof cost.currency === "string" && cost.currency.trim().length > 0) {
      record.estimatedCost = (all.input * cost.inputPricePerMillion + all.output * cost.outputPricePerMillion) / 1_000_000; record.currency = cost.currency;
    }
    this.active = null; return structuredClone(record);
  }
}
export function performanceReport(records: ArticlePerformanceRecord[], sampleKind: "real" | "synthetic" = "real") {
  const rows = records.filter((record) => record.sampleKind === sampleKind);
  const sum = (key: keyof ArticlePerformanceRecord) => rows.reduce((total, row) => total + (typeof row[key] === "number" ? row[key] as number : 0), 0);
  const average = (key: keyof ArticlePerformanceRecord) => { const values = rows.map((row) => row[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)); return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length; };
  const percentile = (key: "claimComparisonLatencyMs" | "totalLatencyMs", quantile: number) => rows.length === 0 ? null : rows.map((row) => row[key]).sort((a, b) => a - b)[Math.ceil(quantile * rows.length) - 1]!;
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), sampleKind, articles: rows.length, uniqueArticles: new Set(rows.map((row) => row.articleId)).size,
    totalClaims: sum("claimExtractionCount"), averageClaimsPerArticle: average("claimExtractionCount"), totalCandidatePairs: sum("retrievalCandidateCount"), totalComparisonPairs: sum("llmComparisonPairCount"),
    averageComparisonPairsPerArticle: average("llmComparisonPairCount"), averageInputTokensPerArticle: average("llmInputTokens"), averageOutputTokensPerArticle: average("llmOutputTokens"),
    p50ComparisonLatencyMs: percentile("claimComparisonLatencyMs", .5), p95ComparisonLatencyMs: percentile("claimComparisonLatencyMs", .95), p50TotalLatencyMs: percentile("totalLatencyMs", .5), p95TotalLatencyMs: percentile("totalLatencyMs", .95),
    totalTokens: rows.some((row) => row.totalTokens === null) ? null : sum("totalTokens"), knownTokens: sum("totalTokens"), incompleteUsageArticles: rows.filter((row) => row.tokenUsageSource === "unavailable").length,
    estimatedUsageArticles: rows.filter((row) => row.tokenUsageSource === "estimated").length, currentBottleneck: "INSUFFICIENT_DATA", smallSample: rows.length < 20,
    totalEstimatedCost: rows.length > 0 && rows.every((row) => row.estimatedCost !== null) && new Set(rows.map((row) => row.currency)).size === 1 ? sum("estimatedCost") : null,
    currency: rows[0]?.currency,
    percentileMethod: "nearest-rank; article wall-clock samples, not a production guarantee", rawValues: rows };
}
export function renderPerformanceReport(report: ReturnType<typeof performanceReport>): string {
  const value = (input: number | null) => input === null ? "unavailable" : input.toFixed(2).replace(/\.00$/u, "");
  const escape = (input: string) => input.replace(/\|/gu, "\\|").replace(/[\r\n]/gu, " ");
  return ["# Claim Comparison Performance", "", `Sample kind: ${report.sampleKind}; Articles (runs): ${report.articles}; Unique articles: ${report.uniqueArticles}`,
    report.articles === 0 ? "没有真实运行样本。未执行外部 AI 请求，不能判断性能瓶颈。" : report.smallSample ? "样本量较小，仅列观测值，不据此判断生产性能或技术路线。" : "仅描述当前样本，不证明其他负载下的性能。",
    `Total Claims: ${report.totalClaims}; Average Claims / Article: ${value(report.averageClaimsPerArticle)}`,
    `Total Candidate Pairs: ${report.totalCandidatePairs}; Total Comparison Pairs (LLM unique): ${report.totalComparisonPairs}; Average: ${value(report.averageComparisonPairsPerArticle)}`,
    `Average Input Tokens / Article: ${value(report.averageInputTokensPerArticle)}; Average Output Tokens / Article: ${value(report.averageOutputTokensPerArticle)}`,
    `P50/P95 Comparison Latency (ms): ${value(report.p50ComparisonLatencyMs)} / ${value(report.p95ComparisonLatencyMs)}`,
    `P50/P95 Total Latency (ms): ${value(report.p50TotalLatencyMs)} / ${value(report.p95TotalLatencyMs)}`,
    `Total Tokens: ${value(report.totalTokens)}; incomplete usage articles: ${report.incompleteUsageArticles}; estimated usage articles: ${report.estimatedUsageArticles}`,
    ...(report.totalEstimatedCost === null ? [] : [`Estimated cost (${report.currency}): ${report.totalEstimatedCost}`]),
    "Token 来源逐行标注；estimated 为启发式估计。无明确价格配置时不输出成本。输入/输出平均值仅计有值的样本。",
    "CURRENT_BOTTLENECK = INSUFFICIENT_DATA", "", "| Article | Claims | Candidate Pairs | Compared Pairs | Input Tokens | Output Tokens | Comparison Latency | Total Latency | Token Source |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...report.rawValues.map((row) => `| ${escape(row.articleTitle)} | ${row.claimExtractionCount} | ${row.retrievalCandidateCount} | ${row.llmComparisonPairCount} | ${value(row.llmInputTokens)} | ${value(row.llmOutputTokens)} | ${value(row.claimComparisonLatencyMs)} | ${value(row.totalLatencyMs)} | ${row.tokenUsageSource} |`), ""
  ].join("\n");
}
