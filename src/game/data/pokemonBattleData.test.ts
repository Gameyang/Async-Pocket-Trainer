import { describe, expect, it } from "vitest";

import rawBattleData from "./pokemonBattleData.json" with { type: "json" };
import type { PokemonBattleData } from "./pokemonBattleData";

function readBattleData(): PokemonBattleData {
  return rawBattleData as unknown as PokemonBattleData;
}

describe("pokemon battle data", () => {
  it("covers the original 151 Pokemon and their generated image assets", () => {
    const data = readBattleData();

    expect(data.coverage.pokemonCount).toBe(151);
    expect(data.pokemon).toHaveLength(151);
    expect(data.pokemon[0]).toMatchObject({
      dexNumber: 1,
      identifier: "bulbasaur",
      types: ["grass", "poison"],
      baseStats: {
        hp: 45,
        attack: 49,
        defense: 49,
        "special-attack": 65,
        "special-defense": 65,
        speed: 45,
      },
    });
    expect(data.pokemon.at(-1)).toMatchObject({
      dexNumber: 151,
      identifier: "mew",
    });

    expect(new Set(data.pokemon.map((pokemon) => pokemon.asset)).size).toBe(151);
    expect(data.pokemon.map((pokemon) => pokemon.asset)).toContain("resources/pokemon/0001.webp");
    expect(data.pokemon.map((pokemon) => pokemon.asset)).toContain("resources/pokemon/0151.webp");
  });

  it("includes battle mechanics lookup tables and a complete default learnset group", () => {
    const data = readBattleData();

    expect(data.coverage.defaultLearnsetVersionGroup).toBe("lets-go-pikachu-lets-go-eevee");
    expect(data.moves.length).toBe(data.coverage.moveCount);
    expect(data.abilities.length).toBe(data.coverage.abilityCount);
    expect(data.types.length).toBe(18);
    expect(data.typeChart.fire.grass).toBe(2);
    expect(data.typeChart.normal.ghost).toBe(0);

    for (const pokemon of data.pokemon) {
      expect(pokemon.learnsets[data.coverage.defaultLearnsetVersionGroup]).toBeDefined();
    }
  });
});
