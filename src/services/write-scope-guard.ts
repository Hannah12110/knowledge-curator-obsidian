import { normalizeVaultRelativePath } from "./path-scope";

export const PHASE3_WRITABLE_WIKI_ROOT = "KnowledgeCuratorPhase1Test/wiki";

export function isInsideWritableWikiScope(path: string, root = PHASE3_WRITABLE_WIKI_ROOT): boolean {
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
    isSafeVaultFolder(root) && isSafeVaultFolder(rawPath) &&
    normalizedPath.startsWith(`${normalizeVaultRelativePath(root)}/`);
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

export function buildWritableWikiPath(title: string, root = PHASE3_WRITABLE_WIKI_ROOT): string {
  const filename = sanitizeWikiFilename(title);
  if (filename.length === 0) {
    throw new Error("无法根据当前主题生成安全的 Wiki 文件名。");
  }
  const path = `${root}/${filename}.md`;
  if (!isInsideWritableWikiScope(path, root)) {
    throw new Error("生成的 Wiki 路径不在允许的写入范围内。");
  }
  return path;
}


export function isSafeVaultFolder(value: string): boolean {
  const path = value.trim().replace(/\\/gu, "/");
  return path.length > 0 && !path.startsWith("/") && !path.endsWith("/") &&
    !/[:\u0000-\u001f]/u.test(path) &&
    path.split("/").every((part) => part.length > 0 && !part.startsWith("."));
}

export function configuredWritableWikiRoot(settings: {
  wikiFolder: string; inboxFolder: string; rawFolders: string[];
}): string {
  const root = settings.wikiFolder.trim();
  const sources = [settings.inboxFolder, ...settings.rawFolders];
  if (!isSafeVaultFolder(root) || sources.some((folder) => !isSafeVaultFolder(folder))) {
    throw Object.assign(new Error("Invalid knowledge folder configuration."), {
      code: "write_scope_violation", userMessage: "请将资料和 Wiki 配置为库内的普通文件夹，不能使用根目录、隐藏目录或上级路径。"
    });
  }
  const normalized = normalizeVaultRelativePath(root);
  if (sources.some((folder) => {
    const source = normalizeVaultRelativePath(folder);
    return normalized === source || normalized.startsWith(`${source}/`) || source.startsWith(`${normalized}/`);
  })) {
    throw Object.assign(new Error("Wiki and source folders overlap."), {
      code: "write_scope_violation", userMessage: "Wiki 目录不能与待处理或原始资料目录重叠，请分别配置。"
    });
  }
  return normalized;
}
