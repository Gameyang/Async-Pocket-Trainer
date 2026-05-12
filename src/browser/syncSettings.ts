import type { StorageLike } from "./clientStorage";

export const SYNC_SETTINGS_STORAGE_KEY = "apt:sync-settings:v1";

export interface SyncSettings {
  enabled: boolean;
  spreadsheetId: string;
  range: string;
  apiKey?: string;
  accessToken?: string;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false,
  spreadsheetId: "",
  range: "APT_WAVE_TEAMS!A:I",
};

export function loadSyncSettings(storage: StorageLike = getBrowserStorage()): SyncSettings {
  const raw = storage.getItem(SYNC_SETTINGS_STORAGE_KEY);

  if (!raw) {
    return { ...DEFAULT_SYNC_SETTINGS };
  }

  try {
    return normalizeSyncSettings(JSON.parse(raw));
  } catch {
    storage.removeItem(SYNC_SETTINGS_STORAGE_KEY);
    return { ...DEFAULT_SYNC_SETTINGS };
  }
}

export function saveSyncSettings(
  settings: SyncSettings,
  storage: StorageLike = getBrowserStorage(),
): SyncSettings {
  const normalized = normalizeSyncSettings(settings);
  storage.setItem(SYNC_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearSyncSettings(storage: StorageLike = getBrowserStorage()): void {
  storage.removeItem(SYNC_SETTINGS_STORAGE_KEY);
}

export function hasSyncCredentials(settings: SyncSettings): boolean {
  return Boolean(settings.apiKey || settings.accessToken);
}

export function normalizeSyncSettings(value: unknown): SyncSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Sync settings must be an object.");
  }

  const source = value as Record<string, unknown>;
  const enabled = readBoolean(source.enabled, "enabled");
  const spreadsheetId = readString(source.spreadsheetId, "spreadsheetId");
  const range = readString(source.range, "range");
  const apiKey = readOptionalString(source.apiKey, "apiKey");
  const accessToken = readOptionalString(source.accessToken, "accessToken");

  return {
    enabled,
    spreadsheetId,
    range: range || DEFAULT_SYNC_SETTINGS.range,
    ...(apiKey ? { apiKey } : {}),
    ...(accessToken ? { accessToken } : {}),
  };
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Sync settings ${field} must be boolean.`);
  }

  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Sync settings ${field} must be string.`);
  }

  return value.trim();
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const resolved = readString(value, field);
  return resolved.length > 0 ? resolved : undefined;
}

function getBrowserStorage(): StorageLike {
  if (typeof localStorage === "undefined") {
    throw new Error("Browser localStorage is unavailable.");
  }

  return localStorage;
}
