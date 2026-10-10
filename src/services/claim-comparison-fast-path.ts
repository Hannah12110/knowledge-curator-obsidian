import type {
  CandidateClaim,
  ClaimCoverageResult,
  ClaimRecord,
  ClaimRetrievalMatch
} from "../types/claim";
import { normalizeClaim } from "./claim-identity";
import {
  hasNegationConflict,
  hasNumericalConflict,
  hasQualifierConflict
} from "./claim-comparison-guards";
import { buildClaimRetrievalSignals } from "./claim-retrieval-service";

export const COMPARISON_FAST_PATH_THRESHOLDS = {
  lexicalScore: 0.9,
  tokenOverlap: 0.9,
  phraseScore: 0.8,
  retrievalScore: 0.94,
  conflictRetrievalScore: 0.55,
  conflictTokenOverlap: 0.7,
  conflictLexicalScore: 0.8,
  competingMatchScore: 0.35,
  semanticConceptSignals: 2
} as const;

export interface FastPathInput {
  candidate: CandidateClaim;
  matches: ClaimRetrievalMatch[];
}

export interface FastPathResult {
  coverage: ClaimCoverageResult;
  guardsTriggered: string[];
}

export class ClaimComparisonFastPath {
  constructor(private readonly getClaim: (id: string) => ClaimRecord | undefined) {}

  evaluate(input: FastPathInput): FastPathResult | null {
    const available = input.matches.flatMap((match) => {
      const claim = this.getClaim(match.claimId);
      return claim === undefined ? [] : [{ match, claim }];
    });
    const exact = available.find(({ claim }) =>
      claim.normalizedStatement === input.candidate.normalizedStatement &&
      safeMetadataMatch(input.candidate, claim)
    );
    if (exact !== undefined) {
      return this.full(input.candidate, exact.claim, "fast-path-exact", "归一化陈述与语义限定完全一致。");
    }

    const strongest = available[0];
    if (strongest === undefined || hasCompetingRelevantMatch(available.slice(1))) return null;
    const { match, claim } = strongest;

    if (safeMetadataMatch(input.candidate, claim) &&
      (isStableLexicalEquivalent(input.candidate, claim, match) ||
        isStableConceptEquivalent(input.candidate, claim, match))) {
      return this.full(
        input.candidate,
        claim,
        isStableLexicalEquivalent(input.candidate, claim, match)
          ? "fast-path-lexical-equivalent"
          : "fast-path-alias-equivalent",
        "单条 Existing Claim 与 Candidate 的稳定语义信号完全一致。"
      );
    }

    if (input.candidate.type !== claim.type || !sameScope(input.candidate, claim)) return null;
    if (!isStrictComparableSubject(match)) return null;
    if (hasNegationConflict(input.candidate, claim)) {
      return this.conflicting(input.candidate, claim, "fast-path-negation-conflict", "同一主体存在明确肯定/否定冲突。");
    }
    if (hasQualifierConflict(input.candidate, claim)) {
      return this.conflicting(input.candidate, claim, "fast-path-qualifier-conflict", "同一主体存在明确绝对性限定冲突。");
    }
    if (hasNumericalConflict(input.candidate, claim) && sameScope(input.candidate, claim)) {
      return this.conflicting(input.candidate, claim, "fast-path-numerical-conflict", "同一主体与 scope 的关键数值不一致。");
    }
    return null;
  }

  private full(
    candidate: CandidateClaim,
    existing: ClaimRecord,
    guard: string,
    reasoning: string
  ): FastPathResult {
    const aspect = candidate.statement;
    const coverage: ClaimCoverageResult = {
      candidateClaimId: candidate.id,
      coverage: "full",
      coreAspects: [aspect],
      coveredBy: [existing.id],
      coveredAspects: [aspect],
      uncoveredAspects: [],
      conflictingAspects: [],
      pairwise: [{
        claimId: existing.id,
        relation: "equivalent",
        coveredAspects: [aspect],
        conflictingAspects: [],
        reasoning
      }],
      reasoning,
      confidence: Math.min(candidate.confidence, existing.confidence, 0.98)
    };
    validateFastPathDecision(coverage);
    return { coverage, guardsTriggered: [guard] };
  }

  private conflicting(
    candidate: CandidateClaim,
    existing: ClaimRecord,
    guard: string,
    reasoning: string
  ): FastPathResult {
    const aspect = candidate.statement;
    const coverage: ClaimCoverageResult = {
      candidateClaimId: candidate.id,
      coverage: "conflicting",
      coreAspects: [aspect],
      coveredBy: [existing.id],
      coveredAspects: [],
      uncoveredAspects: [],
      conflictingAspects: [aspect],
      pairwise: [{
        claimId: existing.id,
        relation: "conflict",
        coveredAspects: [],
        conflictingAspects: [aspect],
        reasoning
      }],
      reasoning,
      confidence: Math.min(candidate.confidence, existing.confidence, 0.95)
    };
    validateFastPathDecision(coverage);
    return { coverage, guardsTriggered: [guard] };
  }
}

export function validateFastPathDecision(coverage: ClaimCoverageResult): void {
  if (coverage.coverage !== "full" && coverage.coverage !== "conflicting") {
    throw new Error("Fast Path 只允许安全的 full 或 conflicting 结果。");
  }
  if (coverage.coveredBy.length !== 1 || coverage.coreAspects.length !== 1) {
    throw new Error("Fast Path 必须绑定唯一 Existing Claim 和核心 Aspect。");
  }
  if (coverage.coverage === "full" &&
    (coverage.coveredAspects.length === 0 || coverage.uncoveredAspects.length > 0 || coverage.conflictingAspects.length > 0)) {
    throw new Error("Fast Path full Coverage 字段不一致。");
  }
  if (coverage.coverage === "conflicting" && coverage.conflictingAspects.length === 0) {
    throw new Error("Fast Path conflicting Coverage 缺少冲突 Aspect。");
  }
}

function isStableLexicalEquivalent(
  candidate: CandidateClaim,
  existing: ClaimRecord,
  match: ClaimRetrievalMatch
): boolean {
  const features = match.features;
  const left = buildClaimRetrievalSignals(candidate.statement);
  const right = buildClaimRetrievalSignals(existing.statement);
  return features !== undefined &&
    match.score >= COMPARISON_FAST_PATH_THRESHOLDS.retrievalScore &&
    features.lexicalScore >= COMPARISON_FAST_PATH_THRESHOLDS.lexicalScore &&
    features.tokenOverlap >= COMPARISON_FAST_PATH_THRESHOLDS.tokenOverlap &&
    features.phraseScore >= COMPARISON_FAST_PATH_THRESHOLDS.phraseScore &&
    setsEqual(left.tokens, right.tokens) &&
    setsEqual(left.numbers, right.numbers) &&
    setsEqual(left.versions, right.versions) &&
    setsEqual(left.negations, right.negations) &&
    setsEqual(left.qualifiers, right.qualifiers);
}

function isStableConceptEquivalent(
  candidate: CandidateClaim,
  existing: ClaimRecord,
  match: ClaimRetrievalMatch
): boolean {
  if (candidate.type !== "definition" || existing.type !== "definition") {
    return false;
  }
  const left = buildClaimRetrievalSignals(candidate.statement);
  const right = buildClaimRetrievalSignals(existing.statement);
  const leftConcepts = new Set([
    ...[...left.aliases].map((id) => `alias:${id}`),
    ...[...left.acronyms].map((id) => `acronym:${id}`)
  ]);
  const rightConcepts = new Set([
    ...[...right.aliases].map((id) => `alias:${id}`),
    ...[...right.acronyms].map((id) => `acronym:${id}`)
  ]);
  const shared = [...leftConcepts].filter((item) => rightConcepts.has(item));
  return match.score > 0 &&
    shared.length >= COMPARISON_FAST_PATH_THRESHOLDS.semanticConceptSignals &&
    setsEqual(leftConcepts, rightConcepts) &&
    setsEqual(left.numbers, right.numbers) &&
    setsEqual(left.versions, right.versions) &&
    setsEqual(left.negations, right.negations) &&
    setsEqual(left.qualifiers, right.qualifiers);
}

function isStrictComparableSubject(match: ClaimRetrievalMatch): boolean {
  const features = match.features;
  return features !== undefined &&
    match.score >= COMPARISON_FAST_PATH_THRESHOLDS.conflictRetrievalScore &&
    (features.tokenOverlap >= COMPARISON_FAST_PATH_THRESHOLDS.conflictTokenOverlap ||
      features.lexicalScore >= COMPARISON_FAST_PATH_THRESHOLDS.conflictLexicalScore ||
      features.phraseScore >= COMPARISON_FAST_PATH_THRESHOLDS.phraseScore);
}

function hasCompetingRelevantMatch(
  alternatives: Array<{ match: ClaimRetrievalMatch; claim: ClaimRecord }>
): boolean {
  return alternatives.some(({ match }) => match.score >= COMPARISON_FAST_PATH_THRESHOLDS.competingMatchScore);
}

function safeMetadataMatch(candidate: CandidateClaim, existing: ClaimRecord): boolean {
  return candidate.type === existing.type &&
    sameScope(candidate, existing) &&
    normalizedListsEqual(candidate.qualifiers, existing.qualifiers) &&
    !hasQualifierConflict(candidate, existing) &&
    !hasNegationConflict(candidate, existing) &&
    !hasNumericalConflict(candidate, existing);
}

function sameScope(candidate: CandidateClaim, existing: ClaimRecord): boolean {
  return normalizedListsEqual(candidate.scope, existing.scope);
}

function normalizedListsEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = [...new Set((left ?? []).map(normalizeClaim).filter(Boolean))].sort();
  const b = [...new Set((right ?? []).map(normalizeClaim).filter(Boolean))].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}
