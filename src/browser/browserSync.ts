import { HeadlessGameClient } from "../game/headlessClient";
import { SeededRng } from "../game/rng";
import {
  AppsScriptSubmitter,
  type AppsScriptFetchLike,
} from "../game/sync/appsScriptSubmitAdapter";
import { GoogleSheetsTrainerAdapter, type FetchLike } from "../game/sync/googleSheetsAdapter";
import type { TrainerSyncAdapter } from "../game/sync/localSheetAdapter";
import {
  createPublicSheetCsvUrl,
  PublicCsvTrainerAdapter,
  sheetNameFromRange,
  type PublicCsvFetchLike,
} from "../game/sync/publicCsvSheetAdapter";
import {
  createTrainerSnapshot,
  isCheckpointWave,
  type TrainerSnapshot,
} from "../game/sync/trainerSnapshot";
import type { GameAction } from "../game/types";
import { hasSyncCredentials, type SyncSettings } from "./syncSettings";

export type BrowserSyncState = "disabled" | "offline" | "ready" | "syncing" | "synced" | "error";

export interface BrowserSyncStatus {
  state: BrowserSyncState;
  message: string;
  lastSyncedAt?: string;
  lastError?: string;
  candidateCount?: number;
}

export interface BrowserSyncControllerOptions {
  adapter?: TrainerSyncAdapter;
  fetch?: FetchLike & PublicCsvFetchLike & AppsScriptFetchLike;
  playerId?: string;
  now?: () => string;
}

export class BrowserSyncController {
  private adapter?: TrainerSyncAdapter;
  private appsScriptSubmitter?: AppsScriptSubmitter;
  private readonly injectedAdapter?: TrainerSyncAdapter;
  private readonly fetchImpl?: FetchLike & PublicCsvFetchLike & AppsScriptFetchLike;
  private readonly playerId: string;
  private readonly now: () => string;
  private settings: SyncSettings;
  private appendedCheckpoints = new Set<string>();
  private status: BrowserSyncStatus = {
    state: "disabled",
    message: "Sync disabled",
  };

  constructor(
    private readonly client: HeadlessGameClient,
    settings: SyncSettings,
    options: BrowserSyncControllerOptions = {},
  ) {
    this.injectedAdapter = options.adapter;
    this.fetchImpl = options.fetch;
    this.playerId = options.playerId ?? "browser-player";
    this.now = options.now ?? (() => new Date().toISOString());
    this.settings = settings;
    this.rebuildAdapter();
  }

  getSettings(): SyncSettings {
    return { ...this.settings };
  }

  getStatus(): BrowserSyncStatus {
    return { ...this.status };
  }

  updateSettings(settings: SyncSettings): void {
    this.settings = { ...settings };
    this.appendedCheckpoints.clear();
    this.rebuildAdapter();
  }

  async beforeDispatch(action: GameAction): Promise<void> {
    if (action.type !== "RESOLVE_NEXT_ENCOUNTER") {
      return;
    }

    const adapter = this.resolveReadyAdapter();
    const state = this.client.getSnapshot();

    if (
      !adapter ||
      state.phase !== "ready" ||
      !isCheckpointWave(state.currentWave, this.client.getBalance().checkpointInterval)
    ) {
      return;
    }

    this.status = {
      state: "syncing",
      message: `Loading wave ${state.currentWave} trainers`,
    };

    try {
      const candidates = await adapter.listSnapshots({
        wave: state.currentWave,
        excludePlayerId: this.playerId,
      });
      const picked = pickTrainerSnapshot(candidates, state.seed, state.currentWave, state.rngState);

      if (picked) {
        this.client.addTrainerSnapshot(picked);
      }

      this.status = {
        state: "synced",
        message: picked ? `Loaded ${picked.trainerName}` : "No sheet trainer found",
        lastSyncedAt: this.now(),
        candidateCount: candidates.length,
      };
    } catch (error) {
      this.status = toErrorStatus(error, "Trainer list failed");
    }
  }

  async afterDispatch(_action: GameAction): Promise<void> {
    const state = this.client.getSnapshot();

    if (
      state.phase !== "ready" ||
      state.team.length === 0 ||
      !isCheckpointWave(state.currentWave, this.client.getBalance().checkpointInterval)
    ) {
      return;
    }

    if (this.settings.mode === "publicCsv") {
      if (this.settings.enabled) {
        await this.submitPublicCheckpoint(state);
      }
      return;
    }

    const adapter = this.resolveReadyAdapter();

    if (!adapter) {
      return;
    }

    const checkpointKey = `${state.seed}:${state.currentWave}:${state.rngState}`;
    if (this.appendedCheckpoints.has(checkpointKey)) {
      return;
    }

    this.appendedCheckpoints.add(checkpointKey);
    this.status = {
      state: "syncing",
      message: `Appending wave ${state.currentWave}`,
    };

    try {
      await adapter.appendSnapshot(
        createTrainerSnapshot(state, {
          playerId: this.playerId,
          createdAt: this.now(),
          runSummary: this.client.getRunSummary(),
        }),
      );
      this.status = {
        state: "synced",
        message: `Wave ${state.currentWave} appended`,
        lastSyncedAt: this.now(),
      };
    } catch (error) {
      this.status = toErrorStatus(error, "Checkpoint append failed");
    }
  }

  private resolveReadyAdapter(): TrainerSyncAdapter | undefined {
    if (!this.settings.enabled) {
      this.status = {
        state: "disabled",
        message: "Sync disabled",
      };
      return undefined;
    }

    if (!this.adapter) {
      this.status = {
        state: "offline",
        message:
          this.settings.mode === "publicCsv"
            ? "Public sync needs sheet URL or CSV URL"
            : "Sync needs sheet, range, and credential",
      };
      return undefined;
    }

    return this.adapter;
  }

  private rebuildAdapter(): void {
    this.appsScriptSubmitter = undefined;

    if (!this.settings.enabled) {
      this.adapter = undefined;
      this.status = {
        state: "disabled",
        message: "Sync disabled",
      };
      return;
    }

    if (!this.settings.spreadsheetId && !this.settings.publicCsvUrl) {
      this.adapter = undefined;
      this.status = {
        state: "offline",
        message: "Public sync needs sheet URL or CSV URL",
      };
      return;
    }

    if (this.settings.mode === "publicCsv") {
      const csvUrl =
        this.settings.publicCsvUrl ||
        createPublicSheetCsvUrl(
          this.settings.spreadsheetId,
          sheetNameFromRange(this.settings.range),
        );
      this.adapter =
        this.injectedAdapter ??
        new PublicCsvTrainerAdapter({
          csvUrl,
          fetch: this.fetchImpl,
        });
      this.appsScriptSubmitter = this.settings.appsScriptSubmitUrl
        ? new AppsScriptSubmitter({
            submitUrl: this.settings.appsScriptSubmitUrl,
            fetch: this.fetchImpl,
          })
        : undefined;
      this.status = {
        state: "ready",
        message: this.appsScriptSubmitter
          ? "Public sheet + Apps Script ready"
          : "Public sheet ready",
      };
      return;
    }

    if (
      !this.settings.spreadsheetId ||
      !this.settings.range ||
      (!hasSyncCredentials(this.settings) && !this.injectedAdapter)
    ) {
      this.adapter = undefined;
      this.status = {
        state: "offline",
        message: "Sync needs sheet, range, and credential",
      };
      return;
    }

    this.adapter =
      this.injectedAdapter ??
      new GoogleSheetsTrainerAdapter({
        spreadsheetId: this.settings.spreadsheetId,
        range: this.settings.range,
        apiKey: this.settings.apiKey,
        accessToken: this.settings.accessToken,
        fetch: this.fetchImpl,
      });
    this.status = {
      state: "ready",
      message: "Sync ready",
    };
  }

  private async submitPublicCheckpoint(state: ReturnType<HeadlessGameClient["getSnapshot"]>) {
    if (!this.appsScriptSubmitter) {
      this.status = {
        state: "synced",
        message: "Public sheet read-only; checkpoint not uploaded",
        lastSyncedAt: this.now(),
      };
      return;
    }

    const checkpointKey = `${state.seed}:${state.currentWave}:${state.rngState}`;
    if (this.appendedCheckpoints.has(checkpointKey)) {
      return;
    }

    this.appendedCheckpoints.add(checkpointKey);
    this.status = {
      state: "syncing",
      message: `Submitting wave ${state.currentWave}`,
    };

    try {
      await this.appsScriptSubmitter.submitSnapshot(
        createTrainerSnapshot(state, {
          playerId: this.playerId,
          createdAt: this.now(),
          runSummary: this.client.getRunSummary(),
        }),
      );
      this.status = {
        state: "synced",
        message: `Wave ${state.currentWave} submitted to Apps Script`,
        lastSyncedAt: this.now(),
      };
    } catch (error) {
      this.status = toErrorStatus(error, "Apps Script submit failed");
    }
  }
}

function pickTrainerSnapshot(
  candidates: readonly TrainerSnapshot[],
  seed: string,
  wave: number,
  rngState: number,
): TrainerSnapshot | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  return new SeededRng(`${seed}:browser-sync:${wave}:${rngState}`).pick([...candidates]);
}

function toErrorStatus(error: unknown, fallback: string): BrowserSyncStatus {
  const message = error instanceof Error ? error.message : String(error);

  return {
    state: "error",
    message: `${fallback}: ${message}`,
    lastError: message,
  };
}
