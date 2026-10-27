import { normalizeClaim } from "../services/claim-identity";
import type { SourceAnalysis } from "../types/source-analysis";
import type { ClaimGraphRelation, ClaimGraphSnapshot } from "../types/claim-graph";
import type { ClaimRecord } from "../types/claim";
import type { AnalysisPreferences } from "../types/settings";
import type { CachedConflictVerification } from "../types/verification";

export const ARTICLE_STATUS_LABELS = {
  pending: "待分析", analyzing: "分析中", analyzed: "已分析", failed: "分析失败"
} as const;
export const RELATION_LABELS: Record<ClaimGraphRelation, string> = {
  supports: "支持 / 补充", refines: "细化", contradicts: "冲突", depends_on: "依赖", duplicate: "重复"
};
export const EMPTY_STATES = {
  articles: "待处理目录里还没有文章", points: "暂未提取到可维护的知识点", relations: "暂未发现知识关联"
} as const;

export interface KnowledgePointDisplay {
  key: string;
  text: string;
  sourcePath: string;
  wikiPaths: string[];
  updatedAt?: string;
}
export interface FreshnessDisplay {
  text: string;
  detail: string;
}
export interface ProductArticleResult {
  sourcePath: string;
  title: string;
  analysis: SourceAnalysis;
  preferences: AnalysisPreferences;
  points: KnowledgePointDisplay[];
  verifications: CachedConflictVerification[];
  freshness: FreshnessDisplay;
  graph: ClaimGraphSnapshot;
  wikiPath?: string;
  updateMessage: string;
  warnings: string[];
}

export function selectAnalysisTarget(
  active: { path: string; extension: string } | null,
  selected: string | null,
  isArticle: (path: string) => boolean
): string | null {
  if (active?.extension.toLowerCase() === "md" && isArticle(active.path)) return active.path;
  return selected !== null && isArticle(selected) ? selected : null;
}

export function mapKnowledgePoints(
  analysis: SourceAnalysis, sourcePath: string, claims: ClaimRecord[], wikiPath?: string
): KnowledgePointDisplay[] {
  const candidates = analysis.claimAnalysis?.candidateClaims ?? analysis.newClaims;
  const comparisons = analysis.claimAnalysis?.comparisons ?? [];
  return candidates.map((candidate, index) => {
    const comparison = "id" in candidate ? comparisons.find((item) => item.candidateClaimId === candidate.id) : undefined;
    const existing = claims.find((item) => item.id === comparison?.existingClaimId);
    // Link a new Wiki only when its final indexed text actually contains this point.
    const indexed = claims.filter((item) => item.normalizedStatement === normalizeClaim(candidate.statement) || item.statement === candidate.statement);
    const wikiPaths = [...new Set([
      ...(existing?.provenance.filter((item) => item.sourceKind === "wiki").map((item) => item.filePath) ?? []),
      ...indexed.flatMap((item) => item.provenance.filter((ref) => ref.sourceKind === "wiki" && (wikiPath === undefined || ref.filePath === wikiPath)).map((ref) => ref.filePath))
    ])];
    return { key: "id" in candidate ? candidate.id : `point-${index}`, text: candidate.statement, sourcePath, wikiPaths, updatedAt: indexed[0]?.updatedAt ?? existing?.updatedAt };
  });
}

export function articleRelations(result: ProductArticleResult) {
  if (!["ready", "partial"].includes(result.graph.stats.status)) return [];
  const nodes = new Map(result.graph.nodes.map((node) => [node.claimId, node]));
  const statements = new Set(result.points.map((point) => point.text));
  const related = new Set(result.graph.nodes.filter((node) =>
    statements.has(node.statement) || (result.wikiPath !== undefined && node.sourcePath === result.wikiPath)
  ).map((node) => node.claimId));
  return result.graph.edges.flatMap((edge) => {
    const from = nodes.get(edge.fromClaimId), to = nodes.get(edge.toClaimId);
    return from !== undefined && to !== undefined && (related.has(from.claimId) || related.has(to.claimId))
      ? [{ key: edge.id, from, to, label: RELATION_LABELS[edge.relation] }] : [];
  });
}

export function userWorkflowError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const messages: Record<string, string> = {
    missing_api_key: "请先在设置中填写 AI API Key。", missing_configuration: "请先在设置中填写 AI 服务地址、API Key 和模型。",
    unauthorized: "AI 服务认证失败，请检查 API Key。", forbidden: "AI 服务拒绝访问，请检查服务权限。",
    timeout: "AI 服务响应超时，请稍后重试。", rate_limit: "AI 服务请求频繁，请稍后重试。",
    write_scope_violation: "请检查知识范围：Wiki 必须是库内独立文件夹，不能与资料目录重叠。",
    configuration_changed: "分析期间设置发生变化，请使用当前设置重新分析。",
    stale_source: "文章在分析期间发生变化，请重新分析。", stale_source_analysis: "文章已变化，请重新分析。",
    stale_target: "知识文档在分析期间发生变化，请重新分析。",
    index_incomplete: "部分知识文档未能建立索引，请在设置中更新知识索引后重试。",
    decision_persistence_failed_rolled_back: "更新记录保存失败，本次写入已自动回滚，请重试。",
    rollback_failed: "更新记录保存失败且恢复未完成，请检查 Wiki 后再继续。",
    write_verification_failed: "写入后校验未通过，请检查 Wiki 后再继续。",
    cancelled: "分析已停止，请重新打开插件后重试。"
  };
  return messages[code ?? ""] ?? "本次分析未能完成，请检查 AI 服务配置和网络后重新分析。";
}
