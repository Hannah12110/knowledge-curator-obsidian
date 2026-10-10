import type { ClaimRecord } from "../types/claim";
import {
  FRESHNESS_RISK_POLICY_VERSION
} from "../types/maintenance";
import type {
  ClaimMaintenanceRecord,
  FreshnessRisk,
  FreshnessRiskFactor,
  FreshnessResolution
} from "../types/maintenance";
import { sha256Text } from "./content-hash";

export const FRESHNESS_RISK_WEIGHTS = {
  type: {
    definition: 0.08,
    fact: 0.25,
    causal: 0.22,
    quantitative: 0.45,
    method: 0.20,
    experiential: 0.12,
    predictive: 0.42,
    opinion: 0.12
  },
  timeSensitiveEntity: 0.12,
  versionedProduct: 0.16,
  apiBehavior: 0.20,
  pricing: 0.36,
  quantitative: 0.18,
  benchmark: 0.20,
  currentState: 0.25,
  policyOrRule: 0.14,
  fastMovingField: 0.10,
  oldSource: 0.08,
  previousConflict: 0.16,
  unresolved: 0.10,
  recentVerification: -0.12,
  historicalScope: -0.24,
  stableDefinition: -0.18
} as const;

export interface FreshnessRiskInput {
  claim: ClaimRecord;
  sourceModified?: number;
  previousResolution?: FreshnessResolution;
  lastVerifiedAt?: string;
  now?: Date;
}

export class FreshnessRiskService {
  async fingerprint(claim: ClaimRecord): Promise<string> {
    return await sha256Text(JSON.stringify({
      statement: claim.normalizedStatement,
      type: claim.type,
      scope: [...(claim.scope ?? [])].sort(),
      qualifiers: [...(claim.qualifiers ?? [])].sort(),
      status: claim.status,
      provenance: claim.provenance.map((item) => ({ path: item.filePath, hash: item.fileHash }))
    }));
  }

  async assess(input: FreshnessRiskInput): Promise<ClaimMaintenanceRecord> {
    const now = input.now ?? new Date();
    const claimFingerprint = await this.fingerprint(input.claim);
    const text = normalize(`${input.claim.statement} ${(input.claim.scope ?? []).join(" ")} ${(input.claim.qualifiers ?? []).join(" ")}`);
    const factors: FreshnessRiskFactor[] = [];
    let score: number = FRESHNESS_RISK_WEIGHTS.type[input.claim.type];
    const add = (type: FreshnessRiskFactor["type"], weight: number, reason: string): void => {
      factors.push({ type, weight, reason });
      score += weight;
    };

    const historical = hasHistoricalScope(text);
    const currentState = /(?:当前|目前|最新|现在|现阶段|currently|latest|today|now|as of today)/iu.test(text);
    const apiBehavior = /\b(api|sdk|endpoint|parameter|parameters|feature|support(?:s|ed)?|context window)\b|接口|端点|参数|功能支持|上下文窗口/iu.test(text);
    const versioned = /\b(?:v\d+(?:\.\d+)*|gpt[-\s]?\d\w*|claude\s*\d(?:\.\d+)?|qwen\s*\d\w*|model\s+[a-z0-9.-]+)\b|版本/iu.test(text);
    const pricing = /(?:[$¥￥]\s*\d|\b(?:price|pricing|cost)\b|价格|定价|每百万|元\/|美元)/iu.test(text);
    const quantitative = /(?:\d+(?:\.\d+)?\s*(?:%|ms|s|秒|毫秒|k|m|b|万|亿|tokens?|个|倍)|成功率|延迟|吞吐|容量|context length|上下文长度)/iu.test(text);
    const benchmark = /\b(?:benchmark|sota|ranking|rank|leaderboard|pass rate)\b|基准测试|榜单|排名|当前最佳|通过率/iu.test(text);
    const policy = /\b(?:policy|regulation|rule|compliance)\b|政策|法规|规则|合规/iu.test(text);
    const fastMoving = /\b(?:llm|agent|generative ai|foundation model)\b|大模型|智能体|生成式人工智能/iu.test(text);
    const stableDefinition = input.claim.type === "definition" &&
      /\b(?:is|means|refers to|stands for)\b|\s是\s|是指|指的是|全称|定义/iu.test(text) &&
      !currentState && !pricing && !quantitative && !versioned;

    if (apiBehavior) add("api_behavior", FRESHNESS_RISK_WEIGHTS.apiBehavior, "涉及 API、SDK、参数或产品能力行为。");
    if (versioned) add("versioned_product", FRESHNESS_RISK_WEIGHTS.versionedProduct, "包含模型、产品或版本信息。");
    if (pricing) add("pricing", FRESHNESS_RISK_WEIGHTS.pricing, "包含价格或成本信息，变化频率通常较高。");
    if (quantitative) add("quantitative", FRESHNESS_RISK_WEIGHTS.quantitative, "包含数值、容量、延迟或成功率。");
    if (benchmark) add("benchmark", FRESHNESS_RISK_WEIGHTS.benchmark, "包含 Benchmark、排名或 SOTA 表述。");
    if (currentState) add("current_state", FRESHNESS_RISK_WEIGHTS.currentState, "使用“当前/最新”等当前状态表述。");
    if (policy) add("policy_or_rule", FRESHNESS_RISK_WEIGHTS.policyOrRule, "涉及可能变化的政策、规则或合规要求。");
    if (fastMoving) add("fast_moving_field", FRESHNESS_RISK_WEIGHTS.fastMovingField, "属于快速变化的 AI/Agent 领域。");
    if (apiBehavior || versioned || pricing) add("time_sensitive_entity", FRESHNESS_RISK_WEIGHTS.timeSensitiveEntity, "包含时效敏感实体或产品能力。");
    if (input.claim.status === "disputed") add("previous_conflict", FRESHNESS_RISK_WEIGHTS.previousConflict, "Claim 当前处于 disputed 状态。");
    if (input.previousResolution === "disputed") add("previous_conflict", FRESHNESS_RISK_WEIGHTS.unresolved, "上次验证仍存在分歧。");
    if (input.sourceModified !== undefined && (apiBehavior || versioned || pricing || currentState)) {
      const ageDays = Math.max(0, (now.getTime() - input.sourceModified) / 86_400_000);
      if (ageDays >= 365) add("old_source", FRESHNESS_RISK_WEIGHTS.oldSource, "时效敏感 Claim 的来源更新时间已超过一年。");
    }
    if (historical) add("historical_scope", FRESHNESS_RISK_WEIGHTS.historicalScope, "Claim 明确限定在历史时间或特定旧版本，不等同于当前状态陈述。");
    if (stableDefinition) add("stable_definition", FRESHNESS_RISK_WEIGHTS.stableDefinition, "属于不含当前状态、版本或数值的稳定定义。");
    if (input.lastVerifiedAt !== undefined) {
      const verifiedAgeDays = (now.getTime() - Date.parse(input.lastVerifiedAt)) / 86_400_000;
      if (verifiedAgeDays >= 0 && verifiedAgeDays <= 90) {
        add("previous_verification", FRESHNESS_RISK_WEIGHTS.recentVerification, "最近 90 天已有成功验证。");
      }
    }

    score = clamp(score);
    const freshnessRisk = toRisk(score);
    return {
      claimId: input.claim.id,
      claimFingerprint,
      freshnessRisk,
      riskScore: round(score),
      riskFactors: factors,
      explanation: factors.length === 0
        ? "未识别到明显时效信号，按 Claim 类型基础风险评估。"
        : factors.map((factor) => factor.reason).join("；"),
      lastAssessedAt: now.toISOString(),
      lastVerifiedAt: input.lastVerifiedAt,
      latestResolution: input.previousResolution,
      nextSuggestedReviewAt: suggestReview(now, freshnessRisk)
    };
  }
}

export function hasHistoricalScope(value: string): boolean {
  return /(?:(?:截至|在|于)\s*)?(?:19|20)\d{2}\s*年|\b(?:as of|in)\s+(?:19|20)\d{2}\b|(?:在\s*)?\b(?:v\d+(?:\.\d+)*)\b\s*(?:中|版本)|当时|历史上/iu.test(normalize(value));
}

function toRisk(score: number): FreshnessRisk {
  if (score >= 0.75) return "critical";
  if (score >= 0.50) return "high";
  if (score >= 0.25) return "medium";
  return "low";
}

function suggestReview(now: Date, risk: FreshnessRisk): string {
  const days = ({ critical: 14, high: 30, medium: 90, low: 365 })[risk];
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function isRiskPolicyCurrent(value: string): boolean {
  return value === FRESHNESS_RISK_POLICY_VERSION;
}
