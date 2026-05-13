import {
  getLevelUpMoveIds,
  getMove,
  getSpecies,
  getUnlockedLevelUpMoveIds,
  movesById,
  speciesCatalog,
} from "./data/catalog";
import { SeededRng, clamp } from "./rng";
import { scoreCreature } from "./scoring";
import type { Creature, GameBalance, MoveDefinition, SpeciesDefinition, Stats } from "./types";

export interface CreatureFactoryOptions {
  rng: SeededRng;
  wave: number;
  balance: GameBalance;
  speciesId?: number;
  level?: number;
  role: "starter" | "wild" | "trainer";
  rarityBoost?: number;
}

export function createCreature(options: CreatureFactoryOptions): Creature {
  const species = options.speciesId
    ? getSpecies(options.speciesId)
    : pickSpeciesForWave(options.rng, options.wave, options.balance, options.rarityBoost ?? 0);
  const level = normalizeLevel(options.level ?? options.wave);
  const moves = pickMoves(species, level, options.rng);
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
    weightHg: species.weightHg,
    level,
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
    moves: creature.moves.map(cloneMoveDefinition),
    status: creature.status ? { ...creature.status } : undefined,
    statStages: creature.statStages ? { ...creature.statStages } : undefined,
    volatile: creature.volatile ? { ...creature.volatile } : undefined,
  };
}

export function normalizeCreatureBattleLoadout(creature: Creature): Creature {
  const cloned = cloneCreature(creature);
  const level = resolveExistingCreatureLevel(cloned);
  const moves = normalizeCreatureMoves(cloned.speciesId, level, cloned.moves);

  return {
    ...cloned,
    level,
    moves,
    powerScore: scoreCreature({ stats: cloned.stats, moves, types: cloned.types }),
  };
}

export function normalizeCreatureMoves(
  speciesId: number,
  level: number,
  moves: readonly MoveDefinition[],
): MoveDefinition[] {
  const normalizedMoves = moves.map(cloneMoveDefinition);
  const attackCandidates = getMoveCandidates(speciesId, level, isAttackMove, "tackle");
  const supportCandidates = getMoveCandidates(speciesId, level, isSupportMove, "harden");
  const attack =
    normalizedMoves.find((move) => isMoveInCandidates(move, attackCandidates)) ??
    attackCandidates[0];
  const support =
    normalizedMoves.find((move) => isMoveInCandidates(move, supportCandidates)) ??
    supportCandidates[0];

  return [attack, support].map(cloneMoveDefinition);
}

export function healTeam(team: readonly Creature[]): Creature[] {
  return team.map((creature) => ({
    ...cloneCreature(creature),
    currentHp: creature.stats.hp,
  }));
}

function pickSpeciesForWave(
  rng: SeededRng,
  wave: number,
  balance: GameBalance,
  rarityBoost: number,
): SpeciesDefinition {
  const baseBudget = 1 + Math.floor(wave / balance.wildRarityBudgetWaveDivisor);
  const budgetBoost = rarityBoost > 0 ? Math.ceil(rarityBoost * 4) : 0;
  const rarityBudget = clamp(baseBudget + budgetBoost, 1, 8);
  const baseMaxTotal = balance.wildBaseStatBudgetBase + wave * balance.wildBaseStatBudgetPerWave;
  const maxBaseTotal = baseMaxTotal + Math.round(rarityBoost * 220);
  const candidates = speciesCatalog.filter((species) => {
    return species.rarity <= rarityBudget && getBaseStatTotal(species) <= maxBaseTotal;
  });
  const available = candidates.length > 0 ? candidates : speciesCatalog;
  const weighted = available.flatMap((species) => {
    const baseWeight = Math.max(1, 10 - species.rarity + Math.floor(wave / 5));
    const boostWeight =
      rarityBoost > 0 ? Math.max(0, Math.round(species.rarity * rarityBoost * 6)) : 0;
    const weight = baseWeight + boostWeight;
    return Array.from({ length: weight }, () => species);
  });

  return rng.pick(weighted);
}

function pickMoves(species: SpeciesDefinition, level: number, rng: SeededRng): MoveDefinition[] {
  const attacks = getMoveCandidates(species.id, level, isAttackMove, "tackle");
  const support = getMoveCandidates(species.id, level, isSupportMove, "harden");
  const attack = rng.pick(attacks);
  const utility = rng.pick(support);

  return [attack, utility].map(cloneMoveDefinition);
}

function getMoveCandidates(
  speciesId: number,
  level: number,
  predicate: (move: MoveDefinition) => boolean,
  fallbackMoveId: string,
): MoveDefinition[] {
  const unlocked = getUnlockedLevelUpMoveIds(speciesId, level).map((moveId) => getMove(moveId));
  const unlockedMatches = unlocked.filter(predicate);

  if (unlockedMatches.length > 0) {
    return unlockedMatches;
  }

  const levelUpMatches = getLevelUpMoveIds(speciesId)
    .map((moveId) => getMove(moveId))
    .filter(predicate);

  return levelUpMatches.length > 0 ? levelUpMatches : [getMove(fallbackMoveId)];
}

function isMoveInCandidates(move: MoveDefinition, candidates: readonly MoveDefinition[]): boolean {
  return candidates.some((candidate) => candidate.id === move.id);
}

function isAttackMove(move: MoveDefinition): boolean {
  return move.category !== "status";
}

function isSupportMove(move: MoveDefinition): boolean {
  return move.category === "status";
}

function cloneMoveDefinition(move: MoveDefinition): MoveDefinition {
  const catalogMove = movesById[move.id];
  const merged = catalogMove ? { ...catalogMove, ...move } : move;
  const mergedMove = merged as MoveDefinition & Partial<MoveDefinition>;

  return {
    ...merged,
    priority: mergedMove.priority ?? catalogMove?.priority ?? 0,
    flags: [...(mergedMove.flags ?? catalogMove?.flags ?? [])],
    statChanges: (mergedMove.statChanges ?? catalogMove?.statChanges ?? []).map((change) => ({
      ...change,
    })),
    meta: {
      ...createDefaultMoveMeta(),
      ...catalogMove?.meta,
      ...mergedMove.meta,
    },
    statusEffect: mergedMove.statusEffect
      ? { ...mergedMove.statusEffect }
      : catalogMove?.statusEffect
        ? { ...catalogMove.statusEffect }
        : undefined,
  };
}

function createDefaultMoveMeta(): MoveDefinition["meta"] {
  return {
    drain: 0,
    healing: 0,
    critRate: 0,
    ailmentChance: 0,
    flinchChance: 0,
    statChance: 0,
  };
}

function resolveExistingCreatureLevel(creature: Creature): number {
  if (typeof creature.level === "number") {
    return normalizeLevel(creature.level);
  }

  const statTotal =
    creature.stats.hp +
    creature.stats.attack +
    creature.stats.defense +
    creature.stats.special +
    creature.stats.speed;
  return normalizeLevel(Math.max(1, Math.round(statTotal / 18)));
}

function normalizeLevel(level: number): number {
  return clamp(Math.round(level), 1, 100);
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
