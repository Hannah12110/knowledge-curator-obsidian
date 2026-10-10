import type { ClaimGraphRelation, ClaimGraphStatus } from "./claim-graph";
import type { ClaimStoreStatus } from "./claim";

export const VALIDATION_VERSION = "phase7.5-v1";

export interface VaultSnapshotFile {
  path: string;
  hash: string;
  size: number;
}

export interface VaultSnapshot {
  version: typeof VALIDATION_VERSION;
  snapshotId: string;
  createdAt: string;
  markdownCount: number;
  wikiCount: number;
  rawCount: number;
  inboxCount: number;
  files: VaultSnapshotFile[];
}

export interface ValidationBaseline {
  version: typeof VALIDATION_VERSION;
  generatedAt: string;
  vaultSnapshotId: string;
  documents: number;
  claims: number;
  graphNodes: number;
  graphEdges: number;
  relations: Record<ClaimGraphRelation, number>;
  duplicateEdges: number;
  conflictEdges: number;
  claimStoreStatus: ClaimStoreStatus;
  graphStatus: ClaimGraphStatus;
}

export interface VaultSnapshotSourceFile {
  path: string;
  size: number;
}

/** Read-only by construction: validation code receives no write method. */
export interface VaultSnapshotSource {
  listMarkdownFiles(): Promise<VaultSnapshotSourceFile[]>;
  readBytes(path: string): Promise<ArrayBuffer>;
}

export interface ValidationScope {
  inboxFolder: string;
  wikiFolder: string;
  rawFolders: string[];
}
