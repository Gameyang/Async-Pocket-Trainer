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
  it("attaches the current battle field to generated encounters", () => {
    expect(
      createWildEncounter(1, new SeededRng("field-1"), defaultBalance).battleField,
    ).toMatchObject({
      id: "forest",
      element: "grass",
      timeOfDay: "day",
    });
    expect(
      createWildEncounter(6, new SeededRng("field-6"), defaultBalance).battleField,
    ).toMatchObject({
      id: "volcano",
      element: "fire",
      timeOfDay: "night",
    });
  });

  it("starts wild encounters near the starter level", () => {
    const levels = new Set<number>();
    const speciesIds = new Set<number>();

    for (let index = 0; index < 24; index += 1) {
      const encounter = createWildEncounter(
        1,
        new SeededRng(`opening-wild-${index}`),
        defaultBalance,
      );
      levels.add(encounter.enemyTeam[0].level ?? 0);
      speciesIds.add(encounter.enemyTeam[0].speciesId);
      expect([3, 4]).toContain(encounter.enemyTeam[0].level);
      expect([16, 19]).toContain(encounter.enemyTeam[0].speciesId);
      expect(encounter.enemyTeam[0].moves[0].id).toBe("tackle");
    }

    expect(levels).toEqual(new Set([3, 4]));
    expect(speciesIds).toEqual(new Set([16, 19]));
  });

  it("continues wild levels from the wave value after the opening range", () => {
    expect(
      createWildEncounter(6, new SeededRng("wild-level-6"), defaultBalance).enemyTeam[0].level,
    ).toBe(6);
  });

  it("applies level boost offers on top of the opening wild level", () => {
    const encounter = createWildEncounter(
      1,
      new SeededRng("opening-wild-boost"),
      defaultBalance,
      "normal",
      { levelMin: 2, levelMax: 2 },
    );

    expect([5, 6]).toContain(encounter.enemyTeam[0].level);
  });

  it("raises the field element's wild encounter weight without locking the type", () => {
    const boosted = countFieldTypeMatches(defaultBalance.battleFieldTypeWeightMultiplier);
    const neutral = countFieldTypeMatches(1);

    expect(boosted).toBeGreaterThan(neutral);
    expect(boosted).toBeLessThan(240);
  });

  it("keeps purchased type locks stronger than field weighting", () => {
    for (let index = 0; index < 40; index += 1) {
      const encounter = createWildEncounter(
        1,
        new SeededRng(`locked-field-${index}`),
        defaultBalance,
        "normal",
        { lockedType: "fire" },
      );

      expect(encounter.enemyTeam[0].types).toContain("fire");
    }
  });

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

  it("softens the first checkpoint trainer below the checkpoint wave", () => {
    const encounter = createTrainerEncounter(5, new SeededRng("trainer-5-softened"), defaultBalance);

    expect(encounter.enemyTeam[0].level).toBe(2);
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

function countFieldTypeMatches(multiplier: number): number {
  const balance = {
    ...defaultBalance,
    battleFieldTypeWeightMultiplier: multiplier,
  };
  let matches = 0;

  for (let index = 0; index < 240; index += 1) {
    const encounter = createWildEncounter(6, new SeededRng(`field-weight-${index}`), balance);
    if (encounter.enemyTeam[0].types.includes("fire")) {
      matches += 1;
    }
  }

  return matches;
}
