import { createCreature } from "../creatureFactory";
import { getMove, getSpecies } from "../data/catalog";
import { formatWave } from "../localization";
import { scoreTeam } from "../scoring";
import type { SeededRng } from "../rng";
import type { Creature, EncounterSnapshot, GameBalance } from "../types";
import type { TrainerSnapshot, TrainerSnapshotCreature } from "../sync/trainerSnapshot";

export function createWildEncounter(
  wave: number,
  rng: SeededRng,
  balance: GameBalance,
): EncounterSnapshot {
  const creature = createCreature({ rng, wave, balance, role: "wild" });

  return {
    kind: "wild",
    source: "generated",
    wave,
    opponentName: `야생 ${creature.speciesName}`,
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
    1 +
      Math.floor((wave - 1) / (balance.checkpointInterval * balance.trainerTeamSizeCheckpointSpan)),
  );
  const team = Array.from({ length: teamSize }, () =>
    createCreature({ rng, wave, balance, role: "trainer" }),
  );

  return {
    kind: "trainer",
    source: "generated",
    wave,
    opponentName: `${formatWave(wave)} 트레이너 (${scoreTeam(team)})`,
    enemyTeam: team,
  };
}

export function createTrainerEncounterFromSnapshot(snapshot: TrainerSnapshot): EncounterSnapshot {
  const team = snapshot.team.map(snapshotCreatureToCreature);

  return {
    kind: "trainer",
    source: "sheet",
    wave: snapshot.wave,
    opponentName: `${snapshot.trainerName} 기록 (${snapshot.teamPower})`,
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

function snapshotCreatureToCreature(creature: TrainerSnapshotCreature): Creature {
  const species = getSpecies(creature.speciesId);

  return {
    instanceId: creature.creatureId,
    speciesId: creature.speciesId,
    speciesName: creature.speciesName,
    types: [...species.types],
    stats: { ...creature.stats },
    currentHp: Math.min(creature.currentHp, creature.stats.hp),
    moves: creature.moves.map((moveId) => getMove(moveId)),
    rarityScore: creature.rarityScore,
    powerScore: creature.powerScore,
    captureRate: species.captureRate,
  };
}
