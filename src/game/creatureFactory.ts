import { getMove, getSpecies, speciesCatalog } from "./data/catalog";
import { SeededRng, clamp } from "./rng";
import { scoreCreature } from "./scoring";
import type { Creature, GameBalance, MoveDefinition, SpeciesDefinition, Stats } from "./types";

export interface CreatureFactoryOptions {
  rng: SeededRng;
  wave: number;
  balance: GameBalance;
  speciesId?: number;
  role: "starter" | "wild" | "trainer";
}

export function createCreature(options: CreatureFactoryOptions): Creature {
  const species = options.speciesId
    ? getSpecies(options.speciesId)
    : pickSpeciesForWave(options.rng, options.wave, options.balance);
  const moves = pickMoves(species, options.rng);
  const growth =
    options.role === "trainer"
      ? options.balance.trainerStatGrowthPerWave
      : options.balance.wildStatGrowthPerWave;
  const stats = scaleStats(species.baseStats, options.wave, growth, options.rng, options.role);
  const partial = {
    stats,
    moves,
    types: species.types,
  };
  const powerScore = scoreCreature(partial);
  const rarityScore = Math.round(powerScore / 14 + species.rarity * 7);

  return {
    instanceId: `${species.id}-${options.wave}-${options.rng.nextUint().toString(16)}`,
    speciesId: species.id,
    speciesName: species.name,
    types: [...species.types],
    stats,
    currentHp: stats.hp,
    moves,
    rarityScore,
    powerScore,
    captureRate: species.captureRate,
  };
}

export function cloneCreature(creature: Creature): Creature {
  return {
    ...creature,
    types: [...creature.types],
    stats: { ...creature.stats },
    moves: creature.moves.map((move) => ({
      ...move,
      statusEffect: move.statusEffect ? { ...move.statusEffect } : undefined,
    })),
    status: creature.status ? { ...creature.status } : undefined,
  };
}

export function healTeam(team: readonly Creature[]): Creature[] {
  return team.map((creature) => ({
    ...cloneCreature(creature),
    currentHp: creature.stats.hp,
  }));
}

function pickSpeciesForWave(rng: SeededRng, wave: number, balance: GameBalance): SpeciesDefinition {
  const rarityBudget = clamp(1 + Math.floor(wave / balance.wildRarityBudgetWaveDivisor), 1, 8);
  const maxBaseTotal = balance.wildBaseStatBudgetBase + wave * balance.wildBaseStatBudgetPerWave;
  const candidates = speciesCatalog.filter((species) => {
    return species.rarity <= rarityBudget && getBaseStatTotal(species) <= maxBaseTotal;
  });
  const available = candidates.length > 0 ? candidates : speciesCatalog;
  const weighted = available.flatMap((species) => {
    const weight = Math.max(1, 10 - species.rarity + Math.floor(wave / 5));
    return Array.from({ length: weight }, () => species);
  });

  return rng.pick(weighted);
}

function pickMoves(species: SpeciesDefinition, rng: SeededRng): MoveDefinition[] {
  const shuffled = rng.shuffle(species.movePool);
  return shuffled.slice(0, Math.min(4, shuffled.length)).map((moveId) => getMove(moveId));
}

function scaleStats(
  baseStats: Stats,
  wave: number,
  growthPerWave: number,
  rng: SeededRng,
  role: CreatureFactoryOptions["role"],
): Stats {
  const roleBonus = role === "starter" ? 0.45 : 0;
  const growthScale = 1 + Math.max(0, wave - 1) * growthPerWave + roleBonus;

  return {
    hp: scaleStat(baseStats.hp, growthScale, rng, true),
    attack: scaleStat(baseStats.attack, growthScale, rng, false),
    defense: scaleStat(baseStats.defense, growthScale, rng, false),
    special: scaleStat(baseStats.special, growthScale, rng, false),
    speed: scaleStat(baseStats.speed, growthScale, rng, false),
  };
}

function scaleStat(baseValue: number, growthScale: number, rng: SeededRng, isHp: boolean): number {
  const variance = 0.9 + rng.nextFloat() * 0.22;
  const flatBonus = isHp ? 8 : 3;
  return Math.max(5, Math.round(baseValue * growthScale * variance + flatBonus));
}

function getBaseStatTotal(species: SpeciesDefinition): number {
  return (
    species.baseStats.hp +
    species.baseStats.attack +
    species.baseStats.defense +
    species.baseStats.special +
    species.baseStats.speed
  );
}
