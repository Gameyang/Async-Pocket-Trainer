import type { StorageLike } from "./clientStorage";
import {
  parseSheetTeamBattleRecordRow,
  uniqueTeamBattleRecords,
  type TeamBattleRecord,
} from "../game/sync/teamBattleRecord";

export const TEAM_BATTLE_RECORD_CACHE_KEY_PREFIX = "apt:team-battle-records:v1";

export type CachedTeamBattleRecordStatus = "pending" | "synced";

export interface CachedTeamBattleRecordEntry {
  record: TeamBattleRecord;
  status: CachedTeamBattleRecordStatus;
  updatedAt: string;
  lastError?: string;
}

export interface TeamBattleRecordCacheSnapshot {
  version: 1;
  entries: CachedTeamBattleRecordEntry[];
}

export class TeamBattleRecordCache {
  private snapshot: TeamBattleRecordCacheSnapshot;

  constructor(
    private readonly storage: StorageLike | undefined,
    private readonly key: string,
  ) {
    this.snapshot = this.load();
  }

  listEntries(): CachedTeamBattleRecordEntry[] {
    return this.snapshot.entries.map(cloneEntry);
  }

  listRecords(): TeamBattleRecord[] {
    return uniqueTeamBattleRecords(this.snapshot.entries.map((entry) => entry.record));
  }

  listPendingRecords(): TeamBattleRecord[] {
    return this.snapshot.entries
      .filter((entry) => entry.status === "pending")
      .map((entry) => ({ ...entry.record }));
  }

  upsertPending(record: TeamBattleRecord, now: string): void {
    this.upsert(record, "pending", now);
  }

  mergeSyncedRecords(records: readonly TeamBattleRecord[], now: string): void {
    for (const record of records) {
      this.upsert(record, "synced", now);
    }
  }

  markSynced(recordId: string, now: string): void {
    this.updateEntry(recordId, (entry) => ({
      ...entry,
      status: "synced",
      updatedAt: now,
      lastError: undefined,
    }));
  }

  markError(recordId: string, error: unknown, now: string): void {
    this.updateEntry(recordId, (entry) => ({
      ...entry,
      status: "pending",
      updatedAt: now,
      lastError: error instanceof Error ? error.message : String(error),
    }));
  }

  private upsert(
    record: TeamBattleRecord,
    status: CachedTeamBattleRecordStatus,
    now: string,
  ): void {
    parseSheetTeamBattleRecordRow(record);
    const existingIndex = this.snapshot.entries.findIndex(
      (entry) => entry.record.recordId === record.recordId,
    );

    if (existingIndex >= 0) {
      const existing = this.snapshot.entries[existingIndex];
      const resolvedStatus =
        existing.status === "synced" || status === "synced" ? "synced" : "pending";
      this.snapshot.entries[existingIndex] = {
        record: { ...record },
        status: resolvedStatus,
        updatedAt: now,
        lastError: resolvedStatus === "synced" ? undefined : existing.lastError,
      };
    } else {
      this.snapshot.entries.push({
        record: { ...record },
        status,
        updatedAt: now,
      });
    }

    this.persist();
  }

  private updateEntry(
    recordId: string,
    updater: (entry: CachedTeamBattleRecordEntry) => CachedTeamBattleRecordEntry,
  ): void {
    this.snapshot.entries = this.snapshot.entries.map((entry) =>
      entry.record.recordId === recordId ? updater(entry) : entry,
    );
    this.persist();
  }

  private load(): TeamBattleRecordCacheSnapshot {
    const raw = this.storage?.getItem(this.key);

    if (!raw) {
      return { version: 1, entries: [] };
    }

    try {
      return normalizeSnapshot(JSON.parse(raw));
    } catch {
      this.storage?.removeItem(this.key);
      return { version: 1, entries: [] };
    }
  }

  private persist(): void {
    this.storage?.setItem(this.key, JSON.stringify(this.snapshot));
  }
}

export function createTeamBattleRecordCacheKey(playerId: string): string {
  return `${TEAM_BATTLE_RECORD_CACHE_KEY_PREFIX}:${playerId}`;
}

function normalizeSnapshot(value: unknown): TeamBattleRecordCacheSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Team battle record cache must be an object.");
  }

  const source = value as { version?: unknown; entries?: unknown };
  if (source.version !== 1 || !Array.isArray(source.entries)) {
    throw new Error("Unsupported team battle record cache version.");
  }

  return {
    version: 1,
    entries: source.entries.map(normalizeEntry),
  };
}

function normalizeEntry(value: unknown): CachedTeamBattleRecordEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Team battle record cache entry must be an object.");
  }

  const source = value as Record<string, unknown>;
  const record = parseSheetTeamBattleRecordRow(source.record);
  const status = source.status === "synced" ? "synced" : "pending";
  const updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : record.createdAt;
  const lastError = typeof source.lastError === "string" ? source.lastError : undefined;

  return {
    record,
    status,
    updatedAt,
    ...(lastError ? { lastError } : {}),
  };
}

function cloneEntry(entry: CachedTeamBattleRecordEntry): CachedTeamBattleRecordEntry {
  return {
    record: { ...entry.record },
    status: entry.status,
    updatedAt: entry.updatedAt,
    ...(entry.lastError ? { lastError: entry.lastError } : {}),
  };
}
