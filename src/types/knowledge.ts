import type { SourceAnalysis } from "./source-analysis";
import type { WorkflowState } from "./workflow";

export type InboxItemStatus =
  | "pending"
  | "analyzing"
  | "analyzed"
  | "failed";

export interface InboxItem {
  path: string;
  name: string;
  basename: string;
  status: InboxItemStatus;
  size: number;
  modified: number;
  frontmatter?: Record<string, unknown>;
  analysis?: SourceAnalysis;
  analysisError?: string;
  workflowState?: WorkflowState;
}

export type InboxScanResult =
  | {
      state: "ready";
      configuredPath: string;
      items: InboxItem[];
    }
  | {
      state: "missing";
      configuredPath: string;
    };
