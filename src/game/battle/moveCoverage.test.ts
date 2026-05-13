import { describe, expect, it } from "vitest";

import rawBattleData from "../data/pokemonBattleRuntimeData.json" with { type: "json" };
import type { PokemonBattleData } from "../data/pokemonBattleData";
import { movesById } from "../data/catalog";
import { SeededRng } from "../rng";
import type { Creature, MoveDefinition } from "../types";
import { runAutoBattle } from "./battleEngine";

const battleData = rawBattleData as unknown as PokemonBattleData;
const defaultLearnsetGroup = battleData.coverage.defaultLearnsetVersionGroup;

describe("learnset move execution coverage", () => {
  it("can resolve one auto-battle turn for every original 151 learnset move", () => {
    const moveIds = getLearnsetMoveIds();
    const failures: string[] = [];

    for (const moveId of moveIds) {
      const move = movesById[moveId];

      try {
        const result = runAutoBattle({
          kind: "wild",
          normalizeLoadouts: false,
          playerTeam: [creature("player", [move])],
          enemyTeam: [creature("enemy", [movesById.tackle])],
          rng: new SeededRng(`move-coverage:${moveId}`),
          maxTurns: 1,
        });

        if (result.replay.at(-1)?.type !== "battle.end") {
          failures.push(`${moveId}: battle did not end cleanly`);
        }
      } catch (error) {
        failures.push(`${moveId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

function getLearnsetMoveIds(): string[] {
  const numericMoveIds = new Set<number>();

  for (const pokemon of battleData.pokemon) {
    const learnset = pokemon.learnsets[defaultLearnsetGroup] ?? {};

    for (const entries of Object.values(learnset)) {
      for (const [moveId] of entries) {
        numericMoveIds.add(moveId);
      }
    }
  }

  return [...numericMoveIds]
    .map((moveId) => battleData.moves.find((move) => move.id === moveId)?.identifier)
    .filter((identifier): identifier is string => Boolean(identifier))
    .sort();
}

function creature(instanceId: string, moves: MoveDefinition[]): Creature {
  return {
    instanceId,
    speciesId: 1,
    speciesName: instanceId,
    types: ["normal"],
    weightHg: 600,
    stats: {
      hp: 200,
      attack: 80,
      defense: 80,
      special: 80,
      speed: 80,
    },
    currentHp: 200,
    moves,
    rarityScore: 1,
    powerScore: 1,
    captureRate: 1,
  };
}
