import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../game/headlessClient";
import {
  CLIENT_SNAPSHOT_STORAGE_KEY,
  clearClientSnapshot,
  loadClientSnapshot,
  loadClientSnapshotResult,
  saveClientSnapshot,
  type StorageLike,
} from "./clientStorage";

describe("browser client snapshot storage", () => {
  it("loads undefined when no browser save exists", () => {
    expect(loadClientSnapshot(createMemoryStorage())).toBeUndefined();
  });

  it("stores and restores a validated headless client snapshot", () => {
    const storage = createMemoryStorage();
    const client = new HeadlessGameClient({ seed: "browser-save" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    saveClientSnapshot(client.saveSnapshot(), storage);
    const restored = loadClientSnapshot(storage);

    expect(restored).toEqual(client.saveSnapshot());
  });

  it("clears corrupt or incompatible browser saves", () => {
    const storage = createMemoryStorage({
      [CLIENT_SNAPSHOT_STORAGE_KEY]: "{",
    });

    const result = loadClientSnapshotResult(storage);

    expect(result).toMatchObject({ recovered: true });
    expect(storage.getItem(CLIENT_SNAPSHOT_STORAGE_KEY)).toBeNull();
  });

  it("clears the browser save key explicitly", () => {
    const storage = createMemoryStorage();
    const client = new HeadlessGameClient({ seed: "browser-clear" });
    saveClientSnapshot(client.saveSnapshot(), storage);

    clearClientSnapshot(storage);

    expect(storage.getItem(CLIENT_SNAPSHOT_STORAGE_KEY)).toBeNull();
  });
});

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
