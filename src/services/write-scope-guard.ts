import { normalizeVaultRelativePath } from "./path-scope";

export const PHASE3_WRITABLE_WIKI_ROOT = "KnowledgeCuratorPhase1Test/wiki";

export function isInsideWritableWikiScope(path: string): boolean {
  const rawPath = path.trim();
  if (
    rawPath.length === 0 ||
    rawPath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(rawPath) ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(rawPath) ||
    rawPath.includes("\0") ||
    rawPath.replace(/\\/gu, "/").split("/").includes("..")
  ) {
    return false;
  }
  const normalizedPath = normalizeVaultRelativePath(rawPath);
  return normalizedPath.endsWith(".md") &&
    normalizedPath.startsWith(`${PHASE3_WRITABLE_WIKI_ROOT}/`);
}

export function sanitizeWikiFilename(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\.md$/iu, "")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/gu, " ")
    .replace(/\.{2,}/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^\.+|\.+$/gu, "")
    .trim()
    .slice(0, 100)
    .trim();
}

export function buildWritableWikiPath(title: string): string {
  const filename = sanitizeWikiFilename(title);
  if (filename.length === 0) {
    throw new Error("无法根据当前主题生成安全的 Wiki 文件名。");
  }
  const path = `${PHASE3_WRITABLE_WIKI_ROOT}/${filename}.md`;
  if (!isInsideWritableWikiScope(path)) {
    throw new Error("生成的 Wiki 路径不在允许的写入范围内。");
  }
  return path;
}
