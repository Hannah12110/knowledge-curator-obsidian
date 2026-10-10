import type {
  ExternalSourceType,
  RankedSearchResult,
  SearchResult,
  SourceScore,
  SourceTier
} from "../types/verification";

const OFFICIAL_VENDOR_DOMAINS = [
  "anthropic.com",
  "claude.com",
  "openai.com",
  "deepmind.google",
  "ai.google.dev",
  "developers.google.com",
  "microsoft.com",
  "docs.aws.amazon.com"
];
const STANDARD_DOMAINS = ["w3.org", "ietf.org", "iso.org", "nist.gov"];
const COMMUNITY_DOMAINS = [
  "medium.com",
  "substack.com",
  "dev.to",
  "reddit.com",
  "stackoverflow.com",
  "quora.com"
];
const PROFESSIONAL_ENGINEERING_DOMAINS = [
  "atlan.com",
  "langchain.com",
  "machinelearningmastery.com",
  "mem0.ai",
  "mongodb.com",
  "redis.io",
  "unite.ai"
];
const LOW_TRUST_DOMAINS = [
  "pinterest.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com"
];

export function deduplicateSearchResults(results: SearchResult[]): SearchResult[] {
  const output: SearchResult[] = [];
  const urls = new Set<string>();
  const domainTitles = new Set<string>();
  for (const result of results) {
    const canonicalUrl = canonicalizeUrl(result.url);
    if (canonicalUrl === null) {
      continue;
    }
    const url = new URL(canonicalUrl);
    const domain = url.hostname.toLowerCase().replace(/^www\./u, "");
    const titleKey = normalizeText(result.title);
    const domainTitleKey = `${domain}:${titleKey}`;
    if (urls.has(canonicalUrl) || domainTitles.has(domainTitleKey)) {
      continue;
    }
    urls.add(canonicalUrl);
    domainTitles.add(domainTitleKey);
    output.push({ ...result, url: canonicalUrl, domain });
  }
  return output;
}

export function rankSearchResults(
  results: SearchResult[],
  queries: string[],
  now = new Date()
): RankedSearchResult[] {
  const deduplicated = deduplicateSearchResults(results);
  const domainCounts = new Map<string, number>();
  for (const result of deduplicated) {
    const domain = getDomain(result);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  return deduplicated
    .map((result) => ({
      ...result,
      score: scoreSource(
        result,
        queries,
        domainCounts.get(getDomain(result)) ?? 1,
        now
      )
    }))
    .sort(compareRankedSources)
    .slice(0, 10);
}

export function classifySource(result: SearchResult): {
  tier: SourceTier;
  sourceType: ExternalSourceType;
  primarySource: boolean;
  reason: string;
} {
  const domain = getDomain(result);
  const url = new URL(result.url);
  const context = normalizeText(`${result.title} ${url.pathname}`);
  if (domain === "arxiv.org" || domain === "doi.org") {
    return {
      tier: 0,
      sourceType: "paper",
      primarySource: true,
      reason: "原始论文或 DOI 入口。"
    };
  }
  if (STANDARD_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`))) {
    return {
      tier: 0,
      sourceType: "official",
      primarySource: true,
      reason: "标准组织或政府研究机构的官方来源。"
    };
  }
  const officialVendor = OFFICIAL_VENDOR_DOMAINS.some(
    (item) => domain === item || domain.endsWith(`.${item}`)
  );
  const documentationContext = /\b(docs?|documentation|reference|research|paper|technical report|api)\b/u.test(context);
  if (officialVendor && documentationContext) {
    return {
      tier: 0,
      sourceType: context.includes("research") || context.includes("paper")
        ? "research"
        : "official",
      primarySource: true,
      reason: "官方产品域名中的文档、研究或技术报告。"
    };
  }
  if (officialVendor) {
    return {
      tier: 1,
      sourceType: "engineering",
      primarySource: true,
      reason: "原始团队或官方工程实践来源。"
    };
  }
  if (domain.endsWith(".edu") || domain.includes("research.")) {
    return {
      tier: 1,
      sourceType: "research",
      primarySource: true,
      reason: "大学或研究机构来源。"
    };
  }
  if (domain === "github.com") {
    return {
      tier: 2,
      sourceType: "repository",
      primarySource: false,
      reason: "GitHub 仓库需要结合组织身份判断，不能仅凭域名视为官方。"
    };
  }
  if (PROFESSIONAL_ENGINEERING_DOMAINS.some(
    (item) => domain === item || domain.endsWith(`.${item}`)
  )) {
    return {
      tier: 2,
      sourceType: domain === "unite.ai" ? "media" : "engineering",
      primarySource: false,
      reason: "可识别的专业工程、产品或技术媒体来源，但不是已确认的一手官方材料。"
    };
  }
  if (LOW_TRUST_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`))) {
    return {
      tier: 4,
      sourceType: "community",
      primarySource: false,
      reason: "来源难以追溯或证据结构较弱。"
    };
  }
  if (
    COMMUNITY_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`)) ||
    /\b(roundup|top \d+|best tools?|ultimate guide)\b/u.test(context)
  ) {
    return {
      tier: 3,
      sourceType: "community",
      primarySource: false,
      reason: "社区或普通二手内容，需要回溯原始来源。"
    };
  }
  return {
    tier: 3,
    sourceType: "unknown",
    primarySource: false,
    reason: "当前元数据不足以确认权威性或一手属性，按一般二手来源保守处理。"
  };
}

export function canonicalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|ref$|source$|fbclid$|gclid$)/iu.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/u, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

function scoreSource(
  result: SearchResult,
  queries: string[],
  sameDomainCount: number,
  now: Date
): SourceScore {
  const classification = classifySource(result);
  const lexicalRelevance = calculateLexicalRelevance(result, queries);
  const relevance = clamp01(
    result.providerScore === undefined
      ? lexicalRelevance
      : result.providerScore * 0.7 + lexicalRelevance * 0.3
  );
  const authorityByTier: Record<SourceTier, number> = {
    0: 1,
    1: 0.88,
    2: 0.7,
    3: 0.45,
    4: 0.2
  };
  const recency = result.publishedAt === undefined
    ? undefined
    : calculateRecency(result.publishedAt, now);
  return {
    tier: classification.tier,
    authority: authorityByTier[classification.tier],
    relevance,
    recency,
    primarySource: classification.primarySource,
    independence: sameDomainCount === 1 ? 1 : clamp01(1 / sameDomainCount),
    reason: classification.reason
  };
}

function compareRankedSources(left: RankedSearchResult, right: RankedSearchResult): number {
  return left.score.tier - right.score.tier ||
    Number(right.score.primarySource) - Number(left.score.primarySource) ||
    right.score.relevance - left.score.relevance ||
    right.score.authority - left.score.authority ||
    (right.score.recency ?? 0) - (left.score.recency ?? 0);
}

function calculateLexicalRelevance(result: SearchResult, queries: string[]): number {
  const sourceTokens = new Set(tokenize(`${result.title} ${result.snippet ?? ""}`));
  const queryTokens = new Set(tokenize(queries.join(" ")));
  if (queryTokens.size === 0) {
    return 0;
  }
  let matched = 0;
  for (const token of queryTokens) {
    if (sourceTokens.has(token)) {
      matched += 1;
    }
  }
  return clamp01(matched / Math.min(12, queryTokens.size));
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function getDomain(result: SearchResult): string {
  if (result.domain !== undefined && result.domain.length > 0) {
    return result.domain.toLowerCase().replace(/^www\./u, "");
  }
  return new URL(result.url).hostname.toLowerCase().replace(/^www\./u, "");
}

function calculateRecency(publishedAt: string, now: Date): number {
  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  const ageDays = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
  return clamp01(1 - ageDays / (365 * 5));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
