import {
  getLevelUpMoveIds,
  getMove,
  getSpecies,
  getUnlockedLevelUpMoveIds,
  movesById,
  speciesCatalog,
} from "./data/catalog";
import { SeededRng, clamp } from "./rng";
import {
  calculatePokemonStats,
  createEmptyStats,
  createPokemonStatProfile,
  normalizeLevel,
  normalizePokemonStatProfile,
  normalizeStatBonuses,
  type StatProfileRole,
} from "./pokemonStats";
import { scoreCreature } from "./scoring";
import type {
  Creature,
  ElementType,
  GameBalance,
  MoveDefinition,
  SpeciesDefinition,
  Stats,
} from "./types";

export interface CreatureFactoryOptions {
  rng: SeededRng;
  wave: number;
  balance: GameBalance;
  speciesId?: number;
  level?: number;
  role: "starter" | "wild" | "trainer";
  rarityBoost?: number;
  lockedType?: ElementType;
  preferredType?: ElementType;
}

export function createCreature(options: CreatureFactoryOptions): Creature {
  const species = options.speciesId
    ? getSpecies(options.speciesId)
    : pickSpeciesForWave(
        options.rng,
        options.wave,
        options.balance,
        options.rarityBoost ?? 0,
        options.lockedType,
        options.preferredType,
      );
  const level = normalizeLevel(options.level ?? options.wave);
  const moves = pickMoves(species, level, options.rng);
  const statProfile = createPokemonStatProfile({
    seed: createStatProfileSeed(options, species.id, level),
    speciesId: species.id,
    level,
    role: options.role,
  });
  const statBonuses = createEmptyStats();
  const stats = calculatePokemonStats(species.baseStats, level, statProfile, statBonuses);
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
    statProfile,
    statBonuses,
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
    statProfile: creature.statProfile
      ? {
          dvs: { ...creature.statProfile.dvs },
          statExp: { ...creature.statProfile.statExp },
        }
      : undefined,
    statBonuses: creature.statBonuses ? { ...creature.statBonuses } : undefined,
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
  const normalized = recalculateCreatureStats({
    ...cloned,
    level,
    moves,
  });

  return {
    ...normalized,
    moves,
    powerScore: scoreCreature({ stats: normalized.stats, moves, types: normalized.types }),
  };
}

export function recalculateCreatureStats(creature: Creature): Creature {
  const cloned = cloneCreature(creature);
  const level = resolveExistingCreatureLevel(cloned);
  const species = getSpecies(cloned.speciesId);
  const statProfile = normalizePokemonStatProfile(
    cloned.statProfile ??
      createPokemonStatProfile({
        seed: `legacy:${cloned.instanceId}:${cloned.speciesId}`,
        speciesId: cloned.speciesId,
        level,
        role: "trainer",
      }),
  );
  const statBonuses = normalizeStatBonuses(cloned.statBonuses);
  const oldMaxHp = Math.max(1, cloned.stats.hp);
  const hpRatio = cloned.currentHp <= 0 ? 0 : clamp(cloned.currentHp / oldMaxHp, 0, 1);
  const stats = calculatePokemonStats(species.baseStats, level, statProfile, statBonuses);
  const currentHp =
    hpRatio <= 0 ? 0 : Math.max(1, Math.min(stats.hp, Math.round(stats.hp * hpRatio)));

  return {
    ...cloned,
    level,
    statProfile,
    statBonuses,
    stats,
    currentHp,
    powerScore: scoreCreature({ stats, moves: cloned.moves, types: cloned.types }),
  };
}

export function applyCreatureStatBonus(
  creature: Creature,
  stat: keyof Stats,
  bonus: number,
): Creature {
  const oldCurrentHp = creature.currentHp;
  const statBonuses = normalizeStatBonuses({
    ...creature.statBonuses,
    [stat]: (creature.statBonuses?.[stat] ?? 0) + Math.max(0, Math.round(bonus)),
  });
  const updated = recalculateCreatureStats({
    ...creature,
    statBonuses,
  });

  return stat === "hp"
    ? {
        ...updated,
        currentHp: Math.min(updated.stats.hp, oldCurrentHp + Math.max(0, Math.round(bonus))),
      }
    : updated;
}

export function rerollCreatureStatProfile(
  creature: Creature,
  seed: string,
  role: StatProfileRole = "trainer",
): Creature {
  const level = resolveExistingCreatureLevel(creature);

  return recalculateCreatureStats({
    ...creature,
    statProfile: createPokemonStatProfile({
      seed,
      speciesId: creature.speciesId,
      level,
      role,
    }),
  });
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
  lockedType?: ElementType,
  preferredType?: ElementType,
): SpeciesDefinition {
  const baseBudget = 1 + Math.floor(wave / balance.wildRarityBudgetWaveDivisor);
  const budgetBoost = rarityBoost > 0 ? Math.ceil(rarityBoost * 4) : 0;
  const rarityBudget = clamp(baseBudget + budgetBoost, 1, 8);
  const baseMaxTotal = balance.wildBaseStatBudgetBase + wave * balance.wildBaseStatBudgetPerWave;
  const maxBaseTotal = baseMaxTotal + Math.round(rarityBoost * 220);
  const matchesType = (species: SpeciesDefinition) =>
    !lockedType || species.types.includes(lockedType);
  const budgetCandidates = speciesCatalog.filter((species) => {
    return (
      species.rarity <= rarityBudget &&
      getBaseStatTotal(species) <= maxBaseTotal &&
      matchesType(species)
    );
  });
  const typeCandidates = lockedType
    ? speciesCatalog.filter((species) => species.types.includes(lockedType))
    : [];
  const available =
    budgetCandidates.length > 0
      ? budgetCandidates
      : typeCandidates.length > 0
        ? typeCandidates
        : speciesCatalog;
  const weighted = available.flatMap((species) => {
    const baseWeight = Math.max(1, 10 - species.rarity + Math.floor(wave / 5));
    const boostWeight =
      rarityBoost > 0 ? Math.max(0, Math.round(species.rarity * rarityBoost * 6)) : 0;
    const fieldMultiplier =
      preferredType && species.types.includes(preferredType)
        ? Math.max(1, Math.round(balance.battleFieldTypeWeightMultiplier))
        : 1;
    const weight = (baseWeight + boostWeight) * fieldMultiplier;
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

function getBaseStatTotal(species: SpeciesDefinition): number {
  return (
    species.baseStats.hp +
    species.baseStats.attack +
    species.baseStats.defense +
    species.baseStats.special +
    species.baseStats.speed
  );
}

function createStatProfileSeed(
  options: CreatureFactoryOptions,
  speciesId: number,
  level: number,
): string {
  return `${speciesId}:${options.wave}:${level}:${options.role}:${options.rng.getState()}`;
}
