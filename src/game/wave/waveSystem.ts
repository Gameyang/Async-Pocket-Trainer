import { createCreature } from "../creatureFactory";
import { scoreTeam } from "../scoring";
import type { SeededRng } from "../rng";
import type { Creature, EncounterSnapshot, GameBalance } from "../types";

export function createWildEncounter(
  wave: number,
  rng: SeededRng,
  balance: GameBalance,
): EncounterSnapshot {
  const creature = createCreature({ rng, wave, balance, role: "wild" });

  return {
    kind: "wild",
    wave,
    opponentName: `Wild ${creature.speciesName}`,
    enemyTeam: [creature],
  };
}

export function createTrainerEncounter(
  wave: number,
  rng: SeededRng,
  balance: GameBalance,
): EncounterSnapshot {
  const teamSize = Math.min(
    balance.maxTeamSize,
    1 + Math.floor((wave - 1) / balance.checkpointInterval),
  );
  const team = Array.from({ length: teamSize }, () =>
    createCreature({ rng, wave, balance, role: "trainer" }),
  );

  return {
    kind: "trainer",
    wave,
    opponentName: `Wave ${wave} Trainer (${scoreTeam(team)})`,
    enemyTeam: team,
  };
}

export function createEncounter(
  wave: number,
  rng: SeededRng,
  balance: GameBalance,
): EncounterSnapshot {
  return wave % balance.checkpointInterval === 0
    ? createTrainerEncounter(wave, rng, balance)
    : createWildEncounter(wave, rng, balance);
}

export function calculateReward(
  wave: number,
  kind: EncounterSnapshot["kind"],
  balance: GameBalance,
): number {
  const trainerBonus = kind === "trainer" ? balance.trainerRewardBonus : 0;
  return balance.rewardBase + wave * balance.rewardPerWave + trainerBonus;
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
