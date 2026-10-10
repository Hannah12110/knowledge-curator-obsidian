import type { RawRecommendation } from "./source-analysis";
import type { EvidenceSupport, SourceTier } from "./verification";
import type { ClaimComparison } from "./claim";
import type { FreshnessResolution } from "./maintenance";

export type KnowledgePROperation = "create" | "update";
export type KnowledgePRStatus = "draft" | "accepted" | "rejected" | "stale";
export type KnowledgeChangeType = "add" | "refine" | "replace" | "remove";

export interface KnowledgeChange {
  id: string;
  type: KnowledgeChangeType;
  section?: string;
  before?: string;
  after: string;
  reason: string;
  sourceClaims: string[];
  confidence: number;
}

export interface InternalEvidenceRef {
  kind?: "internal";
  sourcePath: string;
  sourceTitle: string;
  claim?: string;
  excerpt?: string;
}

export interface ExternalEvidenceRef {
  kind: "external";
  sourceTitle: string;
  url: string;
  sourceTier: SourceTier;
  supports: EvidenceSupport;
  conclusion: string;
  confidence: number;
  excerpt?: string;
}

export type EvidenceRef = InternalEvidenceRef | ExternalEvidenceRef;

export interface FileFingerprint {
  mtime: number;
  hash: string;
}

export interface KnowledgePR {
  id: string;
  sourcePath: string;
  target: {
    path: string;
    title: string;
    operation: KnowledgePROperation;
  };
  summary: string;
  changes: KnowledgeChange[];
  evidence: EvidenceRef[];
  rawRecommendation: RawRecommendation;
  confidence: number;
  status: KnowledgePRStatus;
  sourceFingerprint: FileFingerprint;
  targetFingerprint?: FileFingerprint;
  createdAt: string;
  claimRelations?: ClaimComparison[];
  origin?: "source_ingestion" | "maintenance";
  maintenanceContext?: {
    claimId: string;
    claimFingerprint: string;
    freshnessResolution: FreshnessResolution;
    verificationId: string;
  };
}

export interface KnowledgePRCache {
  [sourcePath: string]: KnowledgePR;
}

export interface KnowledgePRHistoryRecord {
  prId: string;
  sourcePath: string;
  targetPath: string;
  decision: "accepted" | "rejected";
  operation: KnowledgePROperation;
  beforeHash?: string;
  afterHash?: string;
  changes: KnowledgeChange[];
  createdAt: string;
  decidedAt: string;
  claimRelations?: ClaimComparison[];
  origin?: "source_ingestion" | "maintenance";
  claimId?: string;
  verificationId?: string;
  freshnessResolution?: FreshnessResolution;
}

export interface KnowledgePRProposal {
  summary: string;
  changes: KnowledgeChange[];
  evidence: EvidenceRef[];
  confidence: number;
}
