import {
  CLAIM_ACRONYMS
} from "../knowledge/acronyms";
import {
  CHINESE_CLAIM_STOP_WORDS,
  ENGLISH_CLAIM_STOP_WORDS
} from "../knowledge/stopwords";
import {
  CLAIM_TERM_ALIASES
} from "../knowledge/term-aliases";
import type {
  CandidateClaim,
  ClaimRecord,
  ClaimRetrievalDebug,
  ClaimRetrievalFeatures,
  ClaimRetrievalMatch,
  ClaimRetrievalVersion
} from "../types/claim";
import { normalizeClaim } from "./claim-identity";

export const CLAIM_RETRIEVAL_VERSION: ClaimRetrievalVersion = "claim-retrieval-v2";
export const CLAIM_RETRIEVAL_V1: ClaimRetrievalVersion = "claim-retrieval-v1";
export const CLAIM_RETRIEVAL_CANDIDATE_POOL_SIZE = 20;

// Centralized weights keep the deterministic reranker reviewable. Text and
// phrase evidence dominates; metadata can help ordering but cannot create a
// strong match by itself. Qualifier/negation mismatch remains retrieval-positive
// because conflicting claims must enter Top K before relation classification.
export const CLAIM_RETRIEVAL_WEIGHTS = {
  lexicalScore: 0.12,
  tokenOverlap: 0.16,
  phraseScore: 0.17,
  topicScore: 0.07,
  typeScore: 0.04,
  qualifierScore: 0.06,
  acronymScore: 0.11,
  aliasScore: 0.16,
  provenanceScore: 0.02,
  negationScore: 0.03,
  numericScore: 0.03,
  versionScore: 0.03
} as const;

export interface RetrievalSignals {
  normalized: string;
  tokens: Set<string>;
  phrases: Set<string>;
  aliases: Set<string>;
  acronyms: Set<string>;
  qualifiers: Set<string>;
  negations: Set<string>;
  numbers: Set<string>;
  versions: Set<string>;
}

interface ScoredClaim {
  claim: ClaimRecord;
  cheapScore: number;
}

interface PreparedExistingSignals {
  statement: RetrievalSignals;
  topic: RetrievalSignals;
  headings: RetrievalSignals[];
}

interface CompiledTerm {
  normalized: string;
  tokens: Set<string>;
}

interface CompiledGroup {
  id: string;
  terms: CompiledTerm[];
}

const EXISTING_SIGNAL_CACHE = new WeakMap<ClaimRecord, PreparedExistingSignals>();
const COMPILED_TERM_ALIASES: CompiledGroup[] = CLAIM_TERM_ALIASES.map((group) => ({
  id: group.id,
  terms: group.terms.map(compileTerm)
}));
const COMPILED_ACRONYMS: Array<CompiledGroup & { acronym: string }> = CLAIM_ACRONYMS.map((group) => ({
  id: group.id,
  acronym: group.acronym,
  terms: group.expansions.map(compileTerm)
}));

export interface ClaimRetrievalResult {
  matches: ClaimRetrievalMatch[];
  debug: ClaimRetrievalDebug;
}

export class ClaimRetrievalService {
  constructor(private readonly getClaims: () => ClaimRecord[]) {}

  retrieve(
    candidate: CandidateClaim,
    topK: number,
    version: ClaimRetrievalVersion = CLAIM_RETRIEVAL_VERSION
  ): ClaimRetrievalMatch[] {
    return this.retrieveWithDebug(candidate, topK, version).matches;
  }

  retrieveWithDebug(
    candidate: CandidateClaim,
    topK: number,
    version: ClaimRetrievalVersion = CLAIM_RETRIEVAL_VERSION
  ): ClaimRetrievalResult {
    const limit = Math.min(10, Math.max(3, topK));
    const claims = this.getClaims()
      .filter((claim) => claim.status === "active" || claim.status === "disputed");
    if (version === CLAIM_RETRIEVAL_V1) {
      const matches = claims
        .map((claim) => scoreClaimV1(candidate, claim))
        .filter((match) => match.score > 0)
        .sort(compareMatches)
        .slice(0, limit);
      return {
        matches,
        debug: createDebug(candidate, version, claims.length, matches, claims)
      };
    }

    const candidateSignals = buildClaimRetrievalSignals(candidate.statement);
    const topicSignals = buildClaimRetrievalSignals(candidate.topic ?? "");
    const pool = generateCandidatePool(
      candidate,
      candidateSignals,
      topicSignals,
      claims,
      CLAIM_RETRIEVAL_CANDIDATE_POOL_SIZE
    );
    const matches = pool
      .map(({ claim }) => scoreClaimV2(candidate, claim, candidateSignals, topicSignals))
      .filter((match) => match.score > 0)
      .sort(compareMatches)
      .slice(0, limit);
    return {
      matches,
      debug: createDebug(candidate, version, pool.length, matches, claims)
    };
  }
}

export function scoreClaim(
  candidate: CandidateClaim,
  existing: ClaimRecord
): ClaimRetrievalMatch {
  return scoreClaimV2(
    candidate,
    existing,
    buildClaimRetrievalSignals(candidate.statement),
    buildClaimRetrievalSignals(candidate.topic ?? "")
  );
}

export function scoreClaimV1(
  candidate: CandidateClaim,
  existing: ClaimRecord
): ClaimRetrievalMatch {
  if (candidate.normalizedStatement === existing.normalizedStatement) {
    return { claimId: existing.id, score: 1, reasons: ["normalized statement exact match"] };
  }
  const candidateTokens = tokenizeClaimV1(candidate.normalizedStatement);
  const existingTokens = tokenizeClaimV1(existing.normalizedStatement);
  const overlap = weightedJaccard(candidateTokens, existingTokens);
  const reasons = [`token overlap ${overlap.toFixed(2)}`];
  let score = overlap * 0.78;
  if (candidate.type === existing.type) {
    score += 0.08;
    reasons.push("same claim type");
  }
  const topicOverlap = listOverlapV1(
    candidate.topic === undefined ? [] : [candidate.topic],
    existing.topic === undefined ? [] : [existing.topic]
  );
  if (topicOverlap > 0) {
    score += 0.08 * topicOverlap;
    reasons.push("topic overlap");
  }
  const scopeOverlap = listOverlapV1(candidate.scope ?? [], existing.scope ?? []);
  if (scopeOverlap > 0) {
    score += 0.04 * scopeOverlap;
    reasons.push("scope overlap");
  }
  const qualifierOverlap = listOverlapV1(candidate.qualifiers ?? [], existing.qualifiers ?? []);
  if (qualifierOverlap > 0) {
    score += 0.02 * qualifierOverlap;
    reasons.push("qualifier overlap");
  }
  return { claimId: existing.id, score: Math.min(0.99, score), reasons };
}

export function tokenizeClaimText(value: string): Set<string> {
  const normalized = normalizeForRetrieval(value);
  const tokens = new Set<string>();
  const chunks = normalized.match(/[a-z]+(?:-[a-z0-9]+)*|[a-z]*\d+[a-z0-9.-]*|[\p{Script=Han}]+/gu) ?? [];
  for (const chunk of chunks) {
    if (/^[\p{Script=Han}]+$/u.test(chunk)) {
      addChineseTokens(tokens, chunk);
      continue;
    }
    const token = normalizeEnglishToken(chunk);
    if (token.length > 1 && !ENGLISH_CLAIM_STOP_WORDS.has(token)) {
      tokens.add(token);
    }
  }
  for (const match of normalized.matchAll(/\b(model|benchmark|dataset)\s+([a-z0-9][a-z0-9.-]*)\b/gu)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      tokens.add(`${match[1]}:${match[2].replace(/[-_.]/gu, "")}`);
    }
  }
  return tokens;
}

export function buildClaimRetrievalSignals(value: string): RetrievalSignals {
  const normalized = normalizeForRetrieval(value);
  const tokens = tokenizeClaimText(normalized);
  const aliases = findGroupIds(normalized, tokens, COMPILED_TERM_ALIASES);
  const acronyms = findAcronymIds(normalized, tokens, COMPILED_ACRONYMS);
  return {
    normalized,
    tokens,
    phrases: extractPhrases(normalized, tokens),
    aliases,
    acronyms,
    qualifiers: extractQualifiers(normalized),
    negations: extractNegations(normalized),
    numbers: extractNumbers(normalized),
    versions: extractVersions(normalized)
  };
}

function generateCandidatePool(
  candidate: CandidateClaim,
  candidateSignals: RetrievalSignals,
  topicSignals: RetrievalSignals,
  claims: ClaimRecord[],
  size: number
): ScoredClaim[] {
  return claims
    .map((claim) => {
      if (candidate.normalizedStatement === claim.normalizedStatement) {
        return { claim, cheapScore: 1 };
      }
      const prepared = prepareExistingSignals(claim);
      const cheapScore = weightedJaccard(candidateSignals.tokens, prepared.statement.tokens) * 0.35 +
        setOverlap(candidateSignals.phrases, prepared.statement.phrases) * 0.25 +
        setOverlap(candidateSignals.aliases, prepared.statement.aliases) * 0.22 +
        setOverlap(candidateSignals.acronyms, prepared.statement.acronyms) * 0.12 +
        signalOverlap(topicSignals, prepared.topic) * 0.06;
      return { claim, cheapScore };
    })
    .sort((left, right) =>
      right.cheapScore - left.cheapScore || left.claim.id.localeCompare(right.claim.id)
    )
    .slice(0, Math.max(size, Math.min(claims.length, 3)));
}

function scoreClaimV2(
  candidate: CandidateClaim,
  existing: ClaimRecord,
  candidateSignals: RetrievalSignals,
  candidateTopic: RetrievalSignals
): ClaimRetrievalMatch {
  if (candidate.normalizedStatement === existing.normalizedStatement) {
    const features = perfectFeatures();
    return {
      claimId: existing.id,
      score: 1,
      features,
      matchedTerms: [candidate.normalizedStatement],
      reasons: ["normalized statement exact match"]
    };
  }
  const prepared = prepareExistingSignals(existing);
  const existingSignals = prepared.statement;
  const existingTopic = prepared.topic;
  const headingSignals = prepared.headings;
  const tokenOverlap = weightedJaccard(candidateSignals.tokens, existingSignals.tokens);
  const phraseScore = setOverlap(candidateSignals.phrases, existingSignals.phrases);
  const aliasScore = setOverlap(candidateSignals.aliases, existingSignals.aliases);
  const acronymScore = setOverlap(candidateSignals.acronyms, existingSignals.acronyms);
  const topicScore = signalOverlap(candidateTopic, existingTopic);
  const qualifierScore = qualifierRetrievalScore(candidateSignals, existingSignals);
  const negationScore = negationRetrievalScore(candidateSignals, existingSignals);
  const numericScore = contrastiveSetScore(candidateSignals.numbers, existingSignals.numbers);
  const versionScore = contrastiveSetScore(candidateSignals.versions, existingSignals.versions);
  const provenanceScore = provenanceRetrievalScore(candidateSignals, existing, headingSignals);
  const features: ClaimRetrievalFeatures = {
    lexicalScore: characterNgramSimilarity(candidateSignals.normalized, existingSignals.normalized),
    tokenOverlap,
    phraseScore,
    topicScore,
    typeScore: candidate.type === existing.type ? 1 : 0,
    qualifierScore,
    acronymScore,
    aliasScore,
    provenanceScore,
    negationScore,
    numericScore,
    versionScore
  };
  const score = Object.entries(CLAIM_RETRIEVAL_WEIGHTS).reduce(
    (total, [key, weight]) => total + features[key as keyof ClaimRetrievalFeatures] * weight,
    0
  );
  const matchedTerms = collectMatchedTerms(candidateSignals, existingSignals);
  const reasons = buildReasons(features, matchedTerms, candidateSignals, existingSignals);
  return {
    claimId: existing.id,
    score: roundScore(Math.min(0.99, score)),
    features,
    matchedTerms,
    reasons
  };
}

function createDebug(
  candidate: CandidateClaim,
  version: ClaimRetrievalVersion,
  candidatePoolSize: number,
  matches: ClaimRetrievalMatch[],
  claims: ClaimRecord[]
): ClaimRetrievalDebug {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const signals = buildClaimRetrievalSignals(candidate.statement);
  return {
    candidateClaimId: candidate.id,
    candidateStatement: candidate.statement,
    retrievalVersion: version,
    candidatePoolSize,
    candidateTokens: [...signals.tokens].sort(),
    expandedTerms: [
      ...[...signals.aliases].map((id) => `alias:${id}`),
      ...[...signals.acronyms].map((id) => `acronym:${id}`)
    ].sort(),
    matchedClaims: matches.map((match) => ({
      claimId: match.claimId,
      statement: claimsById.get(match.claimId)?.statement ?? "",
      finalScore: match.score,
      features: match.features ?? emptyFeatures(),
      matchedTerms: match.matchedTerms ?? [],
      reasons: match.reasons
    }))
  };
}

function normalizeForRetrieval(value: string): string {
  return normalizeClaim(value)
    .replace(/([a-z])[-‐‑‒–—―]([a-z])/gu, "$1 $2")
    .replace(/[\\/|，、。；：！？()[\]{}<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function prepareExistingSignals(existing: ClaimRecord): PreparedExistingSignals {
  const cached = EXISTING_SIGNAL_CACHE.get(existing);
  if (cached !== undefined) return cached;
  const prepared = {
    statement: buildClaimRetrievalSignals(existing.statement),
    topic: buildClaimRetrievalSignals(existing.topic ?? ""),
    headings: existing.provenance.map((item) =>
      buildClaimRetrievalSignals(item.heading ?? "")
    )
  };
  EXISTING_SIGNAL_CACHE.set(existing, prepared);
  return prepared;
}

function normalizeEnglishToken(value: string): string {
  const token = value.toLowerCase().replace(/[-_.]/gu, "");
  if (/\d/u.test(token)) return token;
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("sses")) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4 && !/(ss|us|is)$/u.test(token)) {
    return token.slice(0, -1);
  }
  return token
    .replace(/^(persists?|persisted|persistent|persistence)$/u, "persist")
    .replace(/^(stores?|stored|storing)$/u, "store")
    .replace(/^(improves?|improved|improvement)$/u, "improve")
    .replace(/^(evaluates?|evaluated|evaluating)$/u, "evaluate");
}

function addChineseTokens(output: Set<string>, value: string): void {
  const cleaned = [...CHINESE_CLAIM_STOP_WORDS]
    .sort((left, right) => right.length - left.length)
    .reduce((current, stopWord) => current.split(stopWord).join(" "), value);
  for (const segment of cleaned.split(/\s+/u).filter(Boolean)) {
    if (segment.length >= 2 && segment.length <= 8) output.add(segment);
    for (const size of [2, 3]) {
      for (let index = 0; index + size <= segment.length; index += 1) {
        const gram = segment.slice(index, index + size);
        if (!CHINESE_CLAIM_STOP_WORDS.has(gram)) output.add(gram);
      }
    }
  }
}

function extractPhrases(normalized: string, tokens: Set<string>): Set<string> {
  const phrases = new Set<string>();
  for (const group of COMPILED_TERM_ALIASES) {
    for (const term of group.terms) {
      if (containsTerm(normalized, term.normalized)) phrases.add(term.normalized);
    }
  }
  for (const group of COMPILED_ACRONYMS) {
    for (const term of group.terms) {
      if (containsTerm(normalized, term.normalized)) phrases.add(term.normalized);
    }
  }
  // Numeric equality is scored separately. Allowing numbers into phrase ngrams
  // would incorrectly make Model B 92% outrank Model A 80% for a Model A claim.
  const english = [...tokens].filter((token) => /^[a-z]+$/u.test(token));
  for (const size of [2, 3]) {
    for (let index = 0; index + size <= english.length; index += 1) {
      phrases.add(english.slice(index, index + size).join(" "));
    }
  }
  return phrases;
}

function findGroupIds(
  normalized: string,
  tokens: Set<string>,
  groups: CompiledGroup[]
): Set<string> {
  return new Set(groups.filter((group) =>
    group.terms.some((term) => matchesExpansionTerm(normalized, tokens, term))
  ).map((group) => group.id));
}

function findAcronymIds(
  normalized: string,
  tokens: Set<string>,
  groups: Array<CompiledGroup & { acronym: string }>
): Set<string> {
  return new Set(groups.filter((group) =>
    containsTerm(normalized, group.acronym) ||
    group.terms.some((term) => matchesExpansionTerm(normalized, tokens, term))
  ).map((group) => group.id));
}

function matchesExpansionTerm(
  text: string,
  textTokens: Set<string>,
  term: CompiledTerm
): boolean {
  if (containsTerm(text, term.normalized)) return true;
  return term.tokens.size > 0 && [...term.tokens].every((token) => textTokens.has(token));
}

function compileTerm(value: string): CompiledTerm {
  const normalized = normalizeForRetrieval(value);
  return { normalized, tokens: tokenizeClaimText(normalized) };
}

function containsTerm(text: string, term: string): boolean {
  if (term.length === 0) return false;
  if (/[\p{Script=Han}]/u.test(term)) return text.includes(term);
  return (` ${text} `).includes(` ${term} `);
}

function extractQualifiers(value: string): Set<string> {
  const qualifiers = new Set<string>();
  const patterns: Array<[string, RegExp]> = [
    ["absolute", /\b(always|only|must|never|all)\b|必然|总是|唯一|必须|绝不|全部/iu],
    ["hedged", /\b(may|might|can|usually|often|sometimes|typically)\b|可能|通常|有时|一般|往往/iu],
    ["conditional", /\b(if|when|under|depending)\b|条件|情况下|取决于/iu]
  ];
  for (const [label, pattern] of patterns) if (pattern.test(value)) qualifiers.add(label);
  return qualifiers;
}

function extractNegations(value: string): Set<string> {
  const negations = new Set<string>();
  if (/\b(not|never|no longer|cannot|can't|without)\b|不再|不是|不能|无法|没有|无/u.test(value)) {
    negations.add("negative");
  } else {
    negations.add("positive");
  }
  return negations;
}

function extractNumbers(value: string): Set<string> {
  return new Set(value.match(/\b\d+(?:\.\d+)?(?:%|k|m|b)?\b/giu) ?? []);
}

function extractVersions(value: string): Set<string> {
  return new Set((value.match(/\b(?:gpt|claude|qwen|llama|gemini|v)\s*-?\s*\d+(?:\.\d+)?[a-z]?\b/giu) ?? [])
    .map((item) => item.replace(/\s+/gu, "").toLowerCase()));
}

function qualifierRetrievalScore(left: RetrievalSignals, right: RetrievalSignals): number {
  if (left.qualifiers.size === 0 && right.qualifiers.size === 0) return 0.2;
  if (setIntersection(left.qualifiers, right.qualifiers).size > 0) return 1;
  const contrast = (left.qualifiers.has("absolute") && right.qualifiers.has("hedged")) ||
    (right.qualifiers.has("absolute") && left.qualifiers.has("hedged"));
  return contrast ? 0.95 : 0.35;
}

function negationRetrievalScore(left: RetrievalSignals, right: RetrievalSignals): number {
  const same = setIntersection(left.negations, right.negations).size > 0;
  // Polarity opposition is a high-value comparison candidate, not a reason to
  // suppress retrieval.
  return same ? 0.5 : 1;
}

function contrastiveSetScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  return setIntersection(left, right).size > 0 ? 1 : 0.65;
}

function provenanceRetrievalScore(
  candidate: RetrievalSignals,
  existing: ClaimRecord,
  headings: RetrievalSignals[]
): number {
  const headingScore = headings.reduce(
    (maximum, heading) => Math.max(maximum, signalOverlap(candidate, heading)),
    0
  );
  const acceptedWiki = existing.provenance.some((item) =>
    item.sourceKind === "wiki" && item.accepted !== false
  ) ? 1 : 0;
  return headingScore * 0.7 + acceptedWiki * 0.3;
}

function collectMatchedTerms(left: RetrievalSignals, right: RetrievalSignals): string[] {
  return [
    ...setIntersection(left.phrases, right.phrases),
    ...[...setIntersection(left.aliases, right.aliases)].map((value) => `alias:${value}`),
    ...[...setIntersection(left.acronyms, right.acronyms)].map((value) => `acronym:${value}`),
    ...setIntersection(left.tokens, right.tokens)
  ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 12);
}

function buildReasons(
  features: ClaimRetrievalFeatures,
  matchedTerms: string[],
  left: RetrievalSignals,
  right: RetrievalSignals
): string[] {
  const reasons: string[] = [];
  if (features.phraseScore > 0) reasons.push(`phrase match ${features.phraseScore.toFixed(2)}`);
  if (features.aliasScore > 0) reasons.push(`alias match ${features.aliasScore.toFixed(2)}`);
  if (features.acronymScore > 0) reasons.push(`acronym match ${features.acronymScore.toFixed(2)}`);
  if (features.tokenOverlap > 0) reasons.push(`token overlap ${features.tokenOverlap.toFixed(2)}`);
  if (features.topicScore > 0) reasons.push(`topic match ${features.topicScore.toFixed(2)}`);
  if (features.typeScore > 0) reasons.push("same claim type");
  if (features.qualifierScore >= 0.9 && setIntersection(left.qualifiers, right.qualifiers).size === 0) {
    reasons.push("qualifier contrast retained for conflict comparison");
  }
  if (features.negationScore === 1) reasons.push("negation contrast retained for conflict comparison");
  if (features.numericScore === 0.65) reasons.push("different numbers retained for comparison");
  if (features.versionScore === 0.65) reasons.push("different versions retained for comparison");
  if (matchedTerms.length > 0) reasons.push(`matched terms: ${matchedTerms.join(", ")}`);
  return reasons.length === 0 ? ["metadata-only fallback"] : reasons;
}

function signalOverlap(left: RetrievalSignals, right: RetrievalSignals): number {
  return Math.max(
    weightedJaccard(left.tokens, right.tokens),
    setOverlap(left.aliases, right.aliases),
    setOverlap(left.acronyms, right.acronyms)
  );
}

function setOverlap(left: Set<string>, right: Set<string>): number {
  return weightedJaccard(left, right);
}

function setIntersection(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left].filter((value) => right.has(value)));
}

function characterNgramSimilarity(left: string, right: string): number {
  const leftNgrams = characterNgrams(left.replace(/\s+/gu, ""), 3);
  const rightNgrams = characterNgrams(right.replace(/\s+/gu, ""), 3);
  return weightedJaccard(leftNgrams, rightNgrams);
}

function characterNgrams(value: string, size: number): Set<string> {
  if (value.length < size) return value.length === 0 ? new Set() : new Set([value]);
  const output = new Set<string>();
  for (let index = 0; index + size <= value.length; index += 1) {
    output.add(value.slice(index, index + size));
  }
  return output;
}

function weightedJaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = setIntersection(left, right).size;
  const containment = intersection / Math.min(left.size, right.size);
  const jaccard = intersection / (left.size + right.size - intersection);
  return containment * 0.65 + jaccard * 0.35;
}

function tokenizeClaimV1(value: string): Set<string> {
  const canonical = value
    .replace(/\b(persists?|persisted|persistent|persistence)\b/gu, "persist")
    .replace(/\b(stores?|stored|storing)\b/gu, "store")
    .replace(/\b(improves?|improved|improvement)\b/gu, "improve")
    .replace(/\b(sessions?)\b/gu, "session")
    .replace(/\b(agents?)\b/gu, "agent");
  const tokens = canonical.match(/[a-z0-9]+(?:-[a-z0-9]+)*|[\p{Script=Han}]/gu) ?? [];
  return new Set(tokens.filter((token) => token.length > 1 || /[\p{Script=Han}]/u.test(token)));
}

function listOverlapV1(left: string[], right: string[]): number {
  return weightedJaccard(
    tokenizeClaimV1(left.join(" ").toLowerCase()),
    tokenizeClaimV1(right.join(" ").toLowerCase())
  );
}

function compareMatches(left: ClaimRetrievalMatch, right: ClaimRetrievalMatch): number {
  return right.score - left.score || left.claimId.localeCompare(right.claimId);
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function emptyFeatures(): ClaimRetrievalFeatures {
  return {
    lexicalScore: 0,
    tokenOverlap: 0,
    phraseScore: 0,
    topicScore: 0,
    typeScore: 0,
    qualifierScore: 0,
    acronymScore: 0,
    aliasScore: 0,
    provenanceScore: 0,
    negationScore: 0,
    numericScore: 0,
    versionScore: 0
  };
}

function perfectFeatures(): ClaimRetrievalFeatures {
  return {
    lexicalScore: 1,
    tokenOverlap: 1,
    phraseScore: 1,
    topicScore: 1,
    typeScore: 1,
    qualifierScore: 1,
    acronymScore: 1,
    aliasScore: 1,
    provenanceScore: 1,
    negationScore: 1,
    numericScore: 1,
    versionScore: 1
  };
}
