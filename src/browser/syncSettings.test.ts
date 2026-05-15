import { describe, expect, it } from "vitest";

import type { StorageLike } from "./clientStorage";
import {
  CODE_SYNC_SETTINGS,
  DEFAULT_SYNC_SETTINGS,
  SYNC_SETTINGS_STORAGE_KEY,
  clearSyncSettings,
  hasSyncCredentials,
  loadSyncSettings,
  saveSyncSettings,
} from "./syncSettings";

describe("browser sync settings storage", () => {
  it("defaults to disabled sync", () => {
    expect(loadSyncSettings(createMemoryStorage())).toEqual(DEFAULT_SYNC_SETTINGS);
  });

  it("defines code-owned browser sync settings without user storage", () => {
    expect(CODE_SYNC_SETTINGS).toMatchObject({
      enabled: true,
      mode: "publicCsv",
      spreadsheetId: expect.any(String),
      range: "APT_WAVE_TEAMS!A:J",
    });
  });

  it("stores valid settings only in the provided storage", () => {
    const storage = createMemoryStorage();
    const saved = saveSyncSettings(
      {
        enabled: true,
        mode: "googleApi",
        spreadsheetId: "sheet-1",
        range: "APT_WAVE_TEAMS!A:J",
        apiKey: "key-1",
      },
      storage,
    );

    expect(saved).toMatchObject({
      enabled: true,
      spreadsheetId: "sheet-1",
      apiKey: "key-1",
    });
    expect(loadSyncSettings(storage)).toEqual(saved);
  });

  it("keeps missing credentials as an offline-capable settings state", () => {
    const storage = createMemoryStorage();
    const saved = saveSyncSettings(
      {
        enabled: true,
        mode: "publicCsv",
        spreadsheetId: "sheet-1",
        range: "APT_WAVE_TEAMS!A:J",
        appsScriptSubmitUrl: "https://script.google.com/macros/s/deploy-id/exec",
      },
      storage,
    );

    expect(saved.enabled).toBe(true);
    expect(saved.appsScriptSubmitUrl).toContain("/exec");
    expect(hasSyncCredentials(saved)).toBe(false);
  });

  it("recovers from corrupt settings JSON", () => {
    const storage = createMemoryStorage({
      [SYNC_SETTINGS_STORAGE_KEY]: "{",
    });

    expect(loadSyncSettings(storage)).toEqual(DEFAULT_SYNC_SETTINGS);
    expect(storage.getItem(SYNC_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("clears sync settings explicitly", () => {
    const storage = createMemoryStorage();
    saveSyncSettings(
      {
        enabled: true,
        mode: "googleApi",
        spreadsheetId: "sheet-1",
        range: "APT_WAVE_TEAMS!A:J",
        accessToken: "token-1",
      },
      storage,
    );

    clearSyncSettings(storage);

    expect(storage.getItem(SYNC_SETTINGS_STORAGE_KEY)).toBeNull();
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
