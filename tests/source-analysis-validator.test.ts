import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSourceAnalysisResponse,
  SourceAnalysisValidationError,
  validateSourceAnalysis
} from "../src/services/source-analysis-validator";
import { VALID_ANALYSIS } from "./test-fixture";

test("accepts a complete SourceAnalysis", () => {
  assert.deepEqual(validateSourceAnalysis(VALID_ANALYSIS), VALID_ANALYSIS);
});

test("extracts the first JSON object from surrounding text", () => {
  const response = `Unexpected prefix\n${JSON.stringify(VALID_ANALYSIS)}\nUnexpected suffix`;
  assert.deepEqual(parseSourceAnalysisResponse(response), VALID_ANALYSIS);
});

test("rejects out-of-range overlap", () => {
  assert.throws(
    () => validateSourceAnalysis({ ...VALID_ANALYSIS, overlap: 1.5 }),
    SourceAnalysisValidationError
  );
});

test("rejects conflict states that resolve a conflict in Phase 2", () => {
  assert.throws(() => validateSourceAnalysis({
    ...VALID_ANALYSIS,
    conflicts: [{
      newClaim: "new",
      existingClaim: "old",
      existingFile: "wiki/a.md",
      type: "direct",
      confidence: 0.8,
      explanation: "different",
      status: "resolved"
    }]
  }), SourceAnalysisValidationError);
});

test("rejects cached Claim comparison when Coverage and Relation disagree", () => {
  assert.throws(() => validateSourceAnalysis({
    ...VALID_ANALYSIS,
    analysisMode: "claim",
    claimAnalysis: {
      candidateClaims: [{
        id: "candidate-alpha",
        statement: "Alpha",
        normalizedStatement: "alpha",
        type: "fact",
        confidence: 0.8
      }],
      comparisons: [{
        candidateClaimId: "candidate-alpha",
        candidateStatement: "Alpha",
        relation: "add",
        reasoning: "invalid persisted decision",
        confidence: 0.8,
        coverage: {
          candidateClaimId: "candidate-alpha",
          coverage: "partial",
          coreAspects: ["Alpha"],
          coveredBy: ["claim-alpha"],
          coveredAspects: ["known part"],
          uncoveredAspects: ["new part"],
          conflictingAspects: [],
          pairwise: [{
            claimId: "claim-alpha",
            relation: "candidate_broader",
            coveredAspects: ["known part"],
            conflictingAspects: [],
            reasoning: "partially covered"
          }],
          reasoning: "partially covered",
          confidence: 0.8
        }
      }],
      coverage: 0.5
    }
  }), SourceAnalysisValidationError);
});
