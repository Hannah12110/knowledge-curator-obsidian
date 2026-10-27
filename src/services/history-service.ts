import type { KnowledgePRHistoryRecord } from "../types/knowledge-pr";
import type { KnowledgeFileStore } from "./knowledge-file-store";

const HISTORY_ROOT = ".knowledge-agent/history";

export class HistoryService {
  constructor(private readonly store: KnowledgeFileStore) {}

  async write(record: KnowledgePRHistoryRecord): Promise<string> {
    const timestamp = record.decidedAt.replace(/[^0-9]/gu, "").slice(0, 17);
    const safeId = record.prId.replace(/[^A-Za-z0-9_-]/gu, "-");
    const path = `${HISTORY_ROOT}/${timestamp}-${safeId}.json`;
    await this.store.createJson(path, `${JSON.stringify(record, null, 2)}\n`);
    return path;
  }

  async listRecords(): Promise<{ records: KnowledgePRHistoryRecord[]; unreadable: number }> {
    const records: KnowledgePRHistoryRecord[] = []; let unreadable = 0;
    for (const path of (await this.store.list(HISTORY_ROOT)).filter((entry) => entry.startsWith(`${HISTORY_ROOT}/`) && entry.endsWith(".json") && !entry.split("/").includes(".."))) {
      try {
        const value = this.store.readJson !== undefined ? await this.store.readJson(path) : JSON.parse((await this.store.read(path))?.content ?? "null") as unknown;
        const record = value as KnowledgePRHistoryRecord;
        if (record === null || typeof record !== "object" || typeof record.prId !== "string" || typeof record.sourcePath !== "string" || typeof record.targetPath !== "string" ||
          !Number.isFinite(Date.parse(record.decidedAt)) || !["accepted", "rejected"].includes(record.decision) || !Array.isArray(record.changes) ||
          record.changes.some((change) => typeof change.after !== "string" || typeof change.reason !== "string" || (change.before !== undefined && typeof change.before !== "string") || !Array.isArray(change.sourceClaims) || !change.sourceClaims.every((source) => typeof source === "string"))) throw new Error("Invalid history record");
        // Older history may not contain relations. Invalid optional data does not hide a valid write record.
        if (record.claimRelations !== undefined && (!Array.isArray(record.claimRelations) || record.claimRelations.some((relation) => relation === null || typeof relation !== "object"))) record.claimRelations = undefined;
        records.push(record);
      } catch { unreadable++; }
    }
    return { records: records.sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt)), unreadable };
  }

  async count(): Promise<number> {
    const entries = await this.store.list(HISTORY_ROOT);
    return entries.filter((path) => path.endsWith(".json")).length;
  }
}
