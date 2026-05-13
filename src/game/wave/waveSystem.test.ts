import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../headlessClient";
import { SeededRng } from "../rng";
import { createTrainerSnapshot } from "../sync/trainerSnapshot";
import { defaultBalance } from "../data/catalog";
import {
  calculateReward,
  createTrainerEncounter,
  createTrainerEncounterFromSnapshot,
  createWildEncounter,
} from "./waveSystem";

describe("wave encounter routing", () => {
  it("scales checkpoint trainer team size by checkpoint count", () => {
    expect(
      createTrainerEncounter(5, new SeededRng("trainer-5"), defaultBalance).enemyTeam,
    ).toHaveLength(1);
    expect(
      createTrainerEncounter(10, new SeededRng("trainer-10"), defaultBalance).enemyTeam,
    ).toHaveLength(1);
    expect(
      createTrainerEncounter(15, new SeededRng("trainer-15"), defaultBalance).enemyTeam,
    ).toHaveLength(2);
    expect(
      createTrainerEncounter(20, new SeededRng("trainer-20"), defaultBalance).enemyTeam,
    ).toHaveLength(2);
  });

  it("makes elite route encounters stronger and more rewarding", () => {
    const normal = createWildEncounter(4, new SeededRng("elite-route"), defaultBalance, "normal");
    const elite = createWildEncounter(4, new SeededRng("elite-route"), defaultBalance, "elite");

    expect(elite.enemyTeam[0].powerScore).toBeGreaterThan(normal.enemyTeam[0].powerScore);
    expect(calculateReward(4, "wild", defaultBalance, "elite")).toBeGreaterThan(
      calculateReward(4, "wild", defaultBalance, "normal"),
    );
  });

  it("normalizes sheet trainer HP for battle", () => {
    const opponent = new HeadlessGameClient({
      seed: "sheet-heal",
      trainerName: "Sheet Rival",
    });
    opponent.dispatch({ type: "START_RUN", starterSpeciesId: 4 });
    const snapshot = createTrainerSnapshot(opponent.getSnapshot(), {
      playerId: "sheet-rival",
      createdAt: "2026-05-12T00:00:00.000Z",
      runSummary: opponent.getRunSummary(),
      wave: 5,
    });
    snapshot.team[0] = {
      ...snapshot.team[0],
      currentHp: 1,
    };

    const encounter = createTrainerEncounterFromSnapshot(snapshot, defaultBalance);

    expect(encounter.enemyTeam[0].currentHp).toBe(encounter.enemyTeam[0].stats.hp);
  });
});
