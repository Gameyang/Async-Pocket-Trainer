import { describe, expect, it } from "vitest";

import { CLIENT_SNAPSHOT_STORAGE_KEY, loadClientSnapshot } from "./clientStorage";
import {
  createBrowserGameRuntime,
  createMemoryStorage,
  TRAINER_NAME_STORAGE_KEY,
} from "./gameRuntime";
import { STARTER_SPECIES_CACHE_STORAGE_KEY } from "./starterSpeciesCache";
import { CODE_SYNC_SETTINGS } from "./syncSettings";
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
});
