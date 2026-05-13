import rawBattleData from "./pokemonBattleRuntimeData.json" with { type: "json" };
import type { MoveRecord, PokemonBattleData, PokemonRecord } from "./pokemonBattleData";
import { clamp } from "../rng";
import type {
  BattleStatus,
  ElementType,
  GameBalance,
  MoveDefinition,
  SpeciesDefinition,
  Stats,
} from "../types";

const battleData = rawBattleData as unknown as PokemonBattleData;
const defaultLearnsetGroup = battleData.coverage.defaultLearnsetVersionGroup;
const rawMovesByNumericId = new Map(battleData.moves.map((move) => [move.id, move]));

export const defaultBalance: GameBalance = {
  checkpointInterval: 5,
  maxTeamSize: 6,
  trainerTeamSizeCheckpointSpan: 3,
  wildBaseStatBudgetBase: 218,
  wildBaseStatBudgetPerWave: 7,
  wildRarityBudgetWaveDivisor: 9,
  wildStatGrowthPerWave: 0.03,
  trainerStatGrowthPerWave: 0.016,
  battleDamageScale: 0.15,
  rewardBase: 15,
  rewardPerWave: 3,
  trainerRewardBonus: 16,
  restCostPerWave: 0,
  supplyRouteCost: 8,
  eliteRewardBonus: 8,
  eliteStatMultiplier: 1.06,
  eliteCaptureChanceBonus: 0.03,
  defeatedCaptureHpRatioFloor: 0.24,
  checkpointTeamSizeGrowthPerCheckpoint: 1 / 3,
  teamRestCost: 20,
  pokeBallCost: 9,
  greatBallCost: 22,
  startingMoney: 50,
  startingPokeBalls: 5,
  startingGreatBalls: 1,
};

export const movesById: Record<string, MoveDefinition> = Object.fromEntries(
  battleData.moves.flatMap((record) => {
    const move = toMoveDefinition(record);
    return move ? [[move.id, move]] : [];
  }),
);

export const typeChart = battleData.typeChart as Record<
  ElementType,
  Partial<Record<ElementType, number>>
>;

export const speciesCatalog: SpeciesDefinition[] = battleData.pokemon.map(toSpeciesDefinition);

export const starterSpeciesIds: readonly number[] = [1, 4, 7];

export function getSpecies(speciesId: number): SpeciesDefinition {
  const found = speciesCatalog.find((candidate) => candidate.id === speciesId);

  if (!found) {
    throw new Error(`Unknown species id: ${speciesId}`);
  }

  return found;
}

export function getMove(moveId: string): MoveDefinition {
  const found = movesById[moveId];

  if (!found) {
    throw new Error(`Unknown move id: ${moveId}`);
  }

  return found;
}

function toSpeciesDefinition(record: PokemonRecord): SpeciesDefinition {
  const baseStats = toStats(record);
  const fallbackMove = movesById.tackle ? ["tackle"] : Object.keys(movesById).slice(0, 1);
  const movePool = buildMovePool(record);
  const baseStatTotal =
    baseStats.hp + baseStats.attack + baseStats.defense + baseStats.special + baseStats.speed;
  const legendaryBonus = record.species.legendary || record.species.mythical ? 2 : 0;
  const rarity = clamp(Math.ceil((baseStatTotal - 230) / 55) + legendaryBonus, 1, 10);

  return {
    id: record.dexNumber,
    name: record.names.ko ?? record.names.en,
    types: record.types as ElementType[],
    baseStats,
    movePool: movePool.length > 0 ? movePool : fallbackMove,
    captureRate: clamp(record.species.captureRate / 255, 0.08, 0.78),
    rarity,
  };
}

function toStats(record: PokemonRecord): Stats {
  return {
    hp: record.baseStats.hp,
    attack: record.baseStats.attack,
    defense: record.baseStats.defense,
    special: Math.round(
      (record.baseStats["special-attack"] + record.baseStats["special-defense"]) / 2,
    ),
    speed: record.baseStats.speed,
  };
}

function toMoveDefinition(record: MoveRecord): MoveDefinition | undefined {
  if (!record.power || record.power <= 0) {
    return undefined;
  }

  if (record.damageClass !== "physical" && record.damageClass !== "special") {
    return undefined;
  }

  return {
    id: record.identifier,
    name: record.names.ko ?? toTitleCase(record.identifier),
    type: record.type as ElementType,
    power: record.power,
    accuracy: (record.accuracy ?? 100) / 100,
    category: record.damageClass,
    statusEffect: toStatusEffect(record),
  };
}

function toStatusEffect(record: MoveRecord): MoveDefinition["statusEffect"] {
  const ailment = record.meta?.ailment;

  if (!isSupportedBattleStatus(ailment)) {
    return undefined;
  }

  const chancePercent = record.meta?.ailmentChance || record.effectChance || 0;

  if (chancePercent <= 0) {
    return undefined;
  }

  return {
    status: ailment,
    chance: clamp(chancePercent / 100, 0, 1),
  };
}

function isSupportedBattleStatus(value: string | null | undefined): value is BattleStatus {
  return (
    value === "burn" ||
    value === "poison" ||
    value === "paralysis" ||
    value === "sleep" ||
    value === "freeze"
  );
}

function buildMovePool(record: PokemonRecord): string[] {
  const learnset = record.learnsets[defaultLearnsetGroup] ?? {};
  const candidates = Object.values(learnset)
    .flat()
    .sort((left, right) => {
      const levelDiff = left[1] - right[1];
      return levelDiff === 0 ? (left[2] ?? 0) - (right[2] ?? 0) : levelDiff;
    })
    .map(([moveId]) => rawMovesByNumericId.get(moveId))
    .filter((move): move is MoveRecord => Boolean(move))
    .map((move) => move.identifier)
    .filter((identifier) => Boolean(movesById[identifier]));

  return [...new Set(candidates)].slice(0, 12);
}

function toTitleCase(identifier: string): string {
  return identifier
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
