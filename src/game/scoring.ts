import type { AutoPlayStrategy, Creature } from "./types";

export function scoreCreature(creature: Pick<Creature, "stats" | "moves" | "types">): number {
  const statScore =
    creature.stats.hp * 0.9 +
    creature.stats.attack * 1.05 +
    creature.stats.defense * 0.86 +
    creature.stats.special * 1.05 +
    creature.stats.speed * 0.96;
  const moveScores = creature.moves
    .map((move) => move.power * move.accuracy * (creature.types.includes(move.type) ? 1.16 : 1))
    .sort((left, right) => right - left)
    .slice(0, 4);
  const moveWeights = [0.82, 0.48, 0.34, 0.24];
  const moveScore = moveScores.reduce(
    (total, value, index) => total + value * moveWeights[index],
    0,
  );
  const bestMoveScore = moveScores[0] ?? 0;
  const offensiveCeiling = Math.max(creature.stats.attack, creature.stats.special);
  const ceilingBonus =
    Math.max(0, offensiveCeiling - 70) * 0.55 + Math.max(0, creature.stats.speed - 70) * 0.35;
  const premiumMoveBonus = Math.max(0, bestMoveScore - 70) * 0.45;
  const coverageBonus = Math.min(3, new Set(creature.moves.map((move) => move.type)).size) * 8;

  return Math.round(statScore + moveScore + ceilingBonus + premiumMoveBonus + coverageBonus);
}

export function scoreTeam(team: readonly Creature[]): number {
  return team.reduce((total, creature) => total + creature.powerScore, 0);
}

export function getTeamHealthRatio(team: readonly Creature[]): number {
  const maxHp = team.reduce((total, creature) => total + creature.stats.hp, 0);

  if (maxHp === 0) {
    return 0;
  }

  return team.reduce((total, creature) => total + Math.max(0, creature.currentHp), 0) / maxHp;
}

export function chooseReplacementIndex(
  team: readonly Creature[],
  candidate: Creature,
  strategy: AutoPlayStrategy = "greedy",
): number | undefined {
  if (team.length === 0) {
    return undefined;
  }

  let weakestIndex = 0;

  for (let index = 1; index < team.length; index += 1) {
    if (team[index].powerScore < team[weakestIndex].powerScore) {
      weakestIndex = index;
    }
  }

  return shouldReplaceByPower(team[weakestIndex].powerScore, candidate.powerScore, strategy)
    ? weakestIndex
    : undefined;
}

export function shouldReplaceByPower(
  weakestPower: number,
  candidatePower: number,
  strategy: AutoPlayStrategy = "greedy",
): boolean {
  if (strategy === "conserveBalls") {
    return candidatePower > Math.ceil(weakestPower * 1.08);
  }

  return candidatePower > weakestPower;
}
