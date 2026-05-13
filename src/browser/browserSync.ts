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
import { formatWave } from "../game/localization";
import type { GameAction, GameState, RunSummary } from "../game/types";
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

export interface BrowserCheckpointSubmitOptions {
  wave: number;
  trainerName?: string;
  state?: GameState;
  runSummary?: RunSummary;
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
    message: "동기화 꺼짐",
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
      message: `${formatWave(state.currentWave)} 트레이너 불러오는 중`,
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
        message: picked ? `${picked.trainerName} 불러옴` : "시트 트레이너가 없습니다",
        lastSyncedAt: this.now(),
        candidateCount: candidates.length,
      };
    } catch (error) {
      this.status = toErrorStatus(error, "트레이너 목록 불러오기 실패");
    }
  }

  async afterDispatch(_action: GameAction): Promise<void> {
    return;
  }

  async submitCheckpointRecord(
    options: BrowserCheckpointSubmitOptions,
  ): Promise<BrowserSyncStatus> {
    const state = options.state ?? this.client.getSnapshot();

    if (
      state.phase !== "ready" ||
      state.team.length === 0 ||
      !isCheckpointWave(options.wave, this.client.getBalance().checkpointInterval)
    ) {
      return this.status;
    }

    if (this.settings.mode === "publicCsv") {
      if (this.settings.enabled) {
        await this.submitPublicCheckpoint(state, options);
      }
      return this.getStatus();
    }

    const adapter = this.resolveReadyAdapter();

    if (!adapter) {
      return this.getStatus();
    }

    const checkpointKey = `${state.seed}:${options.wave}:${state.rngState}`;
    if (this.appendedCheckpoints.has(checkpointKey)) {
      return this.getStatus();
    }

    this.status = {
      state: "syncing",
      message: `${formatWave(options.wave)} 기록 업로드 중`,
    };

    try {
      await adapter.appendSnapshot(this.createCheckpointSnapshot(state, options));
      this.appendedCheckpoints.add(checkpointKey);
      this.status = {
        state: "synced",
        message: `${formatWave(options.wave)} 기록 업로드 완료`,
        lastSyncedAt: this.now(),
      };
    } catch (error) {
      this.status = toErrorStatus(error, "체크포인트 업로드 실패");
    }

    return this.getStatus();
  }

  private resolveReadyAdapter(): TrainerSyncAdapter | undefined {
    if (!this.settings.enabled) {
      this.status = {
        state: "disabled",
        message: "동기화 꺼짐",
      };
      return undefined;
    }

    if (!this.adapter) {
      this.status = {
        state: "offline",
        message:
          this.settings.mode === "publicCsv"
            ? "공개 동기화에는 시트 URL 또는 CSV URL이 필요합니다"
            : "시트, 범위, 인증 정보가 필요합니다",
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
        message: "동기화 꺼짐",
      };
      return;
    }

    if (!this.settings.spreadsheetId && !this.settings.publicCsvUrl) {
      this.adapter = undefined;
      this.status = {
        state: "offline",
        message: "공개 동기화에는 시트 URL 또는 CSV URL이 필요합니다",
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
        message: this.appsScriptSubmitter ? "공개 시트와 Apps Script 준비됨" : "공개 시트 준비됨",
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
        message: "시트, 범위, 인증 정보가 필요합니다",
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
      message: "동기화 준비됨",
    };
  }

  private async submitPublicCheckpoint(state: GameState, options: BrowserCheckpointSubmitOptions) {
    if (!this.appsScriptSubmitter) {
      this.status = {
        state: "offline",
        message: "Apps Script 제출 URL이 코드에 설정되지 않았습니다",
      };
      return;
    }

    const checkpointKey = `${state.seed}:${options.wave}:${state.rngState}`;
    if (this.appendedCheckpoints.has(checkpointKey)) {
      return;
    }

    this.status = {
      state: "syncing",
      message: `${formatWave(options.wave)} 제출 중`,
    };

    try {
      await this.appsScriptSubmitter.submitSnapshot(this.createCheckpointSnapshot(state, options));
      this.appendedCheckpoints.add(checkpointKey);
      this.status = {
        state: "synced",
        message: `${formatWave(options.wave)} Apps Script 제출 완료`,
        lastSyncedAt: this.now(),
      };
    } catch (error) {
      this.status = toErrorStatus(error, "Apps Script 제출 실패");
    }
  }

  private createCheckpointSnapshot(
    state: GameState,
    options: BrowserCheckpointSubmitOptions,
  ): TrainerSnapshot {
    const runSummary = {
      ...(options.runSummary ?? this.client.getRunSummary()),
      ...(options.trainerName ? { trainerName: options.trainerName } : {}),
    };

    return createTrainerSnapshot(state, {
      playerId: this.playerId,
      trainerName: options.trainerName,
      createdAt: this.now(),
      runSummary,
      wave: options.wave,
    });
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
    message: `${fallback}. 설정을 확인하세요.`,
    lastError: message,
  };
}
