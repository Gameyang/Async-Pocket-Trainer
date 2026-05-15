import { BrowserSyncController, type BrowserSyncControllerOptions } from "./browserSync";
import {
  loadClientSnapshotResult,
  saveClientSnapshot,
  type ClientSnapshotLoadResult,
  type StorageLike,
} from "./clientStorage";
import {
  addStarterSpeciesToCache,
  applyStarterChoicesToFrame,
  loadStarterSpeciesCache,
  rollStarterSpeciesIds,
} from "./starterSpeciesCache";
import { CODE_SYNC_SETTINGS } from "./syncSettings";
import type { SyncSettings } from "./syncSettings";
import { loadTrainerPoints, saveTrainerPoints, type MetaCurrencyState } from "./trainerPointsStore";
import { HeadlessGameClient, type HeadlessClientSnapshot } from "../game/headlessClient";
import { DEFAULT_BROWSER_TRAINER_NAME, formatTrainerPoints } from "../game/localization";
import type { GameAction, GameState, RunSummary } from "../game/types";
import type { GameFrame } from "../game/view/frame";

export const PLAYER_ID_STORAGE_KEY = "apt:player-id:v1";
export const TRAINER_NAME_STORAGE_KEY = "apt:trainer-name:v1";

export interface BrowserGameRuntimeOptions {
  storage: StorageLike;
  seed?: string;
  trainerName?: string;
  playerId?: string;
  syncSettings?: SyncSettings;
  syncOptions?: Omit<BrowserSyncControllerOptions, "playerId" | "storage" | "now">;
  now?: () => string;
  random?: () => number;
  prefetchNextCheckpoint?: boolean;
}

export interface RuntimeStatusView {
  teamRecord?: RuntimeTeamRecordView;
}

export interface RuntimeTeamRecordView {
  wave: number;
  opponentName: string;
  trainerName: string;
  message?: string;
}

export interface RuntimeFrameClient {
  getFrame(): GameFrame;
  dispatch(action: GameAction): Promise<GameState>;
}

export interface BrowserGameRuntime {
  client: HeadlessGameClient;
  syncController: BrowserSyncController;
  frameClient: RuntimeFrameClient;
  loadedSnapshot: ClientSnapshotLoadResult;
  dailyBonusMessage?: string;
  getFrame(): GameFrame;
  dispatch(action: GameAction): Promise<GameState>;
  getSnapshot(): GameState;
  saveSnapshot(): HeadlessClientSnapshot;
  getRunSummary(): RunSummary;
  getStatusView(): RuntimeStatusView;
  submitTeamRecord(trainerName: string): Promise<void>;
  rerollStarterChoices(): void;
}

interface PendingTeamRecord {
  wave: number;
  opponentName: string;
  trainerName: string;
  state: GameState;
  runSummary: RunSummary;
  message?: string;
}

export function createBrowserGameRuntime(options: BrowserGameRuntimeOptions): BrowserGameRuntime {
  const storage = options.storage;
  const now = options.now ?? (() => new Date().toISOString());
  if (options.trainerName !== undefined) {
    saveBrowserTrainerName(storage, options.trainerName);
  }
  const loadedSnapshot = loadClientSnapshotResult(storage);
  const client = loadedSnapshot.snapshot
    ? HeadlessGameClient.fromSnapshot(loadedSnapshot.snapshot)
    : new HeadlessGameClient({
        seed: options.seed ?? "browser-preview",
        trainerName: getBrowserTrainerName(storage),
      });
  const syncController = new BrowserSyncController(
    client,
    options.syncSettings ?? CODE_SYNC_SETTINGS,
    {
      ...options.syncOptions,
      playerId: options.playerId ?? getBrowserPlayerId(storage),
      storage,
      now,
    },
  );

  const dailyBonusMessage = hydrateMetaCurrency(client, storage, now);
  let recordPrompt: PendingTeamRecord | undefined;
  let starterSpeciesPool = loadStarterSpeciesCache(storage);
  let starterSpeciesChoices = rollStarterSpeciesIds(starterSpeciesPool, options.random);

  const rerollStarterChoices = () => {
    starterSpeciesPool = loadStarterSpeciesCache(storage);
    starterSpeciesChoices = rollStarterSpeciesIds(starterSpeciesPool, options.random);
  };

  const getFrame = () => applyStarterChoicesToFrame(client.getFrame(), starterSpeciesChoices);

  const dispatch = async (action: GameAction): Promise<GameState> => {
    const before = client.getSnapshot();
    const resolvedAction =
      action.type === "START_RUN" || action.type === "RETURN_TO_STARTER_CHOICE"
        ? { ...action, trainerName: getBrowserTrainerName(storage) }
        : action;

    await syncController.beforeDispatch(resolvedAction);
    const state = client.dispatch(resolvedAction);
    saveClientSnapshot(client.saveSnapshot(), storage);
    await syncController.afterDispatch(resolvedAction);

    if (resolvedAction.type === "ACCEPT_CAPTURE" && before.pendingCapture) {
      starterSpeciesPool = addStarterSpeciesToCache(storage, [before.pendingCapture.speciesId]);
      starterSpeciesChoices = rollStarterSpeciesIds(starterSpeciesPool, options.random);
    }

    if (resolvedAction.type === "RETURN_TO_STARTER_CHOICE") {
      rerollStarterChoices();
    }

    if (
      shouldOpenTeamRecordPrompt(
        resolvedAction,
        before,
        state,
        client.getBalance().checkpointInterval,
      )
    ) {
      recordPrompt = {
        wave: before.currentWave,
        opponentName: state.lastBattle?.opponentName ?? "Trainer",
        trainerName: getBrowserTrainerName(storage),
        state,
        runSummary: client.getRunSummary(),
      };
    }

    persistRuntimeState(client, storage);
    return state;
  };

  const runtime: BrowserGameRuntime = {
    client,
    syncController,
    frameClient: {
      getFrame,
      dispatch,
    },
    loadedSnapshot,
    dailyBonusMessage,
    getFrame,
    dispatch,
    getSnapshot: () => client.getSnapshot(),
    saveSnapshot: () => client.saveSnapshot(),
    getRunSummary: () => client.getRunSummary(),
    getStatusView: () => ({
      teamRecord: recordPrompt
        ? toTeamRecordView(recordPrompt, syncController.getStatus())
        : undefined,
    }),
    async submitTeamRecord(trainerName: string) {
      if (!recordPrompt) {
        return;
      }

      const normalized = saveBrowserTrainerName(storage, trainerName);
      client.dispatch({ type: "SET_TRAINER_NAME", trainerName: normalized });
      saveClientSnapshot(client.saveSnapshot(), storage);
      const status = await syncController.submitCheckpointRecord({
        wave: recordPrompt.wave,
        trainerName: normalized,
        state: {
          ...recordPrompt.state,
          trainerName: normalized,
        },
        runSummary: {
          ...recordPrompt.runSummary,
          trainerName: normalized,
        },
      });

      if (status.state === "synced") {
        recordPrompt = undefined;
      } else {
        recordPrompt = {
          ...recordPrompt,
          trainerName: normalized,
          message: status.message,
        };
      }

      persistRuntimeState(client, storage);
    },
    rerollStarterChoices,
  };

  persistRuntimeState(client, storage);

  if (options.prefetchNextCheckpoint !== false) {
    syncController.prefetchNextCheckpointInBackground();
  }

  return runtime;
}

export function createMemoryStorage(initialEntries: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initialEntries));

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

export function getBrowserPlayerId(storage: StorageLike): string {
  const existing = storage.getItem(PLAYER_ID_STORAGE_KEY);

  if (existing) {
    return existing;
  }

  const created =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `player-${Date.now().toString(36)}`;
  storage.setItem(PLAYER_ID_STORAGE_KEY, created);
  return created;
}

export function getBrowserTrainerName(storage: StorageLike): string {
  const saved = storage.getItem(TRAINER_NAME_STORAGE_KEY)?.trim();
  return saved || DEFAULT_BROWSER_TRAINER_NAME;
}

export function saveBrowserTrainerName(storage: StorageLike, trainerName: string): string {
  const normalized = trainerName.trim() || DEFAULT_BROWSER_TRAINER_NAME;
  storage.setItem(TRAINER_NAME_STORAGE_KEY, normalized);
  return normalized;
}

function hydrateMetaCurrency(
  client: HeadlessGameClient,
  storage: StorageLike,
  now: () => string,
): string | undefined {
  const persistedMeta = loadTrainerPoints(storage);
  const snapshotMeta = client.getMetaCurrency();
  const mergedMeta: MetaCurrencyState = {
    trainerPoints: Math.max(persistedMeta.trainerPoints, snapshotMeta.trainerPoints),
    claimedAchievements: Array.from(
      new Set([...persistedMeta.claimedAchievements, ...snapshotMeta.claimedAchievements]),
    ),
    lastSheetClaim: persistedMeta.lastSheetClaim ?? snapshotMeta.lastSheetClaim,
  };
  const today = now().slice(0, 10);
  let dailyBonusMessage: string | undefined;

  if (mergedMeta.lastSheetClaim?.date !== today) {
    const dailyBonus = 3;
    mergedMeta.trainerPoints += dailyBonus;
    mergedMeta.lastSheetClaim = {
      date: today,
      totalWins: mergedMeta.lastSheetClaim?.totalWins ?? 0,
      teamId: mergedMeta.lastSheetClaim?.teamId,
    };
    dailyBonusMessage = `Daily login bonus ${formatTrainerPoints(dailyBonus)} received.`;
  }

  client.setMetaCurrency(mergedMeta);
  saveTrainerPoints(storage, mergedMeta);
  saveClientSnapshot(client.saveSnapshot(), storage);
  return dailyBonusMessage;
}

function persistRuntimeState(client: HeadlessGameClient, storage: StorageLike): void {
  saveClientSnapshot(client.saveSnapshot(), storage);
  saveTrainerPoints(storage, client.getMetaCurrency());
}

function shouldOpenTeamRecordPrompt(
  action: GameAction,
  before: GameState,
  after: GameState,
  checkpointInterval: number,
): boolean {
  return (
    action.type === "RESOLVE_NEXT_ENCOUNTER" &&
    before.phase === "ready" &&
    before.currentWave > 0 &&
    before.currentWave % checkpointInterval === 0 &&
    after.phase === "ready" &&
    after.lastBattle?.kind === "trainer" &&
    after.lastBattle.winner === "player"
  );
}

function toTeamRecordView(
  record: PendingTeamRecord,
  status: { message: string },
): RuntimeTeamRecordView {
  return {
    wave: record.wave,
    opponentName: record.opponentName,
    trainerName: record.trainerName,
    message: record.message ?? status.message,
  };
}
