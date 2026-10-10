import test from "node:test";
import assert from "node:assert/strict";
import {
  getSidebarRestoreStorageKey,
  rememberSidebarOpenState,
  shouldRestoreSidebar,
  type SessionStorageLike
} from "../src/services/sidebar-restore-state";

class MemoryStorage implements SessionStorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("restores a Sidebar that was open before plugin reload", () => {
  const storage = new MemoryStorage();
  const key = getSidebarRestoreStorageKey("MyWiki");

  assert.equal(rememberSidebarOpenState(storage, key, true), true);
  assert.equal(shouldRestoreSidebar(storage, key), true);
});

test("does not reopen a Sidebar that was already closed", () => {
  const storage = new MemoryStorage();
  const key = getSidebarRestoreStorageKey("MyWiki");

  rememberSidebarOpenState(storage, key, true);
  rememberSidebarOpenState(storage, key, false);
  assert.equal(shouldRestoreSidebar(storage, key), false);
});

test("isolates reload state between Vaults", () => {
  const storage = new MemoryStorage();
  const myWikiKey = getSidebarRestoreStorageKey("MyWiki");
  const otherVaultKey = getSidebarRestoreStorageKey("OtherVault");

  rememberSidebarOpenState(storage, myWikiKey, true);
  assert.equal(shouldRestoreSidebar(storage, otherVaultKey), false);
});

test("fails closed when session storage is unavailable", () => {
  const unavailableStorage: SessionStorageLike = {
    getItem: () => {
      throw new Error("unavailable");
    },
    setItem: () => {
      throw new Error("unavailable");
    }
  };

  assert.equal(
    rememberSidebarOpenState(unavailableStorage, "knowledge-curator:test", true),
    false
  );
  assert.equal(
    shouldRestoreSidebar(unavailableStorage, "knowledge-curator:test"),
    false
  );
});
