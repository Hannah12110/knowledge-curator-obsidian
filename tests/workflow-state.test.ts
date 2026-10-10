import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionWorkflow,
  deriveWorkflowState
} from "../src/types/workflow";

test("derives the next user-visible workflow CTA", () => {
  assert.deepEqual(deriveWorkflowState({
    hasAnalysis: false,
    conflictCount: 0,
    verifiedConflictCount: 0
  }), { state: "pending", label: "待分析", primaryAction: "analyze" });
  assert.equal(deriveWorkflowState({
    hasAnalysis: true,
    conflictCount: 1,
    verifiedConflictCount: 0
  }).state, "needs_verification");
  assert.equal(deriveWorkflowState({
    hasAnalysis: true,
    conflictCount: 1,
    verifiedConflictCount: 1
  }).state, "verified");
  assert.equal(deriveWorkflowState({
    hasAnalysis: true,
    conflictCount: 1,
    verifiedConflictCount: 1,
    prStatus: "stale"
  }).state, "pr_stale");
});

test("async and decision states take precedence over analysis state", () => {
  assert.equal(deriveWorkflowState({
    runtimeState: "verifying",
    hasAnalysis: true,
    conflictCount: 1,
    verifiedConflictCount: 0,
    prStatus: "draft"
  }).state, "verifying");
  assert.equal(deriveWorkflowState({
    hasAnalysis: true,
    conflictCount: 0,
    verifiedConflictCount: 0,
    prStatus: "accepted"
  }).state, "accepted");
});

test("state machine permits retries but blocks impossible direct transitions", () => {
  assert.equal(canTransitionWorkflow("pending", "analyzing"), true);
  assert.equal(canTransitionWorkflow("verifying", "verified"), true);
  assert.equal(canTransitionWorkflow("pr_draft", "pr_stale"), true);
  assert.equal(canTransitionWorkflow("pending", "accepted"), false);
  assert.equal(canTransitionWorkflow("verified", "accepted"), false);
});
