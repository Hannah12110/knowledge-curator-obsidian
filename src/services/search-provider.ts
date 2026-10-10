import { requestUrl } from "obsidian";
import type { KnowledgeCuratorSettings } from "../types/settings";
import type { SearchOptions, SearchResult } from "../types/verification";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const SEARCH_TIMEOUT_MS = 30_000;

export interface SearchProvider {
  readonly id: "tavily";
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

export interface SearchTransportResponse {
  status: number;
  json?: unknown;
}

export type SearchTransport = (
  url: string,
  headers: Record<string, string>,
  body: string
) => Promise<SearchTransportResponse>;

export class SearchProviderError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
    public readonly originalError?: unknown
  ) {
    super(userMessage);
    this.name = "SearchProviderError";
  }
}

export class TavilySearchProvider implements SearchProvider {
  readonly id = "tavily" as const;

  constructor(
    private readonly getSettings: () => KnowledgeCuratorSettings,
    private readonly transport: SearchTransport = defaultSearchTransport,
    private readonly timeoutMs = SEARCH_TIMEOUT_MS
  ) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const settings = this.getSettings();
    const apiKey = settings.searchApiKey.trim();
    if (apiKey.length === 0) {
      throw new SearchProviderError(
        "请先在 Knowledge Curator 设置中配置 Search API Key。",
        "missing_search_api_key"
      );
    }
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new SearchProviderError("搜索 Query 不能为空。", "empty_query");
    }
    const maxResults = Math.min(
      10,
      Math.max(1, options.maxResults ?? settings.maxSearchResults)
    );
    const body = JSON.stringify({
      query: normalizedQuery,
      search_depth: "basic",
      chunks_per_source: 2,
      max_results: maxResults,
      topic: "general",
      include_published_date: true,
      include_answer: false,
      include_raw_content: false,
      include_images: false
    });

    let response: SearchTransportResponse;
    try {
      response = await withTimeout(
        this.transport(
          TAVILY_SEARCH_URL,
          {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body
        ),
        this.timeoutMs
      );
    } catch (error: unknown) {
      if (error instanceof SearchProviderError) {
        throw error;
      }
      throw new SearchProviderError(
        "无法连接搜索服务，请检查网络后重试。",
        "search_network_error",
        error
      );
    }

    console.debug("[Knowledge Curator] search response", {
      provider: this.id,
      httpStatus: response.status,
      queryChars: normalizedQuery.length,
      maxResults
    });
    if (response.status < 200 || response.status >= 300) {
      throw toSearchHttpError(response.status);
    }
    const root = asRecord(response.json);
    if (root === null || !Array.isArray(root.results)) {
      throw new SearchProviderError(
        "搜索服务返回了无法解析的结果。",
        "malformed_search_results"
      );
    }
    if (root.results.length === 0) {
      throw new SearchProviderError(
        "未找到足够可靠的外部来源。",
        "empty_search_results"
      );
    }
    const results = root.results
      .map(parseTavilyResult)
      .filter((result): result is SearchResult => result !== null);
    if (results.length === 0) {
      throw new SearchProviderError(
        "搜索服务返回了无法解析的结果。",
        "malformed_search_results"
      );
    }
    return results;
  }
}

function parseTavilyResult(value: unknown): SearchResult | null {
  const item = asRecord(value);
  if (item === null || typeof item.title !== "string" || typeof item.url !== "string") {
    return null;
  }
  const title = item.title.trim();
  const url = normalizeHttpUrl(item.url);
  if (title.length === 0 || url === null) {
    return null;
  }
  const result: SearchResult = {
    title,
    url,
    domain: new URL(url).hostname.toLowerCase()
  };
  if (typeof item.content === "string" && item.content.trim().length > 0) {
    result.snippet = item.content.trim().slice(0, 2_000);
  }
  if (typeof item.published_date === "string" && !Number.isNaN(Date.parse(item.published_date))) {
    result.publishedAt = new Date(item.published_date).toISOString();
  }
  if (typeof item.score === "number" && Number.isFinite(item.score)) {
    result.providerScore = clamp01(item.score);
  }
  return result;
}

function normalizeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function toSearchHttpError(status: number): SearchProviderError {
  if (status === 401 || status === 403) {
    return new SearchProviderError(
      "搜索服务 API Key 无效或无权限。",
      `search_http_${status}`
    );
  }
  if (status === 429) {
    return new SearchProviderError(
      "搜索请求过于频繁，请稍后重试。",
      "search_http_429"
    );
  }
  if (status >= 500) {
    return new SearchProviderError(
      "搜索服务暂时不可用，请稍后重试。",
      `search_http_${status}`
    );
  }
  return new SearchProviderError(
    `搜索服务请求失败（HTTP ${status}）。`,
    `search_http_${status}`
  );
}

async function defaultSearchTransport(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<SearchTransportResponse> {
  const response = await requestUrl({
    url,
    method: "POST",
    headers,
    body,
    throw: false
  });
  return { status: response.status, json: response.json };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new SearchProviderError(
        "搜索请求超时，请稍后重试。",
        "search_timeout"
      ));
    }, timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
