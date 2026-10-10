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

  async count(): Promise<number> {
    const entries = await this.store.list(HISTORY_ROOT);
    return entries.filter((path) => path.endsWith(".json")).length;
  }
}
