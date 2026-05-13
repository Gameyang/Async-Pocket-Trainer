import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../game/headlessClient";
import { speciesCatalog } from "../game/data/catalog";
import type { StorageLike } from "./clientStorage";
import {
  STARTER_SPECIES_CACHE_STORAGE_KEY,
  addStarterSpeciesToCache,
  applyStarterChoicesToFrame,
  loadStarterSpeciesCache,
  rollStarterSpeciesIds,
} from "./starterSpeciesCache";

describe("starter species cache", () => {
  it("stores unique valid species ids and ignores invalid entries", () => {
    const storage = createMemoryStorage();

    const saved = addStarterSpeciesToCache(storage, [25, 1, 25, -1, 999999]);

    expect(saved).toEqual([25, 1]);
    expect(loadStarterSpeciesCache(storage)).toEqual([25, 1]);
  });

  it("clears corrupt cache data", () => {
    const storage = createMemoryStorage({
      [STARTER_SPECIES_CACHE_STORAGE_KEY]: "{",
    });

    expect(loadStarterSpeciesCache(storage)).toEqual([]);
    expect(storage.getItem(STARTER_SPECIES_CACHE_STORAGE_KEY)).toBeNull();
  });

  it("keeps default starters unlocked alongside cached species", () => {
    const cached = [1, 4, 7, 10, 16, 19, 25, 35, 39, 52, 63];
    const rolled = rollStarterSpeciesIds(cached, () => 0.37);

    expect(new Set(rolled).size).toBe(rolled.length);
    expect(rolled.every((speciesId) => cached.includes(speciesId))).toBe(true);
    expect(rollStarterSpeciesIds([], () => 0.37).sort((left, right) => left - right)).toEqual([
      1, 4, 7,
    ]);
  });

  it("renders a full dex while enabling only unlocked starter actions", () => {
    const client = new HeadlessGameClient({ seed: "cached-starters" });
    const frame = applyStarterChoicesToFrame(client.getFrame(), [25, 52, 133]);

    expect(frame.scene.starterOptions).toHaveLength(speciesCatalog.length);
    expect(frame.scene.starterOptions.slice(0, 3).map((option) => option.speciesId)).toEqual([
      1, 2, 3,
    ]);
    expect(frame.actions.map((action) => action.id)).toEqual([
      "start:1",
      "start:4",
      "start:7",
      "start:25",
      "start:52",
      "start:133",
    ]);
  });

  it("leaves game-over team restart actions intact", () => {
    const client = new HeadlessGameClient({ seed: "cached-game-over" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const snapshot = client.saveSnapshot();
    snapshot.state.phase = "gameOver";
    client.loadSnapshot(snapshot);

    const frame = applyStarterChoicesToFrame(client.getFrame(), [25, 52, 133]);

    expect(frame.actions.map((action) => action.id)).toEqual([
      "restart:team:0",
      "restart:starter-choice",
    ]);
  });
});

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));

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
