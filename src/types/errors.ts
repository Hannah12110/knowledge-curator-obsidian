export type CuratorErrorStage =
  | "analysis"
  | "retrieval"
  | "search"
  | "verification"
  | "pr"
  | "write"
  | "history"
  | "freshness_scan"
  | "freshness_verification"
  | "maintenance_pr";

export interface CuratorError {
  code: string;
  stage: CuratorErrorStage;
  message: string;
  retryable: boolean;
  technicalDetail?: string;
}

export function createCuratorError(
  stage: CuratorErrorStage,
  error: unknown,
  fallbackMessage: string
): CuratorError {
  const candidate = error as { code?: unknown; userMessage?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : `${stage}_failed`;
  const message = typeof candidate?.userMessage === "string"
    ? candidate.userMessage
    : fallbackMessage;
  const nonRetryableCodes = new Set([
    "missing_api_key",
    "missing_configuration",
    "unauthorized",
    "forbidden",
    "write_scope_violation",
    "production_preview_read_only"
  ]);
  return {
    code,
    stage,
    message,
    retryable: !nonRetryableCodes.has(code),
    technicalDetail: typeof candidate?.message === "string" ? candidate.message : undefined
  };
}
