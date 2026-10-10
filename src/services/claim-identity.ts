import type { CandidateClaim, ClaimRecord } from "../types/claim";
import { sha256Text } from "./content-hash";
import { normalizeSourcePath } from "./analysis-cache-service";

export function normalizeClaim(statement: string): string {
  return statement
    .normalize("NFKC")
    .trim()
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/(^|\s)#{1,6}\s+/gu, "$1")
    .replace(/[*_~`]+/gu, "")
    .replace(/[“”„‟]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/[，、]/gu, ",")
    .replace(/[。]/gu, ".")
    .replace(/[：]/gu, ":")
    .replace(/[；]/gu, ";")
    .replace(/[！？]/gu, (value) => value === "！" ? "!" : "?")
    .replace(/\s*([,.:;!?])\s*/gu, "$1 ")
    .replace(/\s+/gu, " ")
    .replace(/[\s.]+$/gu, "")
    .toLowerCase();
}

export async function generateClaimId(input: {
  statement: string;
  sourcePath: string;
  scope?: string[];
  qualifiers?: string[];
}): Promise<string> {
  const identity = JSON.stringify({
    statement: normalizeClaim(input.statement),
    sourcePath: normalizeSourcePath(input.sourcePath),
    scope: normalizeList(input.scope),
    qualifiers: normalizeList(input.qualifiers)
  });
  return `claim_${(await sha256Text(identity)).slice(0, 24)}`;
}

export async function generateCandidateClaimId(input: {
  statement: string;
  sourcePath: string;
  scope?: string[];
  qualifiers?: string[];
}): Promise<string> {
  const id = await generateClaimId(input);
  return `candidate_${id.slice("claim_".length)}`;
}

export function deduplicateClaims<T extends ClaimRecord | CandidateClaim>(claims: T[]): T[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = `${claim.normalizedStatement}|${normalizeList(claim.scope).join("|")}|${normalizeList(claim.qualifiers).join("|")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => normalizeClaim(value)).filter(Boolean))].sort();
}
