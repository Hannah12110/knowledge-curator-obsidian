import type { SourceAnalysis } from "../src/types/source-analysis";

export const VALID_ANALYSIS: SourceAnalysis = {
  topic: "Agent Memory",
  sourceQuality: {
    grade: "B",
    authority: 3,
    evidence: 3,
    primarySource: 2,
    recency: 4,
    independence: 3,
    reproducibility: 2,
    reason: "文章包含实践框架，但缺少一手实验数据。"
  },
  overlap: 0.78,
  knowledgeGain: "medium",
  relatedNotes: [{
    path: "wiki/Agent Memory 设计与评测.md",
    title: "Agent Memory 设计与评测",
    relevance: 0.92,
    reason: "主题和记忆分层框架高度相关。"
  }],
  duplicateWith: [],
  newClaims: [{
    statement: "记忆写入策略需要按任务失败模式分别评测。",
    type: "methodological",
    novelty: "refinement",
    confidence: 0.82,
    sourceExcerpt: "不同失败模式应使用不同的记忆写入策略。"
  }],
  conflicts: [],
  recommendation: "extract_only",
  rawRecommendation: "extract_only",
  reason: "核心框架重复较多，但存在可提取的方法增量。"
};
