import {
  MetadataCache,
  normalizePath,
  TFile,
  TFolder,
  Vault
} from "obsidian";
import type { MarkdownFileInfo } from "../types/file-info";
import type { InboxItem, InboxScanResult } from "../types/knowledge";
import type { KnowledgeCuratorSettings } from "../types/settings";
import type { RetrievalScopeSnapshot } from "../types/analysis";
import {
  createRetrievalScopeSnapshot,
  isPathInKnowledgeScope,
  isPathInsideFolder
} from "./path-scope";

export class VaultService {
  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
    private readonly getSettings: () => KnowledgeCuratorSettings
  ) {}

  getMarkdownFiles(): TFile[] {
    return this.vault.getMarkdownFiles();
  }

  async scanInbox(): Promise<InboxScanResult> {
    const configuredPath = this.normalizeFolderPath(
      this.getSettings().inboxFolder
    );
    const folder = this.getFolder(configuredPath);

    if (folder === null) {
      return {
        state: "missing",
        configuredPath
      };
    }

    const files = await this.listMarkdownFiles(configuredPath);
    const items: InboxItem[] = [];

    for (const file of files) {
      let status: InboxItem["status"] = "pending";

      try {
        await this.readMarkdown(file);
      } catch (error: unknown) {
        status = "failed";
        console.error(`Knowledge Curator could not read ${file.path}.`, error);
      }

      items.push({
        path: file.path,
        name: file.name,
        basename: file.basename,
        status,
        size: file.stat.size,
        modified: file.stat.mtime,
        frontmatter: this.getFrontmatter(file)
      });
    }

    items.sort((left, right) => right.modified - left.modified);

    return {
      state: "ready",
      configuredPath,
      items
    };
  }

  async listMarkdownFiles(folderPath: string): Promise<TFile[]> {
    const normalizedFolderPath = this.normalizeFolderPath(folderPath);
    const folder = this.getFolder(normalizedFolderPath);
    if (folder === null) {
      return [];
    }

    const files: TFile[] = [];
    this.collectMarkdownFiles(folder, files);
    return files.filter((file) =>
      isPathInsideFolder(file.path, normalizedFolderPath)
    );
  }

  async listWikiFiles(): Promise<TFile[]> {
    return this.listMarkdownFiles(this.getSettings().wikiFolder);
  }

  async listRawFiles(): Promise<TFile[]> {
    const filesByPath = new Map<string, TFile>();
    for (const folderPath of this.getSettings().rawFolders) {
      const files = await this.listMarkdownFiles(folderPath);
      for (const file of files) {
        filesByPath.set(file.path, file);
      }
    }
    return Array.from(filesByPath.values());
  }

  getConfiguredRetrievalScope(): RetrievalScopeSnapshot {
    return createRetrievalScopeSnapshot(this.getSettings());
  }

  isInInboxScope(path: string): boolean {
    const scope = this.getConfiguredRetrievalScope();
    return isPathInsideFolder(path, scope.inboxFolder);
  }

  isInWikiScope(path: string): boolean {
    const scope = this.getConfiguredRetrievalScope();
    return isPathInsideFolder(path, scope.wikiFolder);
  }

  isInRawScope(path: string): boolean {
    const scope = this.getConfiguredRetrievalScope();
    return scope.rawFolders.some((folder) => isPathInsideFolder(path, folder));
  }

  isInKnowledgeScope(path: string): boolean {
    return isPathInKnowledgeScope(path, this.getConfiguredRetrievalScope());
  }

  async readMarkdown(file: TFile): Promise<string> {
    if (file.extension.toLowerCase() !== "md") {
      throw new Error(`Not a Markdown file: ${file.path}`);
    }

    return this.vault.cachedRead(file);
  }

  async getMarkdownMetadata(file: TFile): Promise<MarkdownFileInfo> {
    const content = await this.readMarkdown(file);
    const trimmedContent = content.trim();

    return {
      basename: file.basename,
      path: file.path,
      sizeInBytes: file.stat.size,
      modifiedAt: file.stat.mtime,
      lineCount: content.length === 0 ? 0 : content.split(/\r?\n/u).length,
      wordCount: trimmedContent.length === 0
        ? 0
        : trimmedContent.split(/\s+/u).length
    };
  }

  async readMarkdownFileInfo(file: TFile): Promise<MarkdownFileInfo> {
    return this.getMarkdownMetadata(file);
  }

  getMarkdownFile(path: string): TFile | null {
    const abstractFile = this.vault.getAbstractFileByPath(normalizePath(path));
    if (!(abstractFile instanceof TFile)) {
      return null;
    }
    if (abstractFile.extension.toLowerCase() !== "md") {
      return null;
    }

    return abstractFile;
  }

  getDisplayTitle(file: TFile): string {
    const title = this.getFrontmatter(file)?.title;
    return typeof title === "string" && title.trim().length > 0
      ? title.trim()
      : file.basename;
  }

  getSupportedFrontmatter(file: TFile): Record<string, unknown> | undefined {
    return this.getFrontmatter(file);
  }

  private normalizeFolderPath(folderPath: string): string {
    const trimmedPath = folderPath.trim().replace(/^\/+|\/+$/gu, "");
    return trimmedPath.length === 0 ? "" : normalizePath(trimmedPath);
  }

  private getFolder(folderPath: string): TFolder | null {
    if (folderPath.length === 0) {
      return null;
    }

    const abstractFile = this.vault.getAbstractFileByPath(folderPath);
    return abstractFile instanceof TFolder ? abstractFile : null;
  }

  private collectMarkdownFiles(folder: TFolder, output: TFile[]): void {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, output);
      } else if (
        child instanceof TFile &&
        child.extension.toLowerCase() === "md"
      ) {
        output.push(child);
      }
    }
  }

  private getFrontmatter(file: TFile): Record<string, unknown> | undefined {
    try {
      const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter === undefined || frontmatter === null) {
        return undefined;
      }

      const supportedFrontmatter: Record<string, unknown> = {};
      for (const key of ["title", "author", "source", "tags"] as const) {
        if (frontmatter[key] !== undefined) {
          supportedFrontmatter[key] = frontmatter[key];
        }
      }

      return Object.keys(supportedFrontmatter).length > 0
        ? supportedFrontmatter
        : undefined;
    } catch (error: unknown) {
      console.warn(
        `Knowledge Curator could not parse frontmatter for ${file.path}.`,
        error
      );
      return undefined;
    }
  }
}
