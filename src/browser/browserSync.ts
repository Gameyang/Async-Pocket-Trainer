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
import {
  createTeamBattleRecord,
  createTrainerTeamId,
  DEFAULT_TEAM_BATTLE_RECORD_SHEET_NAME,
  summarizeTeamBattleRecords,
  type TeamBattleRecord,
  type TeamRecordSyncAdapter,
} from "../game/sync/teamBattleRecord";
import { formatWave } from "../game/localization";
import type { GameAction, GameState, RunSummary } from "../game/types";
import type { StorageLike } from "./clientStorage";
import { hasSyncCredentials, type SyncSettings } from "./syncSettings";
import {
  createTeamBattleRecordCacheKey,
  TeamBattleRecordCache,
} from "./teamBattleRecordCache";

export type BrowserSyncState = "disabled" | "offline" | "ready" | "syncing" | "synced" | "error";

export interface BrowserSyncStatus {
  state: BrowserSyncState;
  message: string;
  lastSyncedAt?: string;
  lastError?: string;
  candidateCount?: number;
  pendingTeamRecordCount?: number;
}

export interface BrowserSyncControllerOptions {
  adapter?: TrainerSyncAdapter;
  teamRecordAdapter?: TeamRecordSyncAdapter;
  fetch?: FetchLike & PublicCsvFetchLike & AppsScriptFetchLike;
  playerId?: string;
  storage?: StorageLike;
  now?: () => string;
}

export interface BrowserCheckpointSubmitOptions {
  wave: number;
  trainerName?: string;
  state?: GameState;
  runSummary?: RunSummary;
}

interface PrefetchedTrainerCandidates {
  wave: number;
  candidates: TrainerSnapshot[];
  fetchedAt: string;
}

export class BrowserSyncController {
  private adapter?: TrainerSyncAdapter;
  private teamRecordAdapter?: TeamRecordSyncAdapter;
  private appsScriptSubmitter?: AppsScriptSubmitter;
  private readonly injectedAdapter?: TrainerSyncAdapter;
  private readonly injectedTeamRecordAdapter?: TeamRecordSyncAdapter;
  private readonly fetchImpl?: FetchLike & PublicCsvFetchLike & AppsScriptFetchLike;
  private readonly playerId: string;
  private readonly now: () => string;
  private readonly teamRecordCache: TeamBattleRecordCache;
  private settings: SyncSettings;
  private appendedCheckpoints = new Set<string>();
  private prefetchedTrainerCandidates = new Map<number, PrefetchedTrainerCandidates>();
  private backgroundPrefetch?: Promise<BrowserSyncStatus>;
  private backgroundPrefetchWave?: number;
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
    this.injectedTeamRecordAdapter = options.teamRecordAdapter;
    this.fetchImpl = options.fetch;
    this.playerId = options.playerId ?? "browser-player";
    this.now = options.now ?? (() => new Date().toISOString());
    this.teamRecordCache = new TeamBattleRecordCache(
      options.storage,
      createTeamBattleRecordCacheKey(this.playerId),
    );
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
    this.prefetchedTrainerCandidates.clear();
    this.backgroundPrefetch = undefined;
    this.backgroundPrefetchWave = undefined;
    this.rebuildAdapter();
  }

  prefetchNextCheckpointInBackground(): void {
    void this.prefetchNextCheckpoint();
  }

  async prefetchNextCheckpoint(): Promise<BrowserSyncStatus> {
    const state = this.client.getSnapshot();

    if (state.phase === "starterChoice" || state.phase === "gameOver") {
      return this.getStatus();
    }

    const wave = getNextCheckpointWave(
      state.currentWave,
      this.client.getBalance().checkpointInterval,
    );

    if (!wave || this.prefetchedTrainerCandidates.has(wave)) {
      return this.getStatus();
    }

    if (this.backgroundPrefetch && this.backgroundPrefetchWave === wave) {
      return this.backgroundPrefetch;
    }

    this.backgroundPrefetchWave = wave;
    this.backgroundPrefetch = this.prefetchTrainerCandidates(wave).finally(() => {
      if (this.backgroundPrefetchWave === wave) {
        this.backgroundPrefetch = undefined;
        this.backgroundPrefetchWave = undefined;
      }
    });

    return this.backgroundPrefetch;
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
      if (this.backgroundPrefetch && this.backgroundPrefetchWave === state.currentWave) {
        await this.backgroundPrefetch;
      }

      const prefetched =
        this.prefetchedTrainerCandidates.get(state.currentWave) ??
        (await this.loadTrainerCandidates(adapter, state.currentWave));

      await this.refreshTeamBattleRecords();
      this.applyTrainerCandidates(prefetched, state);
      this.prefetchedTrainerCandidates.delete(state.currentWave);
    } catch (error) {
      this.status = toErrorStatus(error, "트레이너 목록 불러오기 실패");
    }
  }

  async afterDispatch(action: GameAction): Promise<BrowserSyncStatus> {
    if (action.type === "RESOLVE_NEXT_ENCOUNTER") {
      const record = createTeamBattleRecord(this.client.getSnapshot(), {
        playerId: this.playerId,
        createdAt: this.now(),
      });

      if (record) {
        this.teamRecordCache.upsertPending(record, this.now());
        this.status = {
          ...this.status,
          pendingTeamRecordCount: this.teamRecordCache.listPendingRecords().length,
        };
        await this.flushTeamBattleRecords();
      }

      await this.submitLatestCheckpointWin();
    }

    const status = this.getStatus();
    this.prefetchNextCheckpointInBackground();
    return status;
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

  async flushTeamBattleRecords(): Promise<BrowserSyncStatus> {
    const pending = this.teamRecordCache.listPendingRecords();

    if (pending.length === 0) {
      return this.getStatus();
    }

    const submitter = this.resolveTeamRecordSubmitter();
    if (!submitter) {
      this.status = {
        ...this.status,
        state: this.settings.enabled ? "offline" : "disabled",
        message: this.settings.enabled
          ? "팀 전적은 로컬에 저장됨. 업로드 설정이 필요합니다."
          : "팀 전적은 로컬에 저장됨. 동기화 꺼짐",
        pendingTeamRecordCount: pending.length,
      };
      return this.getStatus();
    }

    for (const record of pending) {
      try {
        await submitter(record);
        this.teamRecordCache.markSynced(record.recordId, this.now());
      } catch (error) {
        this.teamRecordCache.markError(record.recordId, error, this.now());
        this.status = toErrorStatus(error, "팀 전적 업로드 실패");
        this.status.pendingTeamRecordCount = this.teamRecordCache.listPendingRecords().length;
        return this.getStatus();
      }
    }

    this.status = {
      ...this.status,
      state: "synced",
      message: "팀 전적 동기화 완료",
      lastSyncedAt: this.now(),
      pendingTeamRecordCount: this.teamRecordCache.listPendingRecords().length,
    };
    return this.getStatus();
  }

  private async prefetchTrainerCandidates(wave: number): Promise<BrowserSyncStatus> {
    const adapter = this.resolveReadyAdapter();

    if (!adapter) {
      return this.getStatus();
    }

    if (this.prefetchedTrainerCandidates.has(wave)) {
      return this.getStatus();
    }

    this.status = {
      state: "syncing",
      message: `${formatWave(wave)} 트레이너 미리 불러오는 중`,
    };

    try {
      const prefetched = await this.loadTrainerCandidates(adapter, wave);
      await this.refreshTeamBattleRecords();
      this.status = {
        state: "synced",
        message: `${formatWave(wave)} 트레이너 ${prefetched.candidates.length}명 준비됨`,
        lastSyncedAt: prefetched.fetchedAt,
        candidateCount: prefetched.candidates.length,
        pendingTeamRecordCount: this.teamRecordCache.listPendingRecords().length,
      };
    } catch (error) {
      this.status = toErrorStatus(error, "다음 체크포인트 트레이너 미리 불러오기 실패");
    }

    return this.getStatus();
  }

  private async loadTrainerCandidates(
    adapter: TrainerSyncAdapter,
    wave: number,
  ): Promise<PrefetchedTrainerCandidates> {
    const candidates = await adapter.listSnapshots({
      wave,
      excludePlayerId: this.playerId,
    });
    const prefetched = {
      wave,
      candidates,
      fetchedAt: this.now(),
    };
    this.prefetchedTrainerCandidates.set(wave, prefetched);
    return prefetched;
  }

  private applyTrainerCandidates(
    prefetched: PrefetchedTrainerCandidates,
    state: GameState,
  ): BrowserSyncStatus {
    const picked = pickTrainerSnapshot(
      prefetched.candidates,
      state.seed,
      state.currentWave,
      state.rngState,
    );

    if (picked) {
      this.client.addTrainerSnapshot(this.withTeamRecordSummary(picked));
    }

    this.status = {
      state: "synced",
      message: picked ? `${picked.trainerName} 불러옴` : "시트 트레이너가 없습니다",
      lastSyncedAt: prefetched.fetchedAt,
      candidateCount: prefetched.candidates.length,
      pendingTeamRecordCount: this.teamRecordCache.listPendingRecords().length,
    };
    return this.getStatus();
  }

  private async submitLatestCheckpointWin(): Promise<BrowserSyncStatus> {
    const state = this.client.getSnapshot();
    const battle = state.lastBattle;

    if (state.phase !== "ready" || battle?.kind !== "trainer" || battle.winner !== "player") {
      return this.getStatus();
    }

    const battleWave = getLatestResolvedBattleWave(state) ?? state.currentWave - 1;
    if (!isCheckpointWave(battleWave, this.client.getBalance().checkpointInterval)) {
      return this.getStatus();
    }

    return this.submitCheckpointRecord({
      wave: battleWave,
      state,
      runSummary: this.client.getRunSummary(),
    });
  }

  private async refreshTeamBattleRecords(): Promise<void> {
    if (!this.settings.enabled || !this.teamRecordAdapter) {
      return;
    }

    try {
      const records = await this.teamRecordAdapter.listTeamBattleRecords();
      this.teamRecordCache.mergeSyncedRecords(records, this.now());
    } catch (error) {
      this.status = {
        ...this.status,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private withTeamRecordSummary(snapshot: TrainerSnapshot): TrainerSnapshot {
    const teamId = createTrainerTeamId(snapshot);
    const record = summarizeTeamBattleRecords(this.teamRecordCache.listRecords(), teamId);

    return {
      ...snapshot,
      teamRecord: record,
    };
  }

  private resolveTeamRecordSubmitter():
    | ((record: TeamBattleRecord) => Promise<unknown>)
    | undefined {
    if (!this.settings.enabled) {
      return undefined;
    }

    if (this.settings.mode === "publicCsv") {
      if (this.appsScriptSubmitter) {
        return (record) => this.appsScriptSubmitter?.submitTeamBattleRecord(record) ?? Promise.resolve();
      }

      if (this.injectedTeamRecordAdapter) {
        return (record) =>
          this.injectedTeamRecordAdapter?.appendTeamBattleRecord(record) ?? Promise.resolve();
      }

      return undefined;
    }

    if (!this.teamRecordAdapter) {
      return undefined;
    }

    return (record) => this.teamRecordAdapter?.appendTeamBattleRecord(record) ?? Promise.resolve();
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
    this.teamRecordAdapter = undefined;

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
      const teamRecordCsvUrl =
        this.settings.publicTeamRecordCsvUrl ||
        (this.settings.spreadsheetId
          ? createPublicSheetCsvUrl(
              this.settings.spreadsheetId,
              sheetNameFromRange(
                this.settings.teamRecordRange ?? DEFAULT_TEAM_BATTLE_RECORD_SHEET_NAME,
              ),
            )
          : undefined);
      this.adapter =
        this.injectedAdapter ??
        new PublicCsvTrainerAdapter({
          csvUrl,
          teamRecordCsvUrl,
          fetch: this.fetchImpl,
        });
      this.teamRecordAdapter =
        this.injectedTeamRecordAdapter ?? asTeamRecordSyncAdapter(this.adapter);
      this.appsScriptSubmitter = this.settings.appsScriptSubmitUrl
        ? new AppsScriptSubmitter({
            submitUrl: this.settings.appsScriptSubmitUrl,
            teamRecordSheetName: sheetNameFromRange(
              this.settings.teamRecordRange ?? DEFAULT_TEAM_BATTLE_RECORD_SHEET_NAME,
            ),
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
        teamRecordRange: this.settings.teamRecordRange,
        apiKey: this.settings.apiKey,
        accessToken: this.settings.accessToken,
        fetch: this.fetchImpl,
      });
    this.teamRecordAdapter =
      this.injectedTeamRecordAdapter ?? asTeamRecordSyncAdapter(this.adapter);
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

function getNextCheckpointWave(
  currentWave: number,
  checkpointInterval: number,
): number | undefined {
  if (
    !Number.isInteger(currentWave) ||
    !Number.isInteger(checkpointInterval) ||
    currentWave < 1 ||
    checkpointInterval < 1
  ) {
    return undefined;
  }

  return Math.ceil(currentWave / checkpointInterval) * checkpointInterval;
}

function getLatestResolvedBattleWave(state: GameState): number | undefined {
  const wave = [...state.events].reverse().find((event) => event.type === "battle_resolved")?.wave;

  return typeof wave === "number" && Number.isInteger(wave) && wave > 0 ? wave : undefined;
}

function asTeamRecordSyncAdapter(adapter: unknown): TeamRecordSyncAdapter | undefined {
  if (
    typeof adapter === "object" &&
    adapter !== null &&
    "appendTeamBattleRecord" in adapter &&
    "listTeamBattleRows" in adapter &&
    "listTeamBattleRecords" in adapter
  ) {
    return adapter as TeamRecordSyncAdapter;
  }

  return undefined;
}

function toErrorStatus(error: unknown, fallback: string): BrowserSyncStatus {
  const message = error instanceof Error ? error.message : String(error);

  return {
    state: "error",
    message: `${fallback}. 설정을 확인하세요.`,
    lastError: message,
  };
}
