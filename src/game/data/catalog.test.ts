import { describe, expect, it } from "vitest";

import rawBattleData from "./pokemonBattleRuntimeData.json" with { type: "json" };
import type { PokemonBattleData } from "./pokemonBattleData";
import { getLevelUpMoveIds, getUnlockedLevelUpMoveIds, movesById, speciesCatalog } from "./catalog";

const battleData = rawBattleData as unknown as PokemonBattleData;
const defaultLearnsetGroup = battleData.coverage.defaultLearnsetVersionGroup;

describe("battle catalog move coverage", () => {
  it("exposes every LGPE learnset move for the original 151 Pokemon", () => {
    const learnsetMoveIds = getLearnsetMoveIds();
    const missing = learnsetMoveIds.filter((moveId) => !movesById[moveId]);

    expect(learnsetMoveIds).toHaveLength(211);
    expect(missing).toEqual([]);
  });

  it("keeps status, priority, stat, multi-hit, and recovery metadata in move definitions", () => {
    expect(movesById.growl).toMatchObject({
      category: "status",
      power: 0,
      statChanges: [{ stat: "attack", change: -1 }],
    });
    expect(movesById["quick-attack"]).toMatchObject({ priority: 1 });
    expect(movesById["double-slap"].meta).toMatchObject({ minHits: 2, maxHits: 5 });
    expect(movesById["mega-drain"].meta).toMatchObject({ drain: 50 });
    expect(movesById.recover.meta).toMatchObject({ healing: 50 });
    expect(movesById["thunder-shock"]).toMatchObject({
      accuracyPercent: 100,
      shortEffect: "Has a 10% chance to paralyze the target.",
    });
  });

  it("builds species move pools only from implemented move definitions", () => {
    const missingPoolMoves = speciesCatalog.flatMap((species) =>
      species.movePool.filter((moveId) => !movesById[moveId]).map((moveId) => [species.id, moveId]),
    );
    const movePoolIds = new Set(speciesCatalog.flatMap((species) => species.movePool));

    expect(missingPoolMoves).toEqual([]);
    expect([...movePoolIds].sort()).toEqual(getLearnsetMoveIds());
    expect(speciesCatalog.some((species) =>
      species.movePool.some((moveId) => movesById[moveId].category === "status"),
    )).toBe(true);
  });

  it("exposes level-gated level-up move pools separately from TM and tutor pools", () => {
    expect(getUnlockedLevelUpMoveIds(25, 20)).toEqual([
      "thunder-shock",
      "growl",
      "tail-whip",
      "quick-attack",
      "double-kick",
      "double-team",
      "thunder-wave",
      "light-screen",
    ]);
    expect(getUnlockedLevelUpMoveIds(25, 20)).not.toContain("thunderbolt");
    expect(getLevelUpMoveIds(25)).toContain("thunderbolt");
    expect(speciesCatalog.find((species) => species.id === 25)?.movePool).toContain("dig");
    expect(getLevelUpMoveIds(25)).not.toContain("dig");
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
