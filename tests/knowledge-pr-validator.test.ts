import test from "node:test";
import assert from "node:assert/strict";
import {
  KnowledgePRValidationError,
  parseKnowledgePRProposal,
  validateKnowledgePR
} from "../src/services/knowledge-pr-validator";
import type { KnowledgePR } from "../src/types/knowledge-pr";
import type { ExternalEvidence } from "../src/types/verification";

const SOURCE_PATH = "KnowledgeCuratorPhase1Test/inbox/Agent Memory.md";
const TARGET_PATH = "KnowledgeCuratorPhase1Test/wiki/Agent Memory 设计与评测.md";
const CLAIM = "记忆写入策略需要按任务失败模式分别评测。";
const TARGET_CONTENT = "# Agent Memory\n\n旧的记忆评测说明。\n";
const SOURCE_HASH = "a".repeat(64);
const TARGET_HASH = "b".repeat(64);

function createPR(overrides: Partial<KnowledgePR> = {}): KnowledgePR {
  return {
    id: "kpr-20260925-test",
    sourcePath: SOURCE_PATH,
    target: {
      path: TARGET_PATH,
      title: "Agent Memory 设计与评测",
      operation: "update"
    },
    summary: "补充按失败模式评测记忆写入策略。",
    changes: [{
      id: "change-1",
      type: "refine",
      section: "评测",
      before: "旧的记忆评测说明。",
      after: "记忆评测应按任务失败模式区分写入策略。",
      reason: "新增了可执行的评测维度。",
      sourceClaims: [CLAIM],
      confidence: 0.82
    }],
    evidence: [{
      sourcePath: SOURCE_PATH,
      sourceTitle: "Agent Memory",
      claim: CLAIM
    }],
    rawRecommendation: "extract_only",
    confidence: 0.82,
    status: "draft",
    sourceFingerprint: { mtime: 100, hash: SOURCE_HASH },
    targetFingerprint: { mtime: 200, hash: TARGET_HASH },
    createdAt: "2026-09-25T00:00:00.000Z",
    ...overrides
  };
}

function validationContext() {
  return {
    sourcePath: SOURCE_PATH,
    targetPath: TARGET_PATH,
    targetOperation: "update" as const,
    sourceMtime: 100,
    sourceHash: SOURCE_HASH,
    targetMtime: 200,
    targetHash: TARGET_HASH,
    targetContent: TARGET_CONTENT,
    rawRecommendation: "extract_only" as const,
    allowedSourceClaims: new Set([CLAIM]),
    allowedEvidencePaths: new Set([SOURCE_PATH, TARGET_PATH]),
    expectedStatus: "draft" as const
  };
}

test("accepts a valid minimal update Knowledge PR", () => {
  const pr = createPR();
  const validated = validateKnowledgePR(pr, validationContext());
  assert.equal(validated.id, pr.id);
  assert.equal(validated.target.path, TARGET_PATH);
  assert.deepEqual(validated.changes, pr.changes);
  assert.equal(validated.evidence[0]?.sourcePath, SOURCE_PATH);
  assert.equal(validated.status, "draft");
});

test("parses a JSON proposal surrounded by non-JSON text", () => {
  const proposal = {
    summary: "最小更新",
    changes: createPR().changes,
    evidence: createPR().evidence,
    confidence: 0.8
  };
  const parsed = parseKnowledgePRProposal(`result:\n${JSON.stringify(proposal)}\nend`);
  assert.equal(parsed.summary, proposal.summary);
  assert.deepEqual(parsed.changes, proposal.changes);
  assert.equal(parsed.evidence[0]?.sourcePath, SOURCE_PATH);
  assert.equal(parsed.confidence, proposal.confidence);
});

test("rejects invalid enum, confidence, and write path", () => {
  const invalidEnum = createPR({
    changes: [{ ...createPR().changes[0]!, type: "remove" }]
  });
  assert.throws(
    () => validateKnowledgePR(invalidEnum, validationContext()),
    KnowledgePRValidationError
  );

  const invalidConfidence = createPR({ confidence: 1.1 });
  assert.throws(
    () => validateKnowledgePR(invalidConfidence, validationContext()),
    KnowledgePRValidationError
  );

  const invalidPath = createPR({
    target: {
      ...createPR().target,
      path: "03_公众号阅读/wiki/Agent Memory.md"
    }
  });
  assert.throws(
    () => validateKnowledgePR(invalidPath, {
      ...validationContext(),
      targetPath: invalidPath.target.path
    }),
    KnowledgePRValidationError
  );
});

test("rejects an update baseline that is missing or duplicated", () => {
  const missing = createPR({
    changes: [{ ...createPR().changes[0]!, before: "不存在的基线" }]
  });
  assert.throws(
    () => validateKnowledgePR(missing, validationContext()),
    /before 未在 Target Wiki 中找到/u
  );

  const duplicatedContext = {
    ...validationContext(),
    targetContent: "旧的记忆评测说明。\n旧的记忆评测说明。"
  };
  assert.throws(
    () => validateKnowledgePR(createPR(), duplicatedContext),
    /before 在 Target Wiki 中出现多次/u
  );
});

test("unverified, unresolved, and refine conflicts cannot generate replace", () => {
  const replacePR = createPR({
    changes: [{ ...createPR().changes[0]!, type: "replace" }]
  });
  for (const resolution of [undefined, "unresolved", "refine"] as const) {
    assert.throws(
      () => validateKnowledgePR(replacePR, {
        ...validationContext(),
        conflictPolicies: [{
          existingClaim: "旧知识主张",
          newClaim: CLAIM,
          resolution,
          evidenceUrls: new Set()
        }]
      }),
      /只有经过 SUPERSEDE/u
    );
  }
});

test("supersede replace requires and accepts authorized external evidence", () => {
  const external: ExternalEvidence = {
    id: "external-1",
    title: "Official Agent Memory Documentation",
    url: "https://openai.com/docs/agent-memory",
    sourceTier: 0,
    sourceType: "official",
    supports: "new",
    excerpt: "The previous definition is obsolete.",
    reasoning: "Official documentation supersedes the old definition.",
    confidence: 0.94
  };
  const policy = {
    existingClaim: "旧知识主张",
    newClaim: CLAIM,
    resolution: "supersede" as const,
    evidenceUrls: new Set([external.url])
  };
  const replacePR = createPR({
    changes: [{ ...createPR().changes[0]!, type: "replace" }]
  });
  assert.throws(
    () => validateKnowledgePR(replacePR, {
      ...validationContext(),
      conflictPolicies: [policy],
      allowedExternalEvidence: new Map([[external.url, external]])
    }),
    /必须引用对应的外部验证证据/u
  );

  replacePR.evidence.push({
    kind: "external",
    sourceTitle: external.title,
    url: external.url,
    sourceTier: external.sourceTier,
    supports: external.supports,
    conclusion: "新知识有更高质量的一手证据。",
    confidence: external.confidence,
    excerpt: external.excerpt
  });
  const validated = validateKnowledgePR(replacePR, {
    ...validationContext(),
    conflictPolicies: [policy],
    allowedExternalEvidence: new Map([[external.url, external]])
  });
  assert.equal(validated.changes[0]?.type, "replace");
  assert.equal(validated.evidence[1]?.kind, "external");
});

test("replace cannot bypass a conflict policy by omitting its claims", () => {
  const unrelatedClaim = "一个未绑定冲突的普通新增主张。";
  const replacePR = createPR({
    changes: [{
      ...createPR().changes[0]!,
      type: "replace",
      sourceClaims: [unrelatedClaim]
    }]
  });
  assert.throws(
    () => validateKnowledgePR(replacePR, {
      ...validationContext(),
      allowedSourceClaims: new Set([CLAIM, unrelatedClaim]),
      conflictPolicies: [{
        existingClaim: "旧知识主张",
        newClaim: CLAIM,
        resolution: "supersede",
        evidenceUrls: new Set(["https://openai.com/docs/agent-memory"])
      }]
    }),
    /replace 必须明确绑定/u
  );
});

test("Claim relations enforce add/refine mapping and block reinforce body growth", () => {
  const relations = [
    { candidateStatement: CLAIM, relation: "reinforce" as const }
  ];
  assert.throws(
    () => validateKnowledgePR(createPR(), {
      ...validationContext(),
      claimPolicies: relations
    }),
    /REINFORCE/u
  );

  assert.throws(
    () => validateKnowledgePR(createPR(), {
      ...validationContext(),
      claimPolicies: [{ candidateStatement: CLAIM, relation: "add" }]
    }),
    /ADD Claim/u
  );

  const refined = validateKnowledgePR(createPR(), {
    ...validationContext(),
    claimPolicies: [{ candidateStatement: CLAIM, relation: "refine" }]
  });
  assert.equal(refined.changes[0]?.type, "refine");
});
