import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgePR, KnowledgePRProposal } from "../src/types/knowledge-pr";
import type { FreshnessVerificationResult } from "../src/types/maintenance";
import { validateMaintenancePR, validateMaintenanceProposal } from "../src/services/maintenance-pr-validator";

const targetPath = "KnowledgeCuratorPhase1Test/wiki/phase6-current-capability.md";
const targetContent = "# Product X\n\nProduct X 当前只支持 Feature A。\n";

for (const [resolution, changeType] of [["needs_refinement", "refine"], ["stale", "replace"]] as const) {
  test(`${resolution} maps only to ${changeType} Maintenance PR`, () => {
    const verification = makeVerification(resolution);
    const proposal = makeProposal(changeType);
    assert.doesNotThrow(() => validateMaintenanceProposal(proposal, context(verification)));
    const wrong = makeProposal(changeType === "replace" ? "refine" : "replace");
    assert.throws(() => validateMaintenanceProposal(wrong, context(verification)));
  });
}

for (const resolution of ["still_valid", "disputed", "insufficient_evidence"] as const) {
  test(`${resolution} has no authorized body PR`, () => {
    const verification = makeVerification(resolution);
    assert.throws(() => validateMaintenanceProposal(makeProposal("replace"), context(verification)));
  });
}

test("Maintenance PR validates fingerprints, allowlist evidence, and test scope", () => {
  const verification = makeVerification("stale");
  const proposal = makeProposal("replace");
  const pr: KnowledgePR = {
    id: "mpr-test", sourcePath: targetPath,
    target: { path: targetPath, title: "phase6-current-capability", operation: "update" },
    ...proposal, rawRecommendation: "extract_only", status: "draft",
    sourceFingerprint: { mtime: 1, hash: "a".repeat(64) },
    targetFingerprint: { mtime: 1, hash: "a".repeat(64) },
    createdAt: "2026-09-27T00:00:00.000Z", origin: "maintenance",
    maintenanceContext: { claimId: "claim-x", claimFingerprint: "b".repeat(64), freshnessResolution: "stale", verificationId: "fresh-x" }
  };
  assert.doesNotThrow(() => validateMaintenancePR(pr, context(verification)));
  assert.throws(() => validateMaintenancePR({ ...pr, target: { ...pr.target, path: "03_公众号阅读/wiki/real.md" } }, context(verification)));
});

function makeVerification(resolution: FreshnessVerificationResult["resolution"]): FreshnessVerificationResult {
  return {
    id: "fresh-x", claimId: "claim-x", claimFingerprint: "b".repeat(64),
    originalStatement: "Product X 当前只支持 Feature A。", resolution,
    conclusion: "Current docs changed.", reasoning: "Official docs.", confidence: 0.9,
    verifiedAt: "2026-09-27T00:00:00.000Z",
    evidence: [{ id: "e1", title: "Official Docs", url: "https://example.com/docs", sourceTier: 0, sourceType: "official", supports: "neither", reasoning: "direct", confidence: 0.9 }]
  };
}

function makeProposal(type: "refine" | "replace"): KnowledgePRProposal {
  return {
    summary: "minimal maintenance", confidence: 0.9,
    changes: [{ id: "c1", type, before: "Product X 当前只支持 Feature A。", after: "Product X 当前支持 Feature A 和 Feature B。", reason: "Official docs changed.", sourceClaims: ["Product X 当前只支持 Feature A。"], confidence: 0.9 }],
    evidence: [{ kind: "external", sourceTitle: "Official Docs", url: "https://example.com/docs", sourceTier: 0, supports: "neither", conclusion: "Current docs changed.", confidence: 0.9 }]
  };
}

function context(verification: FreshnessVerificationResult) {
  return { claimId: "claim-x", claimFingerprint: "b".repeat(64), targetPath, targetMtime: 1, targetHash: "a".repeat(64), targetContent, verification, expectedStatus: "draft" as const };
}

