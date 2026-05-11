import type { Creature } from "./types";

export function scoreCreature(creature: Pick<Creature, "stats" | "moves" | "types">): number {
  const statScore =
    creature.stats.hp * 0.85 +
    creature.stats.attack +
    creature.stats.defense * 0.82 +
    creature.stats.special +
    creature.stats.speed * 0.9;
  const moveScore = creature.moves
    .map((move) => move.power * move.accuracy * (creature.types.includes(move.type) ? 1.14 : 1))
    .sort((left, right) => right - left)
    .slice(0, 4)
    .reduce((total, value) => total + value, 0);

  return Math.round(statScore + moveScore * 0.62);
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

  return candidate.powerScore > team[weakestIndex].powerScore ? weakestIndex : undefined;
}
