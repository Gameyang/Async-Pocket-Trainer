import { cloneCreature } from "../creatureFactory";
import { calculateDamage, estimateDamage } from "./damage";
import type { SeededRng } from "../rng";
import type {
  BattleLogEntry,
  BattleResult,
  Creature,
  EncounterKind,
  MoveDefinition,
} from "../types";

export interface AutoBattleOptions {
  kind: EncounterKind;
  playerTeam: readonly Creature[];
  enemyTeam: readonly Creature[];
  rng: SeededRng;
  maxTurns?: number;
}

export function runAutoBattle(options: AutoBattleOptions): BattleResult {
  const playerTeam = options.playerTeam.map(cloneCreature);
  const enemyTeam = options.enemyTeam.map(cloneCreature);
  const log: BattleLogEntry[] = [];
  const maxTurns = options.maxTurns ?? 160;
  let turns = 0;

  while (hasLivingCreature(playerTeam) && hasLivingCreature(enemyTeam) && turns < maxTurns) {
    turns += 1;
    const player = getActiveCreature(playerTeam);
    const enemy = getActiveCreature(enemyTeam);

    if (!player || !enemy) {
      break;
    }

    const playerFirst =
      player.stats.speed === enemy.stats.speed
        ? options.rng.chance(0.5)
        : player.stats.speed > enemy.stats.speed;
    const order = playerFirst
      ? [
          { actor: player, targetTeam: enemyTeam, side: "player" as const },
          { actor: enemy, targetTeam: playerTeam, side: "enemy" as const },
        ]
      : [
          { actor: enemy, targetTeam: playerTeam, side: "enemy" as const },
          { actor: player, targetTeam: enemyTeam, side: "player" as const },
        ];

    for (const action of order) {
      const target = getActiveCreature(action.targetTeam);

      if (action.actor.currentHp <= 0 || !target) {
        continue;
      }

      const move = chooseMove(action.actor, target);
      const missed = !options.rng.chance(move.accuracy);
      let damage = 0;
      let effectiveness = 1;
      let critical = false;

      if (!missed) {
        const result = calculateDamage(action.actor, target, move, options.rng);
        damage = Math.min(target.currentHp, result.damage);
        effectiveness = result.effectiveness;
        critical = result.critical;
        target.currentHp = Math.max(0, target.currentHp - damage);
      }

      log.push({
        turn: turns,
        actor: action.actor.speciesName,
        target: target.speciesName,
        move: move.name,
        damage,
        effectiveness,
        critical,
        missed,
        targetRemainingHp: target.currentHp,
      });
    }
  }

  const winner = resolveWinner(playerTeam, enemyTeam);

  return {
    kind: options.kind,
    winner,
    turns,
    playerTeam,
    enemyTeam,
    log,
  };
}

function chooseMove(attacker: Creature, defender: Creature): MoveDefinition {
  return attacker.moves.reduce((best, move) => {
    return estimateDamage(attacker, defender, move) > estimateDamage(attacker, defender, best)
      ? move
      : best;
  }, attacker.moves[0]);
}

function hasLivingCreature(team: readonly Creature[]): boolean {
  return team.some((creature) => creature.currentHp > 0);
}

function getActiveCreature(team: readonly Creature[]): Creature | undefined {
  return team.find((creature) => creature.currentHp > 0);
}

function resolveWinner(
  playerTeam: readonly Creature[],
  enemyTeam: readonly Creature[],
): "player" | "enemy" {
  const playerHp = playerTeam.reduce((total, creature) => total + creature.currentHp, 0);
  const enemyHp = enemyTeam.reduce((total, creature) => total + creature.currentHp, 0);

  return playerHp >= enemyHp ? "player" : "enemy";
}
