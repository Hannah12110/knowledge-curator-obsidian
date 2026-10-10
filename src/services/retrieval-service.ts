import type { TFile } from "obsidian";
import type {
  KnowledgeSourceKind,
  RetrievalCandidate
} from "../types/analysis";
import type { KnowledgeCuratorSettings } from "../types/settings";
import type { VaultService } from "./vault-service";
import {
  createRetrievalScopeSnapshot,
  isPathInsideFolder
} from "./path-scope";

export const MAX_RELATED_NOTE_CHARS = 8_000;
const MAX_SCORING_CHARS = 30_000;

export interface RetrievalSignals {
  title: string;
  tags: string[];
  headings: string[];
  wikiLinks: string[];
  content: string;
}

export interface CandidateScore {
  relevance: number;
  reason: string;
}

export class RetrievalService {
  constructor(
    private readonly vaultService: VaultService,
    private readonly getSettings: () => KnowledgeCuratorSettings
  ) {}

  async findRelatedNotes(sourceFile: TFile): Promise<RetrievalCandidate[]> {
    const sourceContent = await this.vaultService.readMarkdown(sourceFile);
    const sourceSignals = buildRetrievalSignals(
      this.vaultService.getDisplayTitle(sourceFile),
      sourceContent,
      this.vaultService.getSupportedFrontmatter(sourceFile)
    );

    const settings = this.getSettings();
    const scope = createRetrievalScopeSnapshot(settings);
    const wikiFiles = (await this.vaultService.listWikiFiles())
      .filter((file) => isPathInsideFolder(file.path, scope.wikiFolder));
    const rawFiles = (await this.vaultService.listRawFiles())
      .filter((file) => scope.rawFolders.some((folder) =>
        isPathInsideFolder(file.path, folder)
      ));

    console.debug("[Knowledge Curator] Retrieval scope", JSON.stringify({
      inboxFolder: scope.inboxFolder,
      wikiFolder: scope.wikiFolder,
      rawFolders: scope.rawFolders,
      candidateWikiCount: wikiFiles.length,
      candidateRawCount: rawFiles.length,
      candidatePaths: [
        ...wikiFiles.map((file) => file.path),
        ...rawFiles.map((file) => file.path)
      ].slice(0, 20)
    }));
    const candidates = await Promise.all([
      ...wikiFiles.map((file) => this.buildCandidate(file, "wiki", sourceSignals)),
      ...rawFiles.map((file) => this.buildCandidate(file, "raw", sourceSignals))
    ]);

    const maximum = settings.maxRelatedNotes;
    return candidates
      .filter((candidate) => candidate !== null && candidate.path !== sourceFile.path)
      .map((candidate) => candidate as RetrievalCandidate)
      .sort((left, right) => {
        const scoreDifference = right.relevance - left.relevance;
        if (Math.abs(scoreDifference) > 0.0001) {
          return scoreDifference;
        }
        if (left.kind !== right.kind) {
          return left.kind === "wiki" ? -1 : 1;
        }
        return left.path.localeCompare(right.path);
      })
      .slice(0, maximum);
  }

  private async buildCandidate(
    file: TFile,
    kind: KnowledgeSourceKind,
    sourceSignals: RetrievalSignals
  ): Promise<RetrievalCandidate | null> {
    try {
      const fullContent = await this.vaultService.readMarkdown(file);
      const candidateSignals = buildRetrievalSignals(
        this.vaultService.getDisplayTitle(file),
        fullContent.slice(0, MAX_SCORING_CHARS),
        this.vaultService.getSupportedFrontmatter(file)
      );
      const score = scoreKnowledgeCandidate(sourceSignals, candidateSignals, kind);
      const truncated = fullContent.length > MAX_RELATED_NOTE_CHARS;

      return {
        path: file.path,
        title: candidateSignals.title,
        kind,
        relevance: score.relevance,
        reason: score.reason,
        content: truncated
          ? fullContent.slice(0, MAX_RELATED_NOTE_CHARS)
          : fullContent,
        truncated
      };
    } catch (error: unknown) {
      console.warn(`Knowledge Curator skipped retrieval candidate ${file.path}.`, error);
      return null;
    }
  }
}

export function buildRetrievalSignals(
  title: string,
  content: string,
  frontmatter?: Record<string, unknown>
): RetrievalSignals {
  return {
    title,
    tags: normalizeTags(frontmatter?.tags),
    headings: extractHeadings(content),
    wikiLinks: extractWikiLinks(content),
    content
  };
}

export function scoreKnowledgeCandidate(
  source: RetrievalSignals,
  candidate: RetrievalSignals,
  kind: KnowledgeSourceKind
): CandidateScore {
  const sourceTitle = compactText(source.title);
  const candidateTitle = compactText(candidate.title);
  const exactTitle = sourceTitle.length > 0 && sourceTitle === candidateTitle ? 1 : 0;
  const titleOverlap = titleTokenOverlap(source.title, candidate.title);
  const tagOverlap = setOverlap(source.tags, candidate.tags);
  const headingOverlap = textListOverlap(
    [source.title, ...source.headings],
    candidate.headings
  );
  const wikiLinkOverlap = Math.max(
    textListOverlap(source.wikiLinks, [candidate.title, ...candidate.headings]),
    textListOverlap(candidate.wikiLinks, [source.title, ...source.headings])
  );
  const bodyOverlap = tokenOverlap(
    `${source.title}\n${source.content.slice(0, MAX_SCORING_CHARS)}`,
    `${candidate.title}\n${candidate.content.slice(0, MAX_SCORING_CHARS)}`
  );

  const baseScore = exactTitle === 1
    ? 0.96
    : (
      titleOverlap * 0.42 +
      tagOverlap * 0.24 +
      headingOverlap * 0.12 +
      wikiLinkOverlap * 0.12 +
      bodyOverlap * 0.10
    );
  const relevance = clamp(baseScore + (kind === "wiki" ? 0.06 : 0), 0, 1);

  const reasons: string[] = [];
  if (exactTitle === 1) {
    reasons.push("标题完全匹配");
  } else if (titleOverlap >= 0.25) {
    reasons.push("标题关键词相关");
  }
  if (tagOverlap > 0) {
    reasons.push("Frontmatter 标签相关");
  }
  if (headingOverlap > 0) {
    reasons.push("标题层级相关");
  }
  if (wikiLinkOverlap > 0) {
    reasons.push("Wiki 链接相关");
  }
  if (bodyOverlap >= 0.08) {
    reasons.push("正文关键词相关");
  }
  if (kind === "wiki") {
    reasons.push("结构化 Wiki 优先");
  }

  return {
    relevance: round(relevance),
    reason: reasons.length > 0 ? reasons.join("；") : "低强度词汇相关"
  };
}

function normalizeTags(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[，,\s]+/u)
      .map((tag) => tag.replace(/^#/u, "").trim())
      .filter((tag) => tag.length > 0);
  }
  if (Array.isArray(value)) {
    return value
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.replace(/^#/u, "").trim())
      .filter((tag) => tag.length > 0);
  }
  return [];
}

function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split(/\r?\n/u)) {
    const match = /^#{1,6}\s+(.+)$/u.exec(line.trim());
    if (match?.[1] !== undefined) {
      headings.push(match[1].trim());
    }
  }
  return headings;
}

function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1] !== undefined) {
      links.push(match[1].trim());
    }
  }
  return links;
}

function textListOverlap(source: string[], candidate: string[]): number {
  if (source.length === 0 || candidate.length === 0) {
    return 0;
  }
  let best = 0;
  for (const sourceValue of source) {
    for (const candidateValue of candidate) {
      best = Math.max(best, tokenOverlap(sourceValue, candidateValue));
    }
  }
  return best;
}

function setOverlap(left: string[], right: string[]): number {
  const leftTokens = tokenize(left.join(" "));
  const rightTokens = tokenize(right.join(" "));
  return overlapCoefficient(leftTokens, rightTokens);
}

function tokenOverlap(left: string, right: string): number {
  return overlapCoefficient(tokenize(left), tokenize(right));
}

function titleTokenOverlap(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  TITLE_GENERIC_TOKENS.forEach((token) => {
    leftTokens.delete(token);
    rightTokens.delete(token);
  });
  return overlapCoefficient(leftTokens, rightTokens);
}

function overlapCoefficient(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let matches = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      matches += 1;
    }
  });
  return matches / Math.min(left.size, right.size);
}

function tokenize(text: string): Set<string> {
  const normalized = text
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase();
  const tokens = new Set<string>();
  const matches = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9_-]{1,}/gu) ?? [];
  for (const match of matches) {
    if (/^[\p{Script=Han}]+$/u.test(match)) {
      if (match.length <= 6) {
        tokens.add(match);
      }
      for (let index = 0; index < match.length - 1; index += 1) {
        tokens.add(match.slice(index, index + 2));
      }
    } else if (!ENGLISH_STOP_WORDS.has(match)) {
      tokens.add(match);
    }
  }
  return tokens;
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const ENGLISH_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "are",
  "was",
  "how",
  "what"
]);

const TITLE_GENERIC_TOKENS = new Set([
  "ai",
  "agent",
  "评测",
  "设计",
  "方法",
  "系统"
]);
