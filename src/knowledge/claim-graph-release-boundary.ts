export const CLAIM_GRAPH_RELEASE_BOUNDARY = {
  capability: "AI_ASSISTED_RELATION_SUGGESTION",
  relationStatus: "SUGGESTED",
  humanReviewPolicy: "HUMAN_IN_THE_LOOP",
  autonomousCompression: "BLOCKED_BY_QUALITY_GATE",
  productionSafety: "PASS",
  relationModelQuality: "LIMITED"
} as const;

export const CLAIM_GRAPH_RELEASE_NOTICE =
  "所有 Claim 关系均为模型建议，不是已验证事实；关系建议不能直接触发知识库合并、删除或改写。";

export const COMPRESSION_RELEASE_NOTICE =
  "自主知识压缩已被质量门禁关闭（BLOCKED_BY_QUALITY_GATE）。不会自动合并、删除或改写 Markdown。";
