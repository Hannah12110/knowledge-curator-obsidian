import { normalizePath, TFile, TFolder, Vault } from "obsidian";

export interface KnowledgeFileSnapshot {
  path: string;
  content: string;
  mtime: number;
}

export interface KnowledgeFileStore {
  read(path: string): Promise<KnowledgeFileSnapshot | null>;
  create(path: string, content: string): Promise<KnowledgeFileSnapshot>;
  modify(path: string, content: string): Promise<KnowledgeFileSnapshot>;
  delete(path: string): Promise<void>;
  createJson(path: string, content: string): Promise<void>;
  list(path: string): Promise<string[]>;
}

export class ObsidianKnowledgeFileStore implements KnowledgeFileStore {
  constructor(private readonly vault: Vault) {}

  async read(path: string): Promise<KnowledgeFileSnapshot | null> {
    const normalizedPath = normalizePath(path);
    const file = this.vault.getAbstractFileByPath(normalizedPath);
    if (!(file instanceof TFile)) {
      return null;
    }
    return {
      path: file.path,
      content: await this.vault.cachedRead(file),
      mtime: file.stat.mtime
    };
  }

  async create(path: string, content: string): Promise<KnowledgeFileSnapshot> {
    const normalizedPath = normalizePath(path);
    await this.ensureParentFolder(normalizedPath);
    if (this.vault.getAbstractFileByPath(normalizedPath) !== null) {
      throw new Error(`File already exists: ${normalizedPath}`);
    }
    const file = await this.vault.create(normalizedPath, content);
    return {
      path: file.path,
      content: await this.vault.cachedRead(file),
      mtime: file.stat.mtime
    };
  }

  async modify(path: string, content: string): Promise<KnowledgeFileSnapshot> {
    const normalizedPath = normalizePath(path);
    const file = this.vault.getAbstractFileByPath(normalizedPath);
    if (!(file instanceof TFile)) {
      throw new Error(`File does not exist: ${normalizedPath}`);
    }
    await this.vault.modify(file, content);
    const refreshed = this.vault.getAbstractFileByPath(normalizedPath);
    if (!(refreshed instanceof TFile)) {
      throw new Error(`File disappeared after write: ${normalizedPath}`);
    }
    return {
      path: refreshed.path,
      content: await this.vault.cachedRead(refreshed),
      mtime: refreshed.stat.mtime
    };
  }

  async delete(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    const file = this.vault.getAbstractFileByPath(normalizedPath);
    if (!(file instanceof TFile)) {
      throw new Error(`File does not exist: ${normalizedPath}`);
    }
    await this.vault.delete(file, true);
  }

  async createJson(path: string, content: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    await this.ensureAdapterParentFolder(normalizedPath);
    if (await this.vault.adapter.exists(normalizedPath)) {
      throw new Error(`History file already exists: ${normalizedPath}`);
    }
    await this.vault.adapter.write(normalizedPath, content);
  }

  async list(path: string): Promise<string[]> {
    const normalizedPath = normalizePath(path);
    if (!await this.vault.adapter.exists(normalizedPath)) {
      return [];
    }
    const listing = await this.vault.adapter.list(normalizedPath);
    return [...listing.files, ...listing.folders];
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const parts = filePath.split("/").slice(0, -1);
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath.length === 0 ? part : `${currentPath}/${part}`;
      const existing = this.vault.getAbstractFileByPath(currentPath);
      if (existing instanceof TFolder) {
        continue;
      }
      if (existing !== null) {
        throw new Error(`Expected folder but found file: ${currentPath}`);
      }
      await this.vault.createFolder(currentPath);
    }
  }

  private async ensureAdapterParentFolder(filePath: string): Promise<void> {
    const parts = filePath.split("/").slice(0, -1);
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath.length === 0 ? part : `${currentPath}/${part}`;
      if (await this.vault.adapter.exists(currentPath)) {
        continue;
      }
      await this.vault.adapter.mkdir(currentPath);
    }
  }
}
