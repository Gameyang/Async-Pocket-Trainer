import { HeadlessGameClient, type HeadlessClientSnapshot } from "../game/headlessClient";

export const CLIENT_SNAPSHOT_STORAGE_KEY = "apt:headless-client-snapshot:v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ClientSnapshotLoadResult {
  snapshot?: HeadlessClientSnapshot;
  recovered: boolean;
  error?: string;
}

export function loadClientSnapshot(
  storage: StorageLike = getBrowserStorage(),
): HeadlessClientSnapshot | undefined {
  return loadClientSnapshotResult(storage).snapshot;
}

export function loadClientSnapshotResult(
  storage: StorageLike = getBrowserStorage(),
): ClientSnapshotLoadResult {
  const raw = storage.getItem(CLIENT_SNAPSHOT_STORAGE_KEY);

  if (!raw) {
    return { recovered: false };
  }

  try {
    const parsed = JSON.parse(raw) as HeadlessClientSnapshot;
    const snapshot = HeadlessGameClient.fromSnapshot(parsed).saveSnapshot();
    return { snapshot, recovered: false };
  } catch (error) {
    storage.removeItem(CLIENT_SNAPSHOT_STORAGE_KEY);
    return {
      recovered: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function saveClientSnapshot(
  snapshot: HeadlessClientSnapshot,
  storage: StorageLike = getBrowserStorage(),
): void {
  const validated = HeadlessGameClient.fromSnapshot(snapshot).saveSnapshot();
  storage.setItem(CLIENT_SNAPSHOT_STORAGE_KEY, JSON.stringify(validated));
}

export function clearClientSnapshot(storage: StorageLike = getBrowserStorage()): void {
  storage.removeItem(CLIENT_SNAPSHOT_STORAGE_KEY);
}

function getBrowserStorage(): StorageLike {
  if (typeof localStorage === "undefined") {
    throw new Error("Browser localStorage is unavailable.");
  }

  return localStorage;
}
