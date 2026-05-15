import {
  createCreature,
  normalizeCreatureBattleLoadout,
  rerollCreatureStatProfile,
} from "../creatureFactory";
import { resolveBattleFieldForWave } from "../battleField";
import { getMove, getSpecies } from "../data/catalog";
import { formatWave } from "../localization";
import { scoreTeam } from "../scoring";
import type { SeededRng } from "../rng";
import type {
  BattleFieldId,
  Creature,
  ElementType,
  EncounterSnapshot,
  GameBalance,
  RouteId,
} from "../types";
import type { TrainerSnapshot, TrainerSnapshotCreature } from "../sync/trainerSnapshot";
import { createOpponentTeamContext } from "../sync/teamBattleRecord";

export interface EncounterBoostOptions {
  rarityBonus?: number;
  levelMin?: number;
  levelMax?: number;
  lockedType?: ElementType;
}

const OPENING_WILD_LEVEL_MIN = 4;
const OPENING_WILD_LEVEL_MAX = 5;

function resolveBoostWave(baseWave: number, rng: SeededRng, boost?: EncounterBoostOptions): number {
  return resolveBoostedLevel(baseWave, rng, boost);
}

function resolveBoostedLevel(
  baseLevel: number,
  rng: SeededRng,
  boost?: EncounterBoostOptions,
): number {
  const min = Math.max(0, boost?.levelMin ?? 0);
  const max = Math.max(min, boost?.levelMax ?? 0);

  if (max <= 0) {
    return baseLevel;
  }

  const offset = min + Math.floor(rng.nextFloat() * (max - min + 1));
  return Math.max(1, baseLevel + offset);
}

function resolveWildBaseLevel(wave: number, rng: SeededRng): number {
  if (wave >= OPENING_WILD_LEVEL_MAX) {
    return wave;
  }

  const openingLevel = rng.int(OPENING_WILD_LEVEL_MIN, OPENING_WILD_LEVEL_MAX);
  return Math.max(wave, openingLevel);
}

export function createWildEncounter(
  wave: number,
  rng: SeededRng,
  balance: GameBalance,
  routeId: RouteId = "normal",
  boost?: EncounterBoostOptions,
  battleFieldOrder?: readonly BattleFieldId[],
): EncounterSnapshot {
  const level = resolveBoostedLevel(resolveWildBaseLevel(wave, rng), rng, boost);
  const battleField = resolveBattleFieldForWave(wave, battleFieldOrder);
  const creature = applyRouteToCreature(
    createCreature({
      rng,
      wave,
      level,
      balance,
      role: "wild",
      rarityBoost: boost?.rarityBonus ?? 0,
      lockedType: boost?.lockedType,
      preferredType: battleField.element,
    }),
    routeId,
    balance,
  );

  return {
    kind: "wild",
    source: "generated",
    routeId,
    battleField,
    wave,
    opponentName: `${routeLabel(routeId)}야생 ${creature.speciesName}`,
    enemyTeam: [creature],
  };
}

export function createTrainerEncounter(
  wave: number,
  rng: SeededRng,
  balance: GameBalance,
  routeId: RouteId = "normal",
  boost?: EncounterBoostOptions,
  battleFieldOrder?: readonly BattleFieldId[],
): EncounterSnapshot {
  const effectiveWave = resolveBoostWave(wave, rng, boost);
  const battleField = resolveBattleFieldForWave(wave, battleFieldOrder);
  const checkpointCount = Math.max(1, Math.floor(effectiveWave / balance.checkpointInterval));
  const teamSize = Math.min(
    balance.maxTeamSize,
    1 + Math.floor(checkpointCount * balance.checkpointTeamSizeGrowthPerCheckpoint),
  );
  const team = Array.from({ length: teamSize }, () =>
    applyRouteToCreature(
      createCreature({
        rng,
        wave: effectiveWave,
        balance,
        role: "trainer",
        rarityBoost: boost?.rarityBonus ?? 0,
      }),
      routeId,
      balance,
    ),
  );

  return {
    kind: "trainer",
    source: "generated",
    routeId,
    battleField,
    wave,
    opponentName: `${routeLabel(routeId)}${formatWave(wave)} 트레이너 (${scoreTeam(team)})`,
    enemyTeam: team,
  };
}

export function createTrainerEncounterFromSnapshot(
  snapshot: TrainerSnapshot,
  balance: GameBalance,
  routeId: RouteId = "normal",
  battleFieldOrder?: readonly BattleFieldId[],
): EncounterSnapshot {
  const team = snapshot.team.map((creature) =>
    applyRouteToCreature(snapshotCreatureToCreature(creature), routeId, balance),
  );
  const battleField = resolveBattleFieldForWave(snapshot.wave, battleFieldOrder);

  return {
    kind: "trainer",
    source: "sheet",
    routeId,
    battleField,
    wave: snapshot.wave,
    opponentName: `${routeLabel(routeId)}${snapshot.trainerName} 기록 (${scoreTeam(team)})`,
    opponentTeam: createOpponentTeamContext(snapshot, scoreTeam(team)),
    enemyTeam: team,
  };
}

export function createEncounter(
  wave: number,
  rng: SeededRng,
  balance: GameBalance,
  routeId: RouteId = "normal",
  boost?: EncounterBoostOptions,
  battleFieldOrder?: readonly BattleFieldId[],
): EncounterSnapshot {
  return wave % balance.checkpointInterval === 0
    ? createTrainerEncounter(wave, rng, balance, routeId, boost, battleFieldOrder)
    : createWildEncounter(wave, rng, balance, routeId, boost, battleFieldOrder);
}

export function calculateReward(
  wave: number,
  kind: EncounterSnapshot["kind"],
  balance: GameBalance,
  routeId: RouteId = "normal",
): number {
  const trainerBonus = kind === "trainer" ? balance.trainerRewardBonus : 0;
  const routeBonus = routeId === "elite" ? balance.eliteRewardBonus : 0;
  return balance.rewardBase + wave * balance.rewardPerWave + trainerBonus + routeBonus;
}

export function calculateRestCost(wave: number, balance: GameBalance): number {
  return Math.max(
    0,
    Math.round(balance.teamRestCost + Math.max(0, wave - 1) * balance.restCostPerWave),
  );
}

export function replaceTeamAfterCapture(
  team: readonly Creature[],
  captured: Creature,
  maxTeamSize: number,
  replaceIndex?: number,
): Creature[] {
  if (team.length < maxTeamSize) {
    return [...team, captured];
  }

  if (replaceIndex === undefined) {
    return [...team];
  }

  return team.map((creature, index) => (index === replaceIndex ? captured : creature));
}

function snapshotCreatureToCreature(creature: TrainerSnapshotCreature): Creature {
  const species = getSpecies(creature.speciesId);

  return normalizeCreatureBattleLoadout({
    instanceId: creature.creatureId,
    speciesId: creature.speciesId,
    speciesName: creature.speciesName,
    types: [...species.types],
    level: creature.level,
    statProfile: creature.statProfile
      ? {
          dvs: { ...creature.statProfile.dvs },
          statExp: { ...creature.statProfile.statExp },
        }
      : undefined,
    statBonuses: creature.statBonuses ? { ...creature.statBonuses } : undefined,
    stats: { ...creature.stats },
    currentHp: creature.stats.hp,
    moves: creature.moves.map((moveId) => getMove(moveId)),
    rarityScore: creature.rarityScore,
    powerScore: creature.powerScore,
    captureRate: species.captureRate,
  });
}

function applyRouteToCreature(
  creature: Creature,
  routeId: RouteId,
  balance: GameBalance,
): Creature {
  if (routeId !== "elite") {
    return creature;
  }

  const elite = rerollCreatureStatProfile(
    creature,
    `elite:${creature.instanceId}:${creature.level ?? 1}`,
    "elite",
  );

  return {
    ...elite,
    currentHp: elite.stats.hp,
    rarityScore: Math.round(elite.rarityScore * balance.eliteStatMultiplier),
  };
}

function routeLabel(routeId: RouteId): string {
  return routeId === "elite" ? "정예 " : "";
}
