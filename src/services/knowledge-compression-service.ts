import type {
  ClaimGraphEdge,
  ClaimGraphNode,
  KnowledgeCompressionProposal
} from "../types/claim-graph";
import { sha256Text } from "./content-hash";

/** Read-only preview. Only validated duplicate components can become merge suggestions. */
export class KnowledgeCompressionService {
  async preview(nodes: ClaimGraphNode[], edges: ClaimGraphEdge[]): Promise<KnowledgeCompressionProposal[]> {
    const duplicateEdges = edges.filter((edge) => edge.relation === "duplicate" && edge.confidence >= 0.8);
    const parent = new Map(nodes.map((node) => [node.claimId, node.claimId]));
    for (const edge of duplicateEdges) union(parent, edge.fromClaimId, edge.toClaimId);
    const groups = new Map<string, string[]>();
    for (const node of nodes) {
      const root = find(parent, node.claimId);
      const group = groups.get(root);
      if (group === undefined) groups.set(root, [node.claimId]);
      else group.push(node.claimId);
    }
    const byId = new Map(nodes.map((node) => [node.claimId, node]));
    const proposals: KnowledgeCompressionProposal[] = [];
    for (const claimIds of groups.values()) {
      if (claimIds.length < 2) continue;
      const sorted = [...claimIds].sort((left, right) => {
        const leftNode = byId.get(left);
        const rightNode = byId.get(right);
        if (leftNode === undefined || rightNode === undefined) return left.localeCompare(right);
        return leftNode.createdAt.localeCompare(rightNode.createdAt) || left.localeCompare(right);
      });
      const evidenceEdgeIds = duplicateEdges
        .filter((edge) => claimIds.includes(edge.fromClaimId) && claimIds.includes(edge.toClaimId))
        .map((edge) => edge.id)
        .sort();
      // A connected component must have enough direct duplicate evidence. No
      // supports/refines/contradicts edge can authorize a merge preview.
      if (evidenceEdgeIds.length < claimIds.length - 1) continue;
      proposals.push({
        id: `compression_${(await sha256Text(sorted.join("|"))).slice(0, 24)}`,
        type: "keep_canonical",
        claimIds: sorted,
        canonicalClaimId: sorted[0] as string,
        evidenceEdgeIds,
        reasoning: "这些 Claim 由高置信度 duplicate 关系连接，可人工审阅后保留一个 canonical Claim。",
        confidence: Math.min(...duplicateEdges
          .filter((edge) => evidenceEdgeIds.includes(edge.id))
          .map((edge) => edge.confidence)),
        status: "preview"
      });
    }
    return proposals;
  }
}

function find(parent: Map<string, string>, value: string): string {
  const next = parent.get(value) ?? value;
  if (next === value) return value;
  const root = find(parent, next);
  parent.set(value, root);
  return root;
}

function union(parent: Map<string, string>, left: string, right: string): void {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
}
