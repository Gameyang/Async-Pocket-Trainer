import { cloneCreature } from "../creatureFactory";
import { calculateDamage, estimateDamage } from "./damage";
import type { SeededRng } from "../rng";
import type {
  BattleStatus,
  BattleStatusState,
  BattleLogEntry,
  BattleReplayEvent,
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
  damageScale?: number;
  maxTurns?: number;
}

type BattleReplayEventInput = BattleReplayEvent extends infer Event
  ? Event extends BattleReplayEvent
    ? Omit<Event, "sequence">
    : never
  : never;

export function runAutoBattle(options: AutoBattleOptions): BattleResult {
  const playerTeam = options.playerTeam.map(cloneCreature);
  const enemyTeam = options.enemyTeam.map(cloneCreature);
  const log: BattleLogEntry[] = [];
  const replay: BattleReplayEvent[] = [];
  const maxTurns = options.maxTurns ?? 160;
  let nextReplaySequence = 1;
  let turns = 0;
  const pushReplay = (event: BattleReplayEventInput) => {
    replay.push({
      sequence: nextReplaySequence,
      ...event,
    });
    nextReplaySequence += 1;
  };

  pushReplay({
    type: "battle.start",
    turn: 0,
    kind: options.kind,
    playerTeamIds: playerTeam.map((creature) => creature.instanceId),
    enemyTeamIds: enemyTeam.map((creature) => creature.instanceId),
  });

  while (hasLivingCreature(playerTeam) && hasLivingCreature(enemyTeam) && turns < maxTurns) {
    turns += 1;
    const player = getActiveCreature(playerTeam);
    const enemy = getActiveCreature(enemyTeam);

    if (!player || !enemy) {
      break;
    }

    pushReplay({
      type: "turn.start",
      turn: turns,
      activePlayerId: player.instanceId,
      activeEnemyId: enemy.instanceId,
    });

    const playerFirst =
      getEffectiveSpeed(player) === getEffectiveSpeed(enemy)
        ? options.rng.chance(0.5)
        : getEffectiveSpeed(player) > getEffectiveSpeed(enemy);
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

      if (resolveStatusSkip(action.actor, action.side, turns, options.rng, pushReplay)) {
        continue;
      }

      const move = chooseMove(action.actor, target, options.damageScale);
      const missed = !options.rng.chance(move.accuracy);
      let damage = 0;
      let effectiveness = 1;
      let critical = false;
      const targetHpBefore = target.currentHp;
      const targetSide = action.side === "player" ? "enemy" : "player";

      pushReplay({
        type: "move.select",
        turn: turns,
        actorId: action.actor.instanceId,
        actorSide: action.side,
        targetId: target.instanceId,
        targetSide,
        move: move.name,
      });

      if (!missed) {
        const result = calculateDamage(
          action.actor,
          target,
          move,
          options.rng,
          options.damageScale,
        );
        damage = Math.min(target.currentHp, result.damage);
        effectiveness = result.effectiveness;
        critical = result.critical;
        target.currentHp = Math.max(0, target.currentHp - damage);

        pushReplay({
          type: "damage.apply",
          turn: turns,
          actorId: action.actor.instanceId,
          targetId: target.instanceId,
          move: move.name,
          damage,
          effectiveness,
          critical,
          targetHpBefore,
          targetHpAfter: target.currentHp,
        });

        applyMoveStatus(action.actor, target, move, turns, options.rng, pushReplay);
      } else {
        pushReplay({
          type: "move.miss",
          turn: turns,
          actorId: action.actor.instanceId,
          targetId: target.instanceId,
          move: move.name,
        });
      }

      if (target.currentHp <= 0 && targetHpBefore > 0) {
        pushReplay({
          type: "creature.faint",
          turn: turns,
          entityId: target.instanceId,
          side: targetSide,
        });
      }

      log.push({
        turn: turns,
        actorId: action.actor.instanceId,
        actor: action.actor.speciesName,
        actorSide: action.side,
        targetId: target.instanceId,
        target: target.speciesName,
        targetSide,
        move: move.name,
        damage,
        effectiveness,
        critical,
        missed,
        targetRemainingHp: target.currentHp,
      });
    }

    applyResidualStatus(playerTeam, "player", turns, pushReplay);
    applyResidualStatus(enemyTeam, "enemy", turns, pushReplay);
  }

  const winner = resolveWinner(playerTeam, enemyTeam);
  pushReplay({
    type: "battle.end",
    turn: turns,
    winner,
    playerRemainingHp: getTeamHp(playerTeam),
    enemyRemainingHp: getTeamHp(enemyTeam),
  });

  return {
    kind: options.kind,
    winner,
    turns,
    playerTeam: clearBattleStatuses(playerTeam),
    enemyTeam: clearBattleStatuses(enemyTeam),
    log,
    replay,
  };
}

function chooseMove(attacker: Creature, defender: Creature, damageScale?: number): MoveDefinition {
  return attacker.moves.reduce((best, move) => {
    return estimateDamage(attacker, defender, move, damageScale) >
      estimateDamage(attacker, defender, best, damageScale)
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

function resolveStatusSkip(
  actor: Creature,
  side: "player" | "enemy",
  turn: number,
  rng: SeededRng,
  pushReplay: (event: BattleReplayEventInput) => void,
): boolean {
  const status = actor.status;

  if (!status) {
    return false;
  }

  if (status.type === "paralysis") {
    if (!rng.chance(0.25)) {
      return false;
    }

    pushReplay({
      type: "turn.skip",
      turn,
      entityId: actor.instanceId,
      side,
      status: status.type,
      reason: "Fully paralyzed.",
    });
    return true;
  }

  if (status.type !== "sleep" && status.type !== "freeze") {
    return false;
  }

  const remainingTurns = status.turnsRemaining ?? 1;
  pushReplay({
    type: "turn.skip",
    turn,
    entityId: actor.instanceId,
    side,
    status: status.type,
    reason: status.type === "sleep" ? "Asleep." : "Frozen.",
  });

  if (remainingTurns <= 1) {
    actor.status = undefined;
    pushReplay({
      type: "status.clear",
      turn,
      entityId: actor.instanceId,
      side,
      status: status.type,
    });
  } else {
    actor.status = {
      ...status,
      turnsRemaining: remainingTurns - 1,
    };
  }

  return true;
}

function applyMoveStatus(
  actor: Creature,
  target: Creature,
  move: MoveDefinition,
  turn: number,
  rng: SeededRng,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const effect = move.statusEffect;

  if (!effect || target.currentHp <= 0 || target.status) {
    return;
  }

  if (!rng.chance(effect.chance)) {
    return;
  }

  if (isStatusImmune(target, effect.status)) {
    pushReplay({
      type: "status.immune",
      turn,
      actorId: actor.instanceId,
      targetId: target.instanceId,
      move: move.name,
      status: effect.status,
    });
    return;
  }

  target.status = createStatusState(effect.status, rng);
  pushReplay({
    type: "status.apply",
    turn,
    actorId: actor.instanceId,
    targetId: target.instanceId,
    move: move.name,
    status: target.status.type,
    turnsRemaining: target.status.turnsRemaining,
  });
}

function applyResidualStatus(
  team: readonly Creature[],
  side: "player" | "enemy",
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const creature = getActiveCreature(team);
  const status = creature?.status?.type;

  if (!creature || (status !== "burn" && status !== "poison")) {
    return;
  }

  const hpBefore = creature.currentHp;
  const damageRatio = status === "poison" ? 0.125 : 0.0625;
  const damage = Math.min(hpBefore, Math.max(1, Math.floor(creature.stats.hp * damageRatio)));
  creature.currentHp = Math.max(0, hpBefore - damage);

  pushReplay({
    type: "status.tick",
    turn,
    entityId: creature.instanceId,
    side,
    status,
    damage,
    hpBefore,
    hpAfter: creature.currentHp,
  });

  if (creature.currentHp <= 0 && hpBefore > 0) {
    pushReplay({
      type: "creature.faint",
      turn,
      entityId: creature.instanceId,
      side,
    });
  }
}

function createStatusState(status: BattleStatus, rng: SeededRng): BattleStatusState {
  if (status === "sleep" || status === "freeze") {
    return {
      type: status,
      turnsRemaining: rng.int(1, 3),
    };
  }

  return { type: status };
}

function isStatusImmune(target: Creature, status: BattleStatus): boolean {
  if (status === "burn") {
    return target.types.includes("fire");
  }

  if (status === "poison") {
    return target.types.includes("poison") || target.types.includes("steel");
  }

  if (status === "paralysis") {
    return target.types.includes("electric");
  }

  if (status === "freeze") {
    return target.types.includes("ice");
  }

  return false;
}

function getEffectiveSpeed(creature: Creature): number {
  return creature.status?.type === "paralysis"
    ? Math.max(1, Math.floor(creature.stats.speed * 0.5))
    : creature.stats.speed;
}

function clearBattleStatuses(team: readonly Creature[]): Creature[] {
  return team.map((creature) => ({
    ...creature,
    status: undefined,
  }));
}

function resolveWinner(
  playerTeam: readonly Creature[],
  enemyTeam: readonly Creature[],
): "player" | "enemy" {
  const playerHp = getTeamHp(playerTeam);
  const enemyHp = getTeamHp(enemyTeam);

  return playerHp >= enemyHp ? "player" : "enemy";
}

function getTeamHp(team: readonly Creature[]): number {
  return team.reduce((total, creature) => total + creature.currentHp, 0);
}
