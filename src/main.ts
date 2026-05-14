import "./style.css";

import { loadClientSnapshotResult, saveClientSnapshot } from "./browser/clientStorage";
import type { BrowserSyncStatus } from "./browser/browserSync";
import { BrowserSyncController } from "./browser/browserSync";
import {
  addStarterSpeciesToCache,
  applyStarterChoicesToFrame,
  loadStarterSpeciesCache,
  rollStarterSpeciesIds,
} from "./browser/starterSpeciesCache";
import { CODE_SYNC_SETTINGS } from "./browser/syncSettings";
import { loadTrainerPoints, saveTrainerPoints } from "./browser/trainerPointsStore";
import { buildMetadata } from "./buildMetadata";
import { HeadlessGameClient } from "./game/headlessClient";
import { DEFAULT_BROWSER_TRAINER_NAME } from "./game/localization";
import type { GameAction, GameState, RunSummary } from "./game/types";
import { mountHtmlRenderer } from "./ui/htmlRenderer";

export { buildMetadata };

const PLAYER_ID_STORAGE_KEY = "apt:player-id:v1";
const TRAINER_NAME_STORAGE_KEY = "apt:trainer-name:v1";
const app = typeof document === "undefined" ? null : document.querySelector<HTMLDivElement>("#app");

if (app) {
  const storage = window.localStorage;
  const loaded = loadClientSnapshotResult(storage);
  const client = loaded.snapshot
    ? HeadlessGameClient.fromSnapshot(loaded.snapshot)
    : new HeadlessGameClient({
        seed: "browser-preview",
        trainerName: getBrowserTrainerName(storage),
      });
  const syncController = new BrowserSyncController(client, CODE_SYNC_SETTINGS, {
    playerId: getBrowserPlayerId(storage),
    storage,
  });
  if (loaded.error) {
    console.warn("Recovered browser save data after validation error:", loaded.error);
  }

  // Hydrate trainer points (메타 화폐): localStorage 가 더 권위적
  const persistedMeta = loadTrainerPoints(storage);
  const snapshotMeta = client.getMetaCurrency();
  const mergedMeta = {
    trainerPoints: Math.max(persistedMeta.trainerPoints, snapshotMeta.trainerPoints),
    claimedAchievements: Array.from(
      new Set([...persistedMeta.claimedAchievements, ...snapshotMeta.claimedAchievements]),
    ),
    lastSheetClaim: persistedMeta.lastSheetClaim ?? snapshotMeta.lastSheetClaim,
  };
  // Daily 접속 보너스 — 시트 누적 승수 fetch 통합은 후속, 일단 +3 TP 매일 한 번
  const today = new Date().toISOString().slice(0, 10);
  let dailyBonusMessage: string | undefined;
  if (mergedMeta.lastSheetClaim?.date !== today) {
    const dailyBonus = 3;
    mergedMeta.trainerPoints += dailyBonus;
    mergedMeta.lastSheetClaim = {
      date: today,
      totalWins: mergedMeta.lastSheetClaim?.totalWins ?? 0,
      teamId: mergedMeta.lastSheetClaim?.teamId,
    };
    dailyBonusMessage = `오늘의 접속 보너스 +${dailyBonus} TP를 받았습니다.`;
  }
  client.setMetaCurrency(mergedMeta);
  saveTrainerPoints(storage, mergedMeta);
  saveClientSnapshot(client.saveSnapshot(), storage);

  if (dailyBonusMessage && typeof document !== "undefined") {
    queueMicrotask(() => showDailyBonusBanner(dailyBonusMessage!));
  }

  let recordPrompt: PendingTeamRecord | undefined;
  let starterSpeciesPool = loadStarterSpeciesCache(storage);
  let starterSpeciesChoices = rollStarterSpeciesIds(starterSpeciesPool);
  const rerollStarterChoices = () => {
    starterSpeciesPool = loadStarterSpeciesCache(storage);
    starterSpeciesChoices = rollStarterSpeciesIds(starterSpeciesPool);
  };

  mountHtmlRenderer(
    app,
    {
      getFrame: () => applyStarterChoicesToFrame(client.getFrame(), starterSpeciesChoices),
      async dispatch(action) {
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
          starterSpeciesChoices = rollStarterSpeciesIds(starterSpeciesPool);
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
            opponentName: state.lastBattle?.opponentName ?? "트레이너",
            trainerName: getBrowserTrainerName(storage),
            state,
            runSummary: client.getRunSummary(),
          };
        }
        saveClientSnapshot(client.saveSnapshot(), storage);
        saveTrainerPoints(storage, client.getMetaCurrency());
        return state;
      },
    },
    {
      getStatusView: () => ({
        teamRecord: recordPrompt
          ? toTeamRecordView(recordPrompt, syncController.getStatus())
          : undefined,
      }),
      async onTeamRecordSubmit(trainerName: string) {
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
      },
      onStarterReroll: rerollStarterChoices,
    },
  );
}

interface PendingTeamRecord {
  wave: number;
  opponentName: string;
  trainerName: string;
  state: GameState;
  runSummary: RunSummary;
  message?: string;
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

function toTeamRecordView(record: PendingTeamRecord, status: BrowserSyncStatus) {
  return {
    wave: record.wave,
    opponentName: record.opponentName,
    trainerName: record.trainerName,
    message: record.message ?? status.message,
  };
}

function getBrowserPlayerId(storage: Storage): string {
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

function getBrowserTrainerName(storage: Storage): string {
  const saved = storage.getItem(TRAINER_NAME_STORAGE_KEY)?.trim();
  return saved || DEFAULT_BROWSER_TRAINER_NAME;
}

function saveBrowserTrainerName(storage: Storage, trainerName: string): string {
  const normalized = trainerName.trim() || DEFAULT_BROWSER_TRAINER_NAME;
  storage.setItem(TRAINER_NAME_STORAGE_KEY, normalized);
  return normalized;
}

function showDailyBonusBanner(message: string): void {
  const existing = document.querySelector(".daily-bonus-banner");
  if (existing) {
    existing.remove();
  }
  const banner = document.createElement("div");
  banner.className = "daily-bonus-banner";
  banner.setAttribute("role", "status");
  banner.textContent = `⭐ ${message}`;
  banner.addEventListener("click", () => banner.remove(), { once: true });
  setTimeout(() => banner.remove(), 6000);
  document.body.appendChild(banner);
}
