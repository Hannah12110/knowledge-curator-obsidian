import { parseClaimGraphClassifications } from "../src/services/claim-graph-validator";
import { KnowledgeCompressionService } from "../src/services/knowledge-compression-service";
import type { ClaimGraphEdge, ClaimGraphNode } from "../src/types/claim-graph";

interface GraphFixture {
  caseId: string;
  left: string;
  right: string;
  expected: string;
  actual: "duplicate" | "supports" | "refines" | "contradicts" | "depends_on" | "none";
  direction: "left_to_right" | "right_to_left" | "symmetric";
  orphan?: boolean;
}

export async function evaluateGraphCase(fixture: GraphFixture) {
  const leftId = `${fixture.caseId}-left`;
  const rightId = `${fixture.caseId}-right`;
  const pairId = `${fixture.caseId}-pair`;
  const evidenceClaimIds = fixture.actual === "none" ? [] : [leftId, rightId];
  const result = parseClaimGraphClassifications(JSON.stringify({ relations: [{
    pairId,
    relation: fixture.actual,
    direction: fixture.direction,
    confidence: fixture.actual === "none" ? 0.82 : 0.93,
    reasoning: fixture.actual === "none" ? "no atomic knowledge relation" : "fixture provider output",
    evidenceClaimIds
  }] }), new Map([[pairId, { leftClaimId: leftId, rightClaimId: rightId }]]))[0];
  if (result === undefined) throw new Error("Missing Graph classification.");
  const nodes = [node(leftId, fixture.left), node(rightId, fixture.right)];
  const edges: ClaimGraphEdge[] = result.relation === "none" ? [] : [{
    id: `${fixture.caseId}-edge`, fromClaimId: leftId, toClaimId: rightId,
    relation: result.relation, confidence: result.confidence,
    evidence: [{ claimId: leftId, statement: fixture.left, sourcePath: `Regression/${leftId}.md`, reason: result.reasoning }],
    retrievalScore: 0.9, retrievalReasons: ["regression candidate"],
    createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z"
  }];
  const compression = await new KnowledgeCompressionService().preview(nodes, edges);
  return {
    relation: result.relation,
    orphan: edges.length === 0,
    unsafeMerge: compression.some((proposal) =>
      result.relation !== "duplicate" && proposal.claimIds.length > 1
    )
  };
}

function node(claimId: string, statement: string): ClaimGraphNode {
  return {
    claimId, statement, sourcePath: `Regression/${claimId}.md`,
    createdAt: "2026-09-28T00:00:00.000Z", claimFingerprint: "a".repeat(64), status: "active"
  };
}
