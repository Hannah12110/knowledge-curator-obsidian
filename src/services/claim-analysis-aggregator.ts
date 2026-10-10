import type {
  CandidateClaim,
  ClaimAnalysis,
  ClaimComparison,
  ClaimRecord
} from "../types/claim";
import type {
  Claim,
  Conflict,
  SourceAnalysis
} from "../types/source-analysis";

export function aggregateClaimAnalysis(input: {
  legacy: SourceAnalysis;
  candidateClaims: CandidateClaim[];
  comparisons: ClaimComparison[];
  getExistingClaim: (id: string) => ClaimRecord | undefined;
}): SourceAnalysis {
  const counts = countRelations(input.comparisons);
  const total = input.candidateClaims.length;
  const coverage = total === 0 ? 0 : counts.reinforce / total;
  const newClaims: Claim[] = input.comparisons
    .filter((comparison) => comparison.relation === "add" || comparison.relation === "refine")
    .map((comparison) => {
      const candidate = input.candidateClaims.find((claim) => claim.id === comparison.candidateClaimId)!;
      return {
        statement: candidate.statement,
        type: toLegacyClaimType(candidate.type),
        novelty: comparison.relation === "add" ? "new" : "refinement",
        confidence: Math.min(candidate.confidence, comparison.confidence),
        sourceExcerpt: candidate.sourceExcerpt
      };
    });
  const conflicts: Conflict[] = input.comparisons
    .filter((comparison) => comparison.relation === "challenge" && comparison.existingClaimId !== undefined)
    .map((comparison) => {
      const existing = input.getExistingClaim(comparison.existingClaimId!);
      return {
        newClaim: comparison.candidateStatement,
        existingClaim: existing?.statement ?? comparison.existingStatement ?? "Existing claim",
        existingFile: existing?.provenance[0]?.filePath ?? "unknown",
        type: inferConflictType(comparison.candidateStatement, existing?.statement ?? ""),
        confidence: comparison.confidence,
        explanation: comparison.reasoning,
        status: "unverified"
      };
    });
  const claimAnalysis: ClaimAnalysis = {
    candidateClaims: input.candidateClaims,
    comparisons: input.comparisons,
    coverage
  };
  const knowledgeGain = counts.add >= 2
    ? "high" as const
    : counts.add === 1
      ? "medium" as const
      : counts.refine > 0
        ? "low" as const
        : "none" as const;
  const recommendation = counts.challenge > 0
    ? "review" as const
    : counts.add >= 2
      ? "merge" as const
      : counts.add === 1 || counts.refine > 0
        ? "extract_only" as const
        : "reject" as const;
  return {
    ...input.legacy,
    analysisMode: "claim",
    claimAnalysis,
    overlap: coverage,
    knowledgeGain,
    newClaims,
    conflicts,
    recommendation,
    reason: `Claim-level comparison: ADD ${counts.add}, REFINE ${counts.refine}, REINFORCE ${counts.reinforce}, CHALLENGE ${counts.challenge}. Knowledge Gain、New Claims、Conflict 与 Recommendation 均以这些 Claim 关系聚合，文档级分析仅保留来源质量与相关笔记上下文。`
  };
}

export function countRelations(comparisons: ClaimComparison[]): Record<"add" | "reinforce" | "refine" | "challenge" | "supersede", number> {
  const output = { add: 0, reinforce: 0, refine: 0, challenge: 0, supersede: 0 };
  for (const comparison of comparisons) output[comparison.relation] += 1;
  return output;
}

function toLegacyClaimType(type: CandidateClaim["type"]): Claim["type"] {
  if (type === "fact") return "factual";
  if (type === "method") return "methodological";
  return type;
}

function inferConflictType(candidate: string, existing: string): Conflict["type"] {
  const combined = `${candidate} ${existing}`.toLowerCase();
  if (/\d+(?:\.\d+)?%?/u.test(combined)) return "data";
  if (/always|only|may|usually|scope|condition|唯一|总是|可能|通常|条件/u.test(combined)) return "scope";
  if (/version|year|current|previous|目前|曾经|版本|年份/u.test(combined)) return "temporal";
  if (/defined|means|definition|定义|指的是/u.test(combined)) return "definition";
  if (/method|process|approach|方法|流程/u.test(combined)) return "method";
  return "direct";
}
