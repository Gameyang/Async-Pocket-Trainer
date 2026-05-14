import { createCreature, normalizeCreatureBattleLoadout } from "../creatureFactory";
import { getMove, getSpecies } from "../data/catalog";
import { formatWave } from "../localization";
import { scoreCreature, scoreTeam } from "../scoring";
import type { SeededRng } from "../rng";
import type {
  Creature,
  ElementType,
  EncounterSnapshot,
  GameBalance,
  RouteId,
  Stats,
} from "../types";
import type { TrainerSnapshot, TrainerSnapshotCreature } from "../sync/trainerSnapshot";

export interface EncounterBoostOptions {
  rarityBonus?: number;
  levelMin?: number;
  levelMax?: number;
  lockedType?: ElementType;
}

function resolveBoostWave(baseWave: number, rng: SeededRng, boost?: EncounterBoostOptions): number {
  const min = Math.max(0, boost?.levelMin ?? 0);
  const max = Math.max(min, boost?.levelMax ?? 0);

  if (max <= 0) {
    return baseWave;
  }

  const offset = min + Math.floor(rng.nextFloat() * (max - min + 1));
  return Math.max(1, baseWave + offset);
}

export function createWildEncounter(
  wave: number,
  rng: SeededRng,
  balance: GameBalance,
  routeId: RouteId = "normal",
  boost?: EncounterBoostOptions,
): EncounterSnapshot {
  const effectiveWave = resolveBoostWave(wave, rng, boost);
  const creature = applyRouteToCreature(
    createCreature({
      rng,
      wave: effectiveWave,
      balance,
      role: "wild",
      rarityBoost: boost?.rarityBonus ?? 0,
      lockedType: boost?.lockedType,
    }),
    routeId,
    balance,
  );

  return {
    kind: "wild",
    source: "generated",
    routeId,
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
): EncounterSnapshot {
  const effectiveWave = resolveBoostWave(wave, rng, boost);
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
    wave,
    opponentName: `${routeLabel(routeId)}${formatWave(wave)} 트레이너 (${scoreTeam(team)})`,
    enemyTeam: team,
  };
}

export function createTrainerEncounterFromSnapshot(
  snapshot: TrainerSnapshot,
  balance: GameBalance,
  routeId: RouteId = "normal",
): EncounterSnapshot {
  const team = snapshot.team.map((creature) =>
    applyRouteToCreature(snapshotCreatureToCreature(creature), routeId, balance),
  );

  return {
    kind: "trainer",
    source: "sheet",
    routeId,
    wave: snapshot.wave,
    opponentName: `${routeLabel(routeId)}${snapshot.trainerName} 기록 (${scoreTeam(team)})`,
    enemyTeam: team,
  };
}

export function createEncounter(
  wave: number,
  rng: SeededRng,
  balance: GameBalance,
  routeId: RouteId = "normal",
  boost?: EncounterBoostOptions,
): EncounterSnapshot {
  return wave % balance.checkpointInterval === 0
    ? createTrainerEncounter(wave, rng, balance, routeId, boost)
    : createWildEncounter(wave, rng, balance, routeId, boost);
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

  const stats = scaleStats(creature.stats, balance.eliteStatMultiplier);
  const powerScore = scoreCreature({ stats, moves: creature.moves, types: creature.types });

  return {
    ...creature,
    stats,
    currentHp: stats.hp,
    rarityScore: Math.round(creature.rarityScore * balance.eliteStatMultiplier),
    powerScore,
  };
}

function scaleStats(stats: Stats, multiplier: number): Stats {
  const scale = (value: number) => Math.max(1, Math.round(value * multiplier));

  return {
    hp: scale(stats.hp),
    attack: scale(stats.attack),
    defense: scale(stats.defense),
    special: scale(stats.special),
    speed: scale(stats.speed),
  };
}

function routeLabel(routeId: RouteId): string {
  return routeId === "elite" ? "정예 " : "";
}
