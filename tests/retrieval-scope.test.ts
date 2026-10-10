import test from "node:test";
import assert from "node:assert/strict";
import type { TFile } from "obsidian";
import { RetrievalService } from "../src/services/retrieval-service";
import type { VaultService } from "../src/services/vault-service";
import type { KnowledgeCuratorSettings } from "../src/types/settings";

const SETTINGS: KnowledgeCuratorSettings = {
  inboxFolder: "KnowledgeCuratorPhase1Test/inbox",
  wikiFolder: "KnowledgeCuratorPhase1Test/wiki",
  rawFolders: [
    "KnowledgeCuratorPhase1Test/raw-技术",
    "KnowledgeCuratorPhase1Test/raw-产品"
  ],
  llmBaseUrl: "",
  llmApiKey: "",
  llmModel: "",
  maxRelatedNotes: 8
};

function file(path: string): TFile {
  const name = path.split("/").at(-1) ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.md$/u, ""),
    extension: "md"
  } as TFile;
}

function createRetrievalService(
  wikiPaths: string[],
  rawPaths: string[]
): RetrievalService {
  const contents = new Map<string, string>();
  const wikiFiles = wikiPaths.map((path) => {
    contents.set(path, "# Test\nAgent Memory benchmark harness");
    return file(path);
  });
  const rawFiles = rawPaths.map((path) => {
    contents.set(path, "# Test\nAgent Memory benchmark harness");
    return file(path);
  });
  const vaultService = {
    readMarkdown: async (candidate: TFile) => contents.get(candidate.path) ?? "# Source\nAgent Memory benchmark harness",
    getDisplayTitle: (candidate: TFile) => candidate.basename,
    getSupportedFrontmatter: () => undefined,
    listWikiFiles: async () => wikiFiles,
    listRawFiles: async () => rawFiles
  } as unknown as VaultService;
  return new RetrievalService(vaultService, () => SETTINGS);
}

test("Retrieval final guard excludes a same-name Wiki outside Settings", async () => {
  const service = createRetrievalService([
    "KnowledgeCuratorPhase1Test/wiki/Test.md",
    "03_公众号阅读/wiki/Test.md"
  ], []);
  const candidates = await service.findRelatedNotes(
    file("KnowledgeCuratorPhase1Test/inbox/Source.md")
  );

  assert.deepEqual(
    candidates.map((candidate) => candidate.path),
    ["KnowledgeCuratorPhase1Test/wiki/Test.md"]
  );
});

test("Retrieval final guard excludes a same-name Raw outside Settings", async () => {
  const service = createRetrievalService([], [
    "KnowledgeCuratorPhase1Test/raw-技术/Test.md",
    "03_公众号阅读/raw-技术/Test.md"
  ]);
  const candidates = await service.findRelatedNotes(
    file("KnowledgeCuratorPhase1Test/inbox/Source.md")
  );

  assert.deepEqual(
    candidates.map((candidate) => candidate.path),
    ["KnowledgeCuratorPhase1Test/raw-技术/Test.md"]
  );
});
