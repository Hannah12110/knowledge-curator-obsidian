import type { ClaimRecord, ClaimType } from "../src/types/claim";
import { FreshnessRiskService } from "../src/services/freshness-risk-service";

const statements: Array<[string, ClaimType]> = [
  ["RAG 是 Retrieval-Augmented Generation。", "definition"],
  ["GPT-5 当前上下文窗口为 128K tokens。", "fact"],
  ["当前 API endpoint 支持 response_format 参数。", "fact"],
  ["当前价格为 $2 / 1M tokens。", "quantitative"],
  ["错误分析应先建立可复现的分类标准。", "method"]
];

export async function benchmarkFreshness(count = 184) {
  const service = new FreshnessRiskService();
  const claims = Array.from({ length: count }, (_, index) => claim(index, ...statements[index % statements.length]!));
  const started = performance.now();
  const results = [];
  for (const item of claims) results.push(await service.assess({ claim: item, sourceModified: Date.UTC(2024, 0, 1), now: new Date("2026-09-27T00:00:00.000Z") }));
  const durationMs = performance.now() - started;
  const counts = Object.fromEntries(["critical", "high", "medium", "low"].map((risk) => [risk, results.filter((item) => item.freshnessRisk === risk).length]));
  return { claims: count, durationMs, perClaimMs: durationMs / count, networkCalls: 0, ...counts };
}

function claim(index: number, statement: string, type: ClaimType): ClaimRecord {
  return { id: `benchmark-${index}`, statement, normalizedStatement: statement.toLowerCase(), type, status: "active", confidence: 0.9, provenance: [{ filePath: `wiki/${index}.md`, fileHash: String(index).padStart(64, "0"), sourceKind: "wiki", accepted: true }], createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" };
}
