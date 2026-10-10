import type { RetrievalScopeSnapshot } from "../types/analysis";
import type { KnowledgeCuratorSettings } from "../types/settings";

export function normalizeVaultRelativePath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.trim().replace(/\\/gu, "/").split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

export function isPathInsideFolder(filePath: string, folderPath: string): boolean {
  const normalizedFilePath = normalizeVaultRelativePath(filePath);
  const normalizedFolderPath = normalizeVaultRelativePath(folderPath);
  if (normalizedFilePath.length === 0 || normalizedFolderPath.length === 0) {
    return false;
  }
  return normalizedFilePath === normalizedFolderPath ||
    normalizedFilePath.startsWith(`${normalizedFolderPath}/`);
}

export function createRetrievalScopeSnapshot(
  settings: Pick<KnowledgeCuratorSettings, "inboxFolder" | "wikiFolder" | "rawFolders">
): RetrievalScopeSnapshot {
  return {
    inboxFolder: normalizeVaultRelativePath(settings.inboxFolder),
    wikiFolder: normalizeVaultRelativePath(settings.wikiFolder),
    rawFolders: Array.from(new Set(
      settings.rawFolders
        .map(normalizeVaultRelativePath)
        .filter((folder) => folder.length > 0)
    )).sort()
  };
}

export function isPathInKnowledgeScope(
  filePath: string,
  scope: RetrievalScopeSnapshot
): boolean {
  return isPathInsideFolder(filePath, scope.wikiFolder) ||
    scope.rawFolders.some((folder) => isPathInsideFolder(filePath, folder));
}

export function retrievalScopesEqual(
  left: RetrievalScopeSnapshot,
  right: RetrievalScopeSnapshot
): boolean {
  const normalizedLeft = createRetrievalScopeSnapshot(left);
  const normalizedRight = createRetrievalScopeSnapshot(right);
  return normalizedLeft.inboxFolder === normalizedRight.inboxFolder &&
    normalizedLeft.wikiFolder === normalizedRight.wikiFolder &&
    normalizedLeft.rawFolders.length === normalizedRight.rawFolders.length &&
    normalizedLeft.rawFolders.every(
      (folder, index) => folder === normalizedRight.rawFolders[index]
    );
}
