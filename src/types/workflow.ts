import type { KnowledgePRStatus } from "./knowledge-pr";

export type WorkflowState =
  | "pending"
  | "analyzing"
  | "analyzed"
  | "needs_verification"
  | "verifying"
  | "verified"
  | "pr_draft"
  | "pr_stale"
  | "accepted"
  | "rejected"
  | "failed";

export type WorkflowPrimaryAction =
  | "analyze"
  | "view_analysis"
  | "verify"
  | "generate_pr"
  | "view_pr"
  | "regenerate_pr"
  | "retry";

export interface WorkflowStateInput {
  runtimeState?: "analyzing" | "verifying" | "failed";
  hasAnalysis: boolean;
  conflictCount: number;
  verifiedConflictCount: number;
  prStatus?: KnowledgePRStatus;
}

export interface WorkflowDescriptor {
  state: WorkflowState;
  label: string;
  primaryAction: WorkflowPrimaryAction;
}

const DESCRIPTORS: Record<WorkflowState, WorkflowDescriptor> = {
  pending: { state: "pending", label: "待分析", primaryAction: "analyze" },
  analyzing: { state: "analyzing", label: "分析中", primaryAction: "view_analysis" },
  analyzed: { state: "analyzed", label: "已分析", primaryAction: "generate_pr" },
  needs_verification: { state: "needs_verification", label: "有冲突待验证", primaryAction: "verify" },
  verifying: { state: "verifying", label: "验证中", primaryAction: "view_analysis" },
  verified: { state: "verified", label: "冲突已验证", primaryAction: "generate_pr" },
  pr_draft: { state: "pr_draft", label: "待审核知识更新", primaryAction: "view_pr" },
  pr_stale: { state: "pr_stale", label: "知识更新建议已失效", primaryAction: "regenerate_pr" },
  accepted: { state: "accepted", label: "已接受", primaryAction: "view_analysis" },
  rejected: { state: "rejected", label: "已拒绝", primaryAction: "view_analysis" },
  failed: { state: "failed", label: "处理失败", primaryAction: "retry" }
};

export function deriveWorkflowState(input: WorkflowStateInput): WorkflowDescriptor {
  if (input.runtimeState !== undefined) {
    return DESCRIPTORS[input.runtimeState];
  }
  if (input.prStatus === "draft") {
    return DESCRIPTORS.pr_draft;
  }
  if (input.prStatus === "stale") {
    return DESCRIPTORS.pr_stale;
  }
  if (input.prStatus === "accepted") {
    return DESCRIPTORS.accepted;
  }
  if (input.prStatus === "rejected") {
    return DESCRIPTORS.rejected;
  }
  if (!input.hasAnalysis) {
    return DESCRIPTORS.pending;
  }
  if (input.conflictCount > 0) {
    return input.verifiedConflictCount >= input.conflictCount
      ? DESCRIPTORS.verified
      : DESCRIPTORS.needs_verification;
  }
  return DESCRIPTORS.analyzed;
}

export const ALLOWED_WORKFLOW_TRANSITIONS: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  pending: ["analyzing"],
  analyzing: ["analyzed", "needs_verification", "failed"],
  analyzed: ["analyzing", "pr_draft", "failed"],
  needs_verification: ["analyzing", "verifying", "pr_draft", "failed"],
  verifying: ["verified", "needs_verification", "failed"],
  verified: ["analyzing", "verifying", "pr_draft", "failed"],
  pr_draft: ["analyzing", "verifying", "pr_stale", "accepted", "rejected", "failed"],
  pr_stale: ["analyzing", "verifying", "pr_draft", "failed"],
  accepted: ["analyzing"],
  rejected: ["analyzing", "pr_draft"],
  failed: ["analyzing", "verifying", "pr_draft", "pending"]
};

export function canTransitionWorkflow(from: WorkflowState, to: WorkflowState): boolean {
  return ALLOWED_WORKFLOW_TRANSITIONS[from].includes(to);
}
