import type { ClaimGraphRelation, ClaimGraphSnapshot } from "../types/claim-graph";
import type { ClaimRecord } from "../types/claim";
import type { KnowledgePRHistoryRecord } from "../types/knowledge-pr";
export const GLOBAL_RELATION_LABELS: Record<ClaimGraphRelation, string> = { supports: "补充", refines: "细化", contradicts: "冲突", depends_on: "依赖", duplicate: "重复" };
export function groupGlobalGraph(snapshot: ClaimGraphSnapshot) {
  const groups = new Map<string, typeof snapshot.nodes>();
  for (const node of snapshot.nodes) {
    const label = node.topic?.trim() || node.sourcePath.split("/").pop()?.replace(/\.md$/iu, "") || "未命名知识文档";
    groups.set(label, [...(groups.get(label) ?? []), node]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([title, nodes]) => ({ title, nodes, relations: snapshot.edges.filter((edge) => nodes.some((node) => node.claimId === edge.fromClaimId || node.claimId === edge.toClaimId)) }));
}
export function globalNodeDetails(snapshot: ClaimGraphSnapshot, id: string, claims: ClaimRecord[]) {
  const node = snapshot.nodes.find((item) => item.claimId === id); if (node === undefined) return null;
  const claim = claims.find((item) => item.id === id);
  return { node, wikiPath: node.sourcePath, updatedAt: claim?.updatedAt,
    sourceArticles: [...new Set(claim?.provenance.filter((source) => source.sourceKind === "source" || source.sourceKind === "raw").map((source) => source.filePath) ?? [])],
    relations: snapshot.edges.filter((edge) => edge.fromClaimId === id || edge.toClaimId === id).map((edge) => ({
      label: GLOBAL_RELATION_LABELS[edge.relation], direction: edge.fromClaimId === id ? "→" : "←", other: snapshot.nodes.find((item) => item.claimId === (edge.fromClaimId === id ? edge.toClaimId : edge.fromClaimId))
    })) };
}
export class MindMapViewport {
  x = 0; y = 0; scale = 1;
  pan(dx: number, dy: number): void { if (Number.isFinite(dx) && Number.isFinite(dy)) { this.x += dx; this.y += dy; } }
  zoom(factor: number): void { if (Number.isFinite(factor) && factor > 0) this.scale = Math.min(2.5, Math.max(.4, this.scale * factor)); }
  reset(): void { this.x = 0; this.y = 0; this.scale = 1; }
  transform(): string { return `translate(${this.x}px, ${this.y}px) scale(${this.scale})`; }
}
export interface ChangeLogEntry {
  id: string; timestamp: string; articleId: string; articleTitle: string; titleSource: "filename"; wikiFiles: string[];
  addedCount: number; refinedCount: number; reinforcedCount?: number; conflictCount?: number; duplicateSkippedCount?: number;
  decision: "accepted" | "rejected"; changes: KnowledgePRHistoryRecord["changes"]; source: string;
}
export function changeLogEntry(record: KnowledgePRHistoryRecord): ChangeLogEntry {
  const count = (type: "add" | "refine") => new Set(record.changes.filter((change) => change.type === type).flatMap((change) => change.sourceClaims)).size;
  const relations = record.claimRelations;
  return { id: record.prId, timestamp: record.decidedAt, articleId: record.sourcePath, articleTitle: record.sourcePath.split("/").pop()?.replace(/\.md$/iu, "") ?? record.sourcePath,
    titleSource: "filename", wikiFiles: [record.targetPath], addedCount: record.decision === "accepted" ? count("add") : 0, refinedCount: record.decision === "accepted" ? count("refine") : 0,
    reinforcedCount: relations?.filter((item) => item.relation === "reinforce").length, conflictCount: relations?.filter((item) => item.relation === "challenge").length,
    duplicateSkippedCount: relations?.filter((item) => item.relation === "reinforce").length,
    decision: record.decision, changes: record.changes, source: record.sourcePath };
}
