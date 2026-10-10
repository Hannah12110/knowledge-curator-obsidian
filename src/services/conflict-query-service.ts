import type { Conflict } from "../types/source-analysis";
import { sha256Text } from "./content-hash";

const MAX_QUERY_CHARS = 280;
const VERIFICATION_POLICY_VERSION = "phase4-ranking-v2";

export function generateConflictSearchQueries(topic: string, conflict: Conflict): string[] {
  const cleanTopic = collapseWhitespace(topic);
  const existing = truncateClaim(conflict.existingClaim);
  const incoming = truncateClaim(conflict.newClaim);
  const suffix = conflict.type === "temporal"
    ? "latest official documentation primary source publication date"
    : "official documentation original paper primary source";
  const candidates = [
    `${cleanTopic} ${existing} ${incoming} ${suffix}`,
    `${cleanTopic} ${conflict.type} comparison ${suffix}`
  ];
  return Array.from(new Set(
    candidates
      .map((query) => collapseWhitespace(query).slice(0, MAX_QUERY_CHARS).trim())
      .filter((query) => query.length > 0)
  )).slice(0, 3);
}

export async function createConflictId(
  sourcePath: string,
  conflict: Pick<Conflict, "existingClaim" | "newClaim">
): Promise<string> {
  const hash = await sha256Text([
    sourcePath,
    conflict.existingClaim,
    conflict.newClaim
  ].join("\n"));
  return `conflict-${hash.slice(0, 20)}`;
}

export async function createVerificationCacheKey(input: {
  conflictId: string;
  existingClaim: string;
  newClaim: string;
  queries: string[];
  provider: string;
  model: string;
}): Promise<string> {
  const [existingHash, newHash, queryHash] = await Promise.all([
    sha256Text(input.existingClaim),
    sha256Text(input.newClaim),
    sha256Text(input.queries.join("\n"))
  ]);
  return [
    VERIFICATION_POLICY_VERSION,
    input.conflictId,
    existingHash,
    newHash,
    queryHash,
    input.provider,
    input.model
  ].join(":");
}

function truncateClaim(value: string): string {
  return collapseWhitespace(value).slice(0, 110);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
