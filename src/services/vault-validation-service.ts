import type { ClaimStore, ClaimStoreStatus } from "../types/claim";
import type {
  ClaimGraphRelation,
  ClaimGraphStatus,
  ClaimGraphStore
} from "../types/claim-graph";
import {
  VALIDATION_VERSION
} from "../types/validation";
import type {
  ValidationBaseline,
  ValidationScope,
  VaultSnapshot,
  VaultSnapshotFile,
  VaultSnapshotSource,
  VaultSnapshotSourceFile
} from "../types/validation";
import { sha256Bytes, sha256Text } from "./content-hash";
import {
  createRetrievalScopeSnapshot,
  isPathInsideFolder,
  normalizeVaultRelativePath
} from "./path-scope";

const SNAPSHOT_READ_CONCURRENCY = 8;
const GRAPH_RELATIONS: ClaimGraphRelation[] = [
  "duplicate", "supports", "refines", "contradicts", "depends_on"
];

export class VaultSnapshotService {
  async create(
    source: VaultSnapshotSource,
    scope: ValidationScope,
    now = new Date()
  ): Promise<VaultSnapshot> {
    const normalizedScope = createRetrievalScopeSnapshot(scope);
    const descriptors = normalizeDescriptors(await source.listMarkdownFiles());
    const files = await mapWithConcurrency(
      descriptors,
      SNAPSHOT_READ_CONCURRENCY,
      async (file): Promise<VaultSnapshotFile> => ({
        path: file.path,
        hash: await sha256Bytes(await source.readBytes(file.path)),
        size: file.size
      })
    );
    files.sort((left, right) => left.path.localeCompare(right.path));
    const snapshotId = await sha256Text(JSON.stringify(files));
    return {
      version: VALIDATION_VERSION,
      snapshotId,
      createdAt: now.toISOString(),
      markdownCount: files.length,
      wikiCount: files.filter((file) => isPathInsideFolder(file.path, normalizedScope.wikiFolder)).length,
      rawCount: files.filter((file) => normalizedScope.rawFolders.some(
        (folder) => isPathInsideFolder(file.path, folder)
      )).length,
      inboxCount: files.filter((file) => isPathInsideFolder(file.path, normalizedScope.inboxFolder)).length,
      files
    };
  }
}

export class ValidationBaselineService {
  create(input: {
    snapshot: VaultSnapshot;
    claimStore: ClaimStore | null;
    claimStoreStatus: ClaimStoreStatus;
    claimGraph: ClaimGraphStore | null;
    graphStatus: ClaimGraphStatus;
    now?: Date;
  }): ValidationBaseline {
    const relations = Object.fromEntries(
      GRAPH_RELATIONS.map((relation) => [relation, 0])
    ) as Record<ClaimGraphRelation, number>;
    const edges = input.claimGraph === null ? [] : Object.values(input.claimGraph.edges);
    for (const edge of edges) relations[edge.relation] += 1;
    return {
      version: VALIDATION_VERSION,
      generatedAt: (input.now ?? new Date()).toISOString(),
      vaultSnapshotId: input.snapshot.snapshotId,
      documents: input.snapshot.markdownCount,
      claims: input.claimStore === null ? 0 : Object.keys(input.claimStore.claims).length,
      graphNodes: input.claimGraph === null ? 0 : Object.keys(input.claimGraph.nodes).length,
      graphEdges: edges.length,
      relations,
      duplicateEdges: relations.duplicate,
      conflictEdges: relations.contradicts,
      claimStoreStatus: input.claimStoreStatus,
      graphStatus: input.graphStatus
    };
  }
}

function normalizeDescriptors(files: VaultSnapshotSourceFile[]): VaultSnapshotSourceFile[] {
  const seen = new Set<string>();
  const normalized: VaultSnapshotSourceFile[] = [];
  for (const file of files) {
    const path = normalizeVaultRelativePath(file.path);
    if (!path.toLowerCase().endsWith(".md") || seen.has(path)) continue;
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`Invalid Markdown file size: ${path}`);
    }
    seen.add(path);
    normalized.push({ path, size: file.size });
  }
  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const run = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => run())
  );
  return results;
}
