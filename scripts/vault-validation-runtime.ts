import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { ClaimStore, ClaimStoreStatus } from "../src/types/claim";
import type { ClaimGraphStatus, ClaimGraphStore } from "../src/types/claim-graph";
import type { ValidationScope, VaultSnapshotSource } from "../src/types/validation";
import { validateClaimStore } from "../src/services/claim-validator";
import { validateClaimGraphStore } from "../src/services/claim-graph-validator";
import {
  ValidationBaselineService,
  VaultSnapshotService
} from "../src/services/vault-validation-service";

const IGNORED_VAULT_DIRECTORIES = new Set([".obsidian", ".trash", ".knowledge-agent"]);

export interface VaultValidationResult {
  snapshot: Awaited<ReturnType<VaultSnapshotService["create"]>>;
  baseline: ReturnType<ValidationBaselineService["create"]>;
  performance: {
    snapshotMs: number;
    baselineMs: number;
  };
  safety: {
    markdownChangedDuringRun: number;
    unchanged: boolean;
  };
}

export async function runVaultValidation(
  vaultRoot: string,
  scope: ValidationScope,
  now = new Date()
): Promise<VaultValidationResult> {
  const source = new FileSystemVaultSnapshotSource(vaultRoot);
  const snapshotService = new VaultSnapshotService();
  const baselineService = new ValidationBaselineService();
  const snapshotStarted = performance.now();
  const snapshot = await snapshotService.create(source, scope, now);
  const snapshotMs = performance.now() - snapshotStarted;
  const claimStoreLoad = await loadClaimStore(vaultRoot);
  const claimGraphLoad = await loadClaimGraph(vaultRoot);
  const baselineStarted = performance.now();
  const baseline = baselineService.create({
    snapshot,
    claimStore: claimStoreLoad.store,
    claimStoreStatus: claimStoreLoad.status,
    claimGraph: claimGraphLoad.store,
    graphStatus: claimGraphLoad.status,
    now
  });
  const baselineMs = performance.now() - baselineStarted;
  const after = await snapshotService.create(source, scope, now);
  const markdownChangedDuringRun = countSnapshotChanges(snapshot.files, after.files);
  return {
    snapshot,
    baseline,
    performance: { snapshotMs, baselineMs },
    safety: {
      markdownChangedDuringRun,
      unchanged: markdownChangedDuringRun === 0 && snapshot.snapshotId === after.snapshotId
    }
  };
}

export async function runSyntheticValidationBenchmark(
  markdownCount = 1_000,
  claimCount = 10_000
) {
  const encoder = new TextEncoder();
  const contents = new Map<string, Uint8Array>();
  for (let index = 0; index < markdownCount; index += 1) {
    contents.set(`wiki/Document-${index}.md`, encoder.encode(`# Document ${index}\n\nClaim ${index}.\n`));
  }
  const source: VaultSnapshotSource = {
    listMarkdownFiles: async () => Array.from(contents, ([path, content]) => ({
      path,
      size: content.byteLength
    })),
    readBytes: async (path) => {
      const content = contents.get(path);
      if (content === undefined) throw new Error(`Synthetic file missing: ${path}`);
      return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    }
  };
  const snapshotService = new VaultSnapshotService();
  const baselineService = new ValidationBaselineService();
  const startedSnapshot = performance.now();
  const snapshot = await snapshotService.create(source, {
    inboxFolder: "inbox",
    wikiFolder: "wiki",
    rawFolders: ["raw"]
  }, new Date("2026-09-28T00:00:00.000Z"));
  const snapshotMs = performance.now() - startedSnapshot;
  const claims = Object.fromEntries(Array.from({ length: claimCount }, (_, index) => [
    `claim-${index}`,
    { id: `claim-${index}` }
  ])) as unknown as ClaimStore["claims"];
  const claimStore = {
    schemaVersion: 1,
    generatedAt: "2026-09-28T00:00:00.000Z",
    claims,
    files: {},
    failedFiles: {}
  } as ClaimStore;
  const startedBaseline = performance.now();
  const baseline = baselineService.create({
    snapshot,
    claimStore,
    claimStoreStatus: "ready",
    claimGraph: null,
    graphStatus: "not_built",
    now: new Date("2026-09-28T00:00:00.000Z")
  });
  const baselineMs = performance.now() - startedBaseline;
  return { markdownCount, claimCount, snapshotMs, baselineMs, documents: baseline.documents, claims: baseline.claims };
}

class FileSystemVaultSnapshotSource implements VaultSnapshotSource {
  constructor(private readonly vaultRoot: string) {}

  async listMarkdownFiles() {
    const files: Array<{ path: string; size: number }> = [];
    await this.walk(resolve(this.vaultRoot), files, true);
    return files;
  }

  async readBytes(path: string): Promise<ArrayBuffer> {
    const absolute = resolveWithinRoot(this.vaultRoot, path);
    const content = await readFile(absolute);
    return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
  }

  private async walk(
    directory: string,
    files: Array<{ path: string; size: number }>,
    isRoot: boolean
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (isRoot && IGNORED_VAULT_DIRECTORIES.has(entry.name)) continue;
        await this.walk(resolve(directory, entry.name), files, false);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const absolute = resolve(directory, entry.name);
      const fileStat = await stat(absolute);
      files.push({
        path: relative(resolve(this.vaultRoot), absolute).split(sep).join("/"),
        size: fileStat.size
      });
    }
  }
}

async function loadClaimStore(vaultRoot: string): Promise<{
  status: ClaimStoreStatus;
  store: ClaimStore | null;
}> {
  try {
    const raw = await readFile(resolve(vaultRoot, ".knowledge-agent/claim-store/store.json"), "utf8");
    const store = validateClaimStore(JSON.parse(raw) as unknown);
    return { status: Object.keys(store.failedFiles).length > 0 ? "partial" : "ready", store };
  } catch (error: unknown) {
    return isMissing(error)
      ? { status: "not_built", store: null }
      : { status: "corrupt", store: null };
  }
}

async function loadClaimGraph(vaultRoot: string): Promise<{
  status: ClaimGraphStatus;
  store: ClaimGraphStore | null;
}> {
  try {
    const raw = await readFile(resolve(vaultRoot, ".knowledge-agent/claim-graph/store.json"), "utf8");
    const store = validateClaimGraphStore(JSON.parse(raw) as unknown);
    return { status: store.metadata.failedPairs.length > 0 ? "partial" : "ready", store };
  } catch (error: unknown) {
    return isMissing(error)
      ? { status: "not_built", store: null }
      : { status: "corrupt", store: null };
  }
}

function countSnapshotChanges(
  before: Array<{ path: string; hash: string; size: number }>,
  after: Array<{ path: string; hash: string; size: number }>
): number {
  const afterByPath = new Map(after.map((file) => [file.path, `${file.hash}:${file.size}`]));
  let changes = 0;
  for (const file of before) {
    if (afterByPath.get(file.path) !== `${file.hash}:${file.size}`) changes += 1;
    afterByPath.delete(file.path);
  }
  return changes + afterByPath.size;
}

function resolveWithinRoot(root: string, relativePath: string): string {
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, relativePath);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`Validation path escaped Vault root: ${relativePath}`);
  }
  return target;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
