import test from "node:test";
import assert from "node:assert/strict";
import { CuratorController } from "../src/controllers/curator-controller";
import { VaultService } from "../src/services/vault-service";
import { DEFAULT_SETTINGS } from "../src/types/settings";
import { TFile, TFolder } from "obsidian";
import { UiNode } from "./obsidian-ui-stub";

test("normal discovery lists metadata without waiting for cloud-backed article bodies", async () => {
  let reads = 0;
  const file = Object.assign(new TFile(), { path: "raw/Test.md", name: "Test.md", basename: "Test", extension: "md", stat: { mtime: 100, size: 10 } });
  const raw = Object.assign(new TFolder(), { path: "raw", children: [file] });
  const vault = { getAbstractFileByPath: (path: string) => path === "raw" ? raw : null,
    cachedRead: async () => { reads++; throw new Error("cloud file not hydrated"); } };
  const service = new VaultService(vault as any, { getFileCache: () => null } as any, () => ({ ...DEFAULT_SETTINGS }));
  const result = await service.scanInbox();
  assert.equal(result.state, "ready");
  assert.equal(result.state === "ready" && result.items[0]?.path, "raw/Test.md");
  assert.equal(reads, 0);
});

test("preserved multiple sidebar leaves receive independent scan results after reload", async () => {
  const pending: Array<(value: any) => void> = [], views: any[] = [];
  const app = { workspace: { getLeavesOfType: () => views.map((view) => ({ view })) } };
  const vault = { scanInbox: () => new Promise((resolve) => pending.push(resolve)), getConfiguredRetrievalScope: () => ({}) };
  const cache = { getValid: () => null };
  const controller = new CuratorController(app as any, vault as any, {} as any, cache as any, {} as any, {} as any,
    {} as any, {} as any, () => ({ ...DEFAULT_SETTINGS }), {} as any, {} as any, {} as any, {} as any);
  views.push(controller.createView({} as any), controller.createView({} as any));
  controller.refreshSidebarState();
  assert.equal(pending.length, 2);
  const result = { state: "ready", configuredPath: "raw", items: [{ path: "raw/Test.md", name: "Test.md", basename: "Test", status: "pending", modified: 100, size: 1 }] };
  pending[0]!(structuredClone(result)); pending[1]!(structuredClone(result));
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const view of views) assert.equal((view.contentEl as UiNode).all().filter((node) => node.classes.has("kc-article")).length, 1);
  controller.dispose();
});

test("actual article click selects and opens the Markdown without an AI request", async () => {
  const opened: string[] = [];
  const file = { path: "raw/Test.md", stat: { mtime: 100 } };
  const app = { workspace: { getLeaf: () => ({ openFile: async (target: any) => opened.push(target.path) }) } };
  const vault = { getMarkdownFile: () => file, getConfiguredRetrievalScope: () => ({}) };
  const controller = new CuratorController(app as any, vault as any, { analyzeSource: () => { throw new Error("AI must not run on selection"); } } as any,
    { getValid: () => null } as any, {} as any, {} as any, {} as any, {} as any, () => ({ ...DEFAULT_SETTINGS }), {} as any, {} as any, {} as any, {} as any);
  const view = controller.createView({} as any);
  view.showInbox({ state: "ready", configuredPath: "raw", items: [{ path: file.path, name: "Test.md", basename: "Test", status: "pending", modified: 100, size: 1 }] });
  (view.contentEl as unknown as UiNode).all().find((node) => node.classes.has("kc-article"))!.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(view.getSelectedArticle(), file.path); assert.deepEqual(opened, [file.path]);
});
