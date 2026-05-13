import type { StorageLike } from "./clientStorage";

export const SYNC_SETTINGS_STORAGE_KEY = "apt:sync-settings:v1";
export const DEFAULT_PUBLIC_SPREADSHEET_ID = "14ra0Y0zLORpru3nmT-obu3yD1UuO2kAJP4aJ5IIA0M4";
export const DEFAULT_PUBLIC_SHEET_NAME = "APT_WAVE_TEAMS";
export const CODE_APPS_SCRIPT_SUBMIT_URL: string = "";

export type SyncMode = "publicCsv" | "googleApi";

export interface SyncSettings {
  enabled: boolean;
  mode: SyncMode;
  spreadsheetId: string;
  range: string;
  publicCsvUrl?: string;
  appsScriptSubmitUrl?: string;
  apiKey?: string;
  accessToken?: string;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false,
  mode: "publicCsv",
  spreadsheetId: DEFAULT_PUBLIC_SPREADSHEET_ID,
  range: DEFAULT_PUBLIC_SHEET_NAME,
};

export const CODE_SYNC_SETTINGS: SyncSettings = {
  enabled: true,
  mode: "publicCsv",
  spreadsheetId: DEFAULT_PUBLIC_SPREADSHEET_ID,
  range: `${DEFAULT_PUBLIC_SHEET_NAME}!A:I`,
  ...(CODE_APPS_SCRIPT_SUBMIT_URL ? { appsScriptSubmitUrl: CODE_APPS_SCRIPT_SUBMIT_URL } : {}),
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
  const mode = readMode(source.mode, source);
  const spreadsheetId = readString(source.spreadsheetId, "spreadsheetId");
  const range = readString(source.range, "range");
  const publicCsvUrl = readOptionalString(source.publicCsvUrl, "publicCsvUrl");
  const appsScriptSubmitUrl = readOptionalString(source.appsScriptSubmitUrl, "appsScriptSubmitUrl");
  const apiKey = readOptionalString(source.apiKey, "apiKey");
  const accessToken = readOptionalString(source.accessToken, "accessToken");

  return {
    enabled,
    mode,
    spreadsheetId,
    range: range || DEFAULT_SYNC_SETTINGS.range,
    ...(publicCsvUrl ? { publicCsvUrl } : {}),
    ...(appsScriptSubmitUrl ? { appsScriptSubmitUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(accessToken ? { accessToken } : {}),
  };
}

function readMode(value: unknown, source: Record<string, unknown>): SyncMode {
  if (value === undefined) {
    return source.apiKey || source.accessToken ? "googleApi" : "publicCsv";
  }

  if (value === "publicCsv" || value === "googleApi") {
    return value;
  }

  throw new Error("Sync settings mode must be publicCsv or googleApi.");
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
