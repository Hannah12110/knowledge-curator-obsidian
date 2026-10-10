import type { CandidateClaim, ClaimRecord } from "../types/claim";

export function hasQualifierConflict(candidate: CandidateClaim, existing: ClaimRecord): boolean {
  const candidateText = `${candidate.statement} ${(candidate.qualifiers ?? []).join(" ")}`.toLowerCase();
  const existingText = `${existing.statement} ${(existing.qualifiers ?? []).join(" ")}`.toLowerCase();
  const absolute = /(?:\b(?:always|only|must|never|all)\b|必然|总是|唯一|必须|绝不|全部)/u;
  const qualified = /(?:\b(?:may|might|can|usually|often|sometimes|typically)\b|可能|通常|有时|在.+条件)/u;
  return (absolute.test(candidateText) && qualified.test(existingText)) ||
    (absolute.test(existingText) && qualified.test(candidateText));
}

export function hasNegationConflict(candidate: CandidateClaim, existing: ClaimRecord): boolean {
  const negative = /(?:\b(?:not|never|no longer|cannot|can't|without)\b|不再|不是|不能|无法|没有|无须)/iu;
  return negative.test(candidate.statement) !== negative.test(existing.statement);
}

export function hasNumericalConflict(candidate: CandidateClaim, existing: ClaimRecord): boolean {
  const left = extractNumbers(candidate.statement);
  const right = extractNumbers(existing.statement);
  return left.length > 0 && right.length > 0 && left.join("|") !== right.join("|");
}

export function extractNumbers(value: string): string[] {
  return value.match(/\b\d+(?:\.\d+)?%?\b/gu) ?? [];
}
