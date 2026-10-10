const SIDEBAR_RESTORE_STORAGE_PREFIX = "knowledge-curator:sidebar-open:";

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getSidebarRestoreStorageKey(vaultName: string): string {
  return `${SIDEBAR_RESTORE_STORAGE_PREFIX}${vaultName}`;
}

export function rememberSidebarOpenState(
  storage: SessionStorageLike,
  key: string,
  isOpen: boolean
): boolean {
  try {
    storage.setItem(key, isOpen ? "open" : "closed");
    return true;
  } catch {
    return false;
  }
}

export function shouldRestoreSidebar(
  storage: SessionStorageLike,
  key: string
): boolean {
  try {
    return storage.getItem(key) === "open";
  } catch {
    return false;
  }
}
