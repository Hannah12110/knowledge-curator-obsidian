import type {
  ClaimEvolutionEvent,
  ClaimEvolutionEventType,
  ClaimGraphEdge,
  ClaimGraphNode
} from "../types/claim-graph";
import { sha256Text } from "./content-hash";

export class ClaimEvolutionService {
  async derive(nodes: ClaimGraphNode[], edges: ClaimGraphEdge[]): Promise<ClaimEvolutionEvent[]> {
    const events: ClaimEvolutionEvent[] = [];
    for (const node of nodes) {
      events.push(await event(node.claimId, "created", node.createdAt, "Claim 由 Wiki 派生进入 Claim Store。"));
      if (node.status === "superseded") {
        events.push(await event(node.claimId, "superseded", node.createdAt, "Claim Store 已将该知识标记为 superseded。"));
      }
    }
    for (const edge of edges) {
      if (edge.relation === "refines") {
        events.push(await event(edge.toClaimId, "refined", edge.updatedAt, "存在补充或收窄该知识的 Claim。", edge));
      } else if (edge.relation === "contradicts") {
        events.push(await event(edge.fromClaimId, "challenged", edge.updatedAt, "存在尚未解决的冲突 Claim。", edge));
        events.push(await event(edge.toClaimId, "challenged", edge.updatedAt, "存在尚未解决的冲突 Claim。", edge));
      }
    }
    return events.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
  }
}

async function event(
  claimId: string,
  type: ClaimEvolutionEventType,
  at: string,
  reason: string,
  edge?: ClaimGraphEdge
): Promise<ClaimEvolutionEvent> {
  const relatedClaimId = edge === undefined
    ? undefined
    : edge.fromClaimId === claimId ? edge.toClaimId : edge.fromClaimId;
  return {
    id: `evolution_${(await sha256Text(`${claimId}|${type}|${edge?.id ?? "created"}`)).slice(0, 24)}`,
    claimId,
    type,
    at,
    relatedClaimId,
    relationEdgeId: edge?.id,
    reason
  };
}
