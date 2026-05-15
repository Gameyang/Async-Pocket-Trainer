import { describe, expect, it } from "vitest";

import { CLIENT_SNAPSHOT_STORAGE_KEY, loadClientSnapshot } from "./clientStorage";
import {
  createBrowserGameRuntime,
  createMemoryStorage,
  TRAINER_GREETING_STORAGE_KEY,
  TRAINER_NAME_STORAGE_KEY,
} from "./gameRuntime";
import { STARTER_SPECIES_CACHE_STORAGE_KEY } from "./starterSpeciesCache";
import { CODE_SYNC_SETTINGS } from "./syncSettings";
import { HeadlessGameClient } from "../game/headlessClient";
import { LocalTrainerSheetAdapter } from "../game/sync/localSheetAdapter";
import {
  createTrainerSnapshot,
  serializeTrainerSnapshot,
  type TrainerSnapshot,
} from "../game/sync/trainerSnapshot";
import { loadTrainerPoints } from "./trainerPointsStore";

const disabledSyncSettings = {
  ...CODE_SYNC_SETTINGS,
  enabled: false,
};

describe("browser game runtime", () => {
  it("shares the browser dispatch pipeline without requiring a renderer", async () => {
    const storage = createMemoryStorage({
      [TRAINER_NAME_STORAGE_KEY]: "Runtime QA",
    });
    const runtime = createBrowserGameRuntime({
      storage,
      seed: "runtime-test",
      playerId: "runtime-player",
      syncSettings: disabledSyncSettings,
      now: () => "2026-05-15T00:00:00.000Z",
      random: () => 0,
      prefetchNextCheckpoint: false,
    });
    const startAction = runtime.getFrame().actions.find((action) => action.id.startsWith("start:"));

    expect(runtime.dailyBonusMessage).toContain("Daily login bonus");
    expect(loadTrainerPoints(storage).trainerPoints).toBe(3);
    expect(startAction).toBeDefined();

    await runtime.dispatch(startAction!.action);

    const saved = loadClientSnapshot(storage);
    expect(saved?.state.phase).toBe("ready");
    expect(saved?.state.trainerName).toBe("Runtime QA");
    expect(storage.getItem(CLIENT_SNAPSHOT_STORAGE_KEY)).toEqual(JSON.stringify(saved));
  });

  it("applies cached starter choices to the renderless frame", () => {
    const storage = createMemoryStorage({
      [STARTER_SPECIES_CACHE_STORAGE_KEY]: JSON.stringify([25]),
    });
    const runtime = createBrowserGameRuntime({
      storage,
      seed: "runtime-starters",
      playerId: "runtime-player",
      syncSettings: disabledSyncSettings,
      now: () => "2026-05-15T00:00:00.000Z",
      random: () => 0,
      prefetchNextCheckpoint: false,
    });
    const frame = runtime.getFrame();

    expect(frame.phase).toBe("starterChoice");
    expect(frame.actions.some((action) => action.id === "start:25")).toBe(true);
  });

  it("submits the checkpoint victory team profile from the player prompt", async () => {
    const opponent = weakenTrainerSnapshot(buildOpponentSnapshot());
    const adapter = new LocalTrainerSheetAdapter([serializeTrainerSnapshot(opponent)]);
    const storage = createMemoryStorage({
      [TRAINER_NAME_STORAGE_KEY]: "Runtime QA",
    });
    const runtime = createBrowserGameRuntime({
      storage,
      seed: "runtime-profile-submit",
      playerId: "runtime-player",
      syncSettings: {
        ...CODE_SYNC_SETTINGS,
        mode: "googleApi",
        range: "APT_WAVE_TEAMS!A:L",
      },
      syncOptions: { adapter },
      now: () => "2026-05-15T00:00:00.000Z",
      random: () => 0,
      prefetchNextCheckpoint: false,
    });

    await runtime.dispatch({ type: "START_RUN", starterSpeciesId: 149 });
    moveRuntimeToCheckpoint(runtime.client);
    await runtime.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    expect(runtime.getStatusView().teamRecord).toMatchObject({
      teamName: "Runtime QA",
      opponentName: expect.stringContaining("Runtime Rival"),
    });
    expect(await adapter.listRows({ wave: 5 })).toHaveLength(1);

    await runtime.submitTeamRecord({
      teamName: "Prompt Team",
      trainerGreeting: "반갑습니다!",
    });

    const rows = await adapter.listRows({ wave: 5 });
    const submitted = rows.find((row) => row.playerId === "runtime-player");
    expect(submitted).toMatchObject({
      trainerName: "Prompt Team",
      teamName: "Prompt Team",
      trainerGreeting: "반갑습니다!",
    });
    expect(storage.getItem(TRAINER_NAME_STORAGE_KEY)).toBe("Prompt Team");
    expect(storage.getItem(TRAINER_GREETING_STORAGE_KEY)).toBe("반갑습니다!");
    expect(runtime.getStatusView().teamRecord).toBeUndefined();
  });
});

function buildOpponentSnapshot(): TrainerSnapshot {
  const opponent = new HeadlessGameClient({
    seed: "runtime-profile-opponent",
    trainerName: "Runtime Rival",
  });
  opponent.dispatch({ type: "START_RUN", starterSpeciesId: 4 });

  return createTrainerSnapshot(opponent.getSnapshot(), {
    playerId: "runtime-opponent",
    createdAt: "2026-05-15T00:00:00.000Z",
    runSummary: opponent.getRunSummary(),
    wave: 5,
  });
}

function weakenTrainerSnapshot(snapshot: TrainerSnapshot): TrainerSnapshot {
  return {
    ...snapshot,
    teamPower: 1,
    team: snapshot.team.map((creature) => ({
      ...creature,
      level: 1,
      statBonuses: {
        hp: 0,
        attack: 0,
        defense: 0,
        special: 0,
        speed: 0,
      },
      currentHp: 1,
      powerScore: 1,
      stats: {
        hp: 1,
        attack: 1,
        defense: 1,
        special: 1,
        speed: 1,
      },
    })),
  };
}

function moveRuntimeToCheckpoint(client: HeadlessGameClient): void {
  const snapshot = client.saveSnapshot();
  snapshot.state.phase = "ready";
  snapshot.state.currentWave = 5;
  snapshot.state.money = 999;
  snapshot.state.team = snapshot.state.team.map((creature) => ({
    ...creature,
    statBonuses: {
      hp: 900,
      attack: 900,
      defense: 900,
      special: 900,
      speed: 900,
    },
    currentHp: 999,
    powerScore: 999,
    stats: {
      hp: 999,
      attack: 999,
      defense: 999,
      special: 999,
      speed: 999,
    },
  }));
  client.loadSnapshot(snapshot);
}
