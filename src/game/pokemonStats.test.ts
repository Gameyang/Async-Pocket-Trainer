import { describe, expect, it } from "vitest";

import { getSpecies } from "./data/catalog";
import {
  calculatePokemonStats,
  createEmptyStats,
  createPokemonStatProfile,
  deriveHpDv,
} from "./pokemonStats";
import type { PokemonStatProfile } from "./types";

describe("generation 1 stat calculation", () => {
  it("matches the classic level formula for fixed DVs and stat exp", () => {
    const bulbasaur = getSpecies(1);
    const profile: PokemonStatProfile = {
      dvs: {
        attack: 15,
        defense: 15,
        speed: 15,
        special: 15,
      },
      statExp: createEmptyStats(),
    };

    expect(deriveHpDv(profile.dvs)).toBe(15);
    expect(calculatePokemonStats(bulbasaur.baseStats, 5, profile)).toEqual({
      hp: 21,
      attack: 11,
      defense: 11,
      special: 13,
      speed: 11,
    });
  });

  it("creates deterministic role-weighted stat profiles", () => {
    const wild = createPokemonStatProfile({
      seed: "profile-seed",
      speciesId: 25,
      level: 10,
      role: "wild",
    });
    const trainer = createPokemonStatProfile({
      seed: "profile-seed",
      speciesId: 25,
      level: 10,
      role: "trainer",
    });

    expect(
      createPokemonStatProfile({
        seed: "profile-seed",
        speciesId: 25,
        level: 10,
        role: "wild",
      }),
    ).toEqual(wild);
    expect(trainer.dvs.attack).toBeGreaterThanOrEqual(7);
    expect(trainer.statExp.hp).toBeGreaterThanOrEqual(7_000);
    expect(wild.dvs.attack).toBeLessThanOrEqual(12);
  });
});
