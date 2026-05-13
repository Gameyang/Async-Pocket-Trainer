import { cloneCreature, normalizeCreatureBattleLoadout } from "../creatureFactory";
import { movesById } from "../data/catalog";
import { clamp, type SeededRng } from "../rng";
import { calculateDamage, estimateDamage, getModifiedStat } from "./damage";
import type {
  BattleStatus,
  BattleStatusState,
  BattleLogEntry,
  BattleReplayEvent,
  BattleResult,
  Creature,
  EncounterKind,
  MoveDefinition,
  MoveStatChange,
} from "../types";

export interface AutoBattleOptions {
  kind: EncounterKind;
  playerTeam: readonly Creature[];
  enemyTeam: readonly Creature[];
  rng: SeededRng;
  damageScale?: number;
  maxTurns?: number;
  normalizeLoadouts?: boolean;
}

type BattleSide = "player" | "enemy";

interface BattleSideState {
  reflectTurns?: number;
  lightScreenTurns?: number;
  mistTurns?: number;
  stealthRock?: boolean;
}

interface BattleAction {
  actor: Creature;
  actorTeam: Creature[];
  targetTeam: Creature[];
  side: BattleSide;
  targetSide: BattleSide;
  move: MoveDefinition;
}

interface MoveOutcome {
  damage: number;
  effectiveness: number;
  critical: boolean;
  missed: boolean;
}

type BattleReplayEventInput = BattleReplayEvent extends infer Event
  ? Event extends BattleReplayEvent
    ? Omit<Event, "sequence">
    : never
  : never;

export function runAutoBattle(options: AutoBattleOptions): BattleResult {
  const cloneForBattle =
    options.normalizeLoadouts ?? true ? normalizeCreatureBattleLoadout : cloneCreature;
  const playerTeam = options.playerTeam.map(cloneForBattle);
  const enemyTeam = options.enemyTeam.map(cloneForBattle);
  const log: BattleLogEntry[] = [];
  const replay: BattleReplayEvent[] = [];
  const maxTurns = options.maxTurns ?? 160;
  const sideStates: Record<BattleSide, BattleSideState> = {
    player: {},
    enemy: {},
  };
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

    const actions = [
      createBattleAction(
        player,
        playerTeam,
        enemyTeam,
        "player",
        sideStates,
        options.rng,
        options.damageScale,
      ),
      createBattleAction(
        enemy,
        enemyTeam,
        playerTeam,
        "enemy",
        sideStates,
        options.rng,
        options.damageScale,
      ),
    ].sort((left, right) => compareActions(left, right, options.rng));
    const actedThisTurn = new Set<string>();

    for (const action of actions) {
      const activeActor = getActiveCreature(action.actorTeam);
      const target = getActiveCreature(action.targetTeam);

      if (action.actor.currentHp <= 0 || !target || activeActor !== action.actor) {
        continue;
      }

      if (
        resolvePreMoveSkip(action.actor, action.side, turns, options.rng, pushReplay)
      ) {
        actedThisTurn.add(action.actor.instanceId);
        continue;
      }

      const outcome = executeMove({
        action,
        target,
        turn: turns,
        rng: options.rng,
        damageScale: options.damageScale,
        sideStates,
        actedThisTurn,
        pushReplay,
      });

      actedThisTurn.add(action.actor.instanceId);
      log.push({
        turn: turns,
        actorId: action.actor.instanceId,
        actor: action.actor.speciesName,
        actorSide: action.side,
        targetId: target.instanceId,
        target: target.speciesName,
        targetSide: action.targetSide,
        move: action.move.name,
        damage: outcome.damage,
        effectiveness: outcome.effectiveness,
        critical: outcome.critical,
        missed: outcome.missed,
        targetRemainingHp: target.currentHp,
      });
    }

    applyEndOfTurnEffects(playerTeam, enemyTeam, "player", turns, sideStates, pushReplay);
    applyEndOfTurnEffects(enemyTeam, playerTeam, "enemy", turns, sideStates, pushReplay);
    tickSideState(sideStates.player);
    tickSideState(sideStates.enemy);
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

function createBattleAction(
  actor: Creature,
  actorTeam: Creature[],
  targetTeam: Creature[],
  side: BattleSide,
  sideStates: Record<BattleSide, BattleSideState>,
  rng: SeededRng,
  damageScale?: number,
): BattleAction {
  const target = getActiveCreature(targetTeam) ?? targetTeam[0];
  const targetSide = side === "player" ? "enemy" : "player";
  const forcedMove = getForcedMove(actor);
  const move = forcedMove ?? chooseMove(actor, target, sideStates[targetSide], rng, damageScale);

  return {
    actor,
    actorTeam,
    targetTeam,
    side,
    targetSide,
    move,
  };
}

function compareActions(left: BattleAction, right: BattleAction, rng: SeededRng): number {
  const priorityDiff = right.move.priority - left.move.priority;

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const speedDiff = getEffectiveSpeed(right.actor) - getEffectiveSpeed(left.actor);

  if (speedDiff !== 0) {
    return speedDiff;
  }

  return rng.chance(0.5) ? -1 : 1;
}

function chooseMove(
  attacker: Creature,
  defender: Creature,
  defenderSide: BattleSideState,
  rng: SeededRng,
  damageScale?: number,
): MoveDefinition {
  const usableMoves = attacker.moves.filter((move) => isMoveUsable(attacker, move));
  const moves = usableMoves.length > 0 ? usableMoves : attacker.moves;

  if (moves.length <= 1) {
    return moves[0] ?? movesById.tackle;
  }

  const attack = getBestScoredMove(
    moves.filter((move) => move.category !== "status"),
    attacker,
    defender,
    defenderSide,
    damageScale,
  );
  const support = getBestScoredMove(
    moves.filter((move) => move.category === "status"),
    attacker,
    defender,
    defenderSide,
    damageScale,
  );

  if (attack && support) {
    const attackWeight = getMoveWeight(attacker, defender, attack, defenderSide, damageScale);
    const supportWeight = getMoveWeight(attacker, defender, support, defenderSide, damageScale);
    return rng.chance(attackWeight / (attackWeight + supportWeight)) ? attack : support;
  }

  return pickWeightedMove(moves, attacker, defender, defenderSide, rng, damageScale);
}

function getBestScoredMove(
  moves: readonly MoveDefinition[],
  attacker: Creature,
  defender: Creature,
  defenderSide: BattleSideState,
  damageScale?: number,
): MoveDefinition | undefined {
  return moves.reduce<MoveDefinition | undefined>((best, move) => {
    if (!best) {
      return move;
    }

    return scoreMove(attacker, defender, move, defenderSide, damageScale) >
      scoreMove(attacker, defender, best, defenderSide, damageScale)
      ? move
      : best;
  }, undefined);
}

function pickWeightedMove(
  moves: readonly MoveDefinition[],
  attacker: Creature,
  defender: Creature,
  defenderSide: BattleSideState,
  rng: SeededRng,
  damageScale?: number,
): MoveDefinition {
  const weighted = moves.map((move) => ({
    move,
    weight: getMoveWeight(attacker, defender, move, defenderSide, damageScale),
  }));
  const totalWeight = weighted.reduce((total, candidate) => total + candidate.weight, 0);
  let roll = rng.nextFloat() * totalWeight;

  for (const candidate of weighted) {
    roll -= candidate.weight;

    if (roll <= 0) {
      return candidate.move;
    }
  }

  return weighted.at(-1)?.move ?? moves[0] ?? movesById.tackle;
}

function getMoveWeight(
  attacker: Creature,
  defender: Creature,
  move: MoveDefinition,
  defenderSide: BattleSideState,
  damageScale?: number,
): number {
  return Math.max(1, scoreMove(attacker, defender, move, defenderSide, damageScale));
}

function scoreMove(
  attacker: Creature,
  defender: Creature,
  move: MoveDefinition,
  defenderSide: BattleSideState,
  damageScale?: number,
): number {
  const expectedHits = getExpectedHitCount(move);
  const fixedDamage = estimateFixedDamage(attacker, defender, move);
  const damage =
    estimateDamage(attacker, defender, move, damageScale, {
      defenderReflect: Boolean(defenderSide.reflectTurns),
      defenderLightScreen: Boolean(defenderSide.lightScreenTurns),
      fixedDamage,
      hitCount: expectedHits,
      criticalChanceBonus: attacker.volatile?.focusEnergy ? 1 : 0,
    }) * (move.effectId === 249 ? 1.08 : 1);
  const statusScore = scoreStatusEffect(defender, move);
  const statScore = scoreStatChanges(attacker, defender, move);
  const healScore =
    getHealingRatio(move) > 0
      ? Math.max(0, attacker.stats.hp - attacker.currentHp) * getHealingRatio(move)
      : 0;
  const sideScore =
    move.effectId === 36 || move.effectId === 66
      ? 18
      : move.effectId === 112 && attacker.volatile?.lastMoveId !== move.id
        ? 4
        : 0;
  const priorityScore = move.priority > 0 ? move.priority * 4 : 0;

  return damage + statusScore + statScore + healScore + sideScore + priorityScore;
}

function isMoveUsable(attacker: Creature, move: MoveDefinition): boolean {
  const volatile = attacker.volatile;

  if (volatile?.disabledMoveId === move.id) {
    return false;
  }

  if (volatile?.tauntTurns && move.category === "status") {
    return false;
  }

  if (move.effectId === 112 && volatile?.lastMoveId === move.id) {
    return false;
  }

  return true;
}

function getForcedMove(actor: Creature): MoveDefinition | undefined {
  const volatile = actor.volatile;
  const forcedMoveId =
    volatile?.chargingMoveId || volatile?.lockedMoveId || volatile?.encoreMoveId;

  if (!forcedMoveId) {
    return undefined;
  }

  const move = actor.moves.find((candidate) => candidate.id === forcedMoveId) ?? movesById[forcedMoveId];
  return move && isMoveUsable(actor, move) ? move : undefined;
}

interface ExecuteMoveOptions {
  action: BattleAction;
  target: Creature;
  turn: number;
  rng: SeededRng;
  damageScale?: number;
  sideStates: Record<BattleSide, BattleSideState>;
  actedThisTurn: ReadonlySet<string>;
  pushReplay: (event: BattleReplayEventInput) => void;
}

function executeMove(options: ExecuteMoveOptions): MoveOutcome {
  const { action, target, turn, rng, damageScale, sideStates, actedThisTurn, pushReplay } = options;
  const { actor, side, targetSide } = action;
  const move = resolveCalledMove(action.move, actor, target, rng, pushReplay, turn) ?? action.move;
  const targetHpBefore = target.currentHp;

  actor.volatile = {
    ...actor.volatile,
    lastMoveId: move.id,
  };

  pushReplay({
    type: "move.select",
    turn,
    actorId: actor.instanceId,
    actorSide: side,
    targetId: target.instanceId,
    targetSide,
    move: move.name,
  });

  if (move.effectId === 27) {
    return executeBide(actor, target, move, turn, rng, pushReplay);
  }

  if (shouldStartCharge(actor, move)) {
    actor.volatile = {
      ...actor.volatile,
      chargingMoveId: move.id,
    };

    if (move.effectId === 146) {
      applyStatChanges(actor, actor, [{ stat: "defense", change: 1 }], true, turn, move, pushReplay);
    }

    pushMoveEffect(pushReplay, {
      turn,
      actor,
      side,
      move,
      label: `${actor.speciesName} began charging ${move.name}.`,
    });
    return { damage: 0, effectiveness: 1, critical: false, missed: false };
  }

  if (actor.volatile?.chargingMoveId === move.id) {
    actor.volatile = {
      ...actor.volatile,
      chargingMoveId: undefined,
    };
  }

  if (target.volatile?.protected && move.effectId !== 224) {
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      side,
      targetSide,
      move,
      label: `${target.speciesName} protected itself from ${move.name}.`,
    });
    return { damage: 0, effectiveness: 1, critical: false, missed: false };
  }

  if (move.effectId === 224) {
    target.volatile = {
      ...target.volatile,
      protected: false,
    };
  }

  const hitChance = getMoveHitChance(actor, target, move);
  const missed = !rng.chance(hitChance);

  if (missed) {
    pushReplay({
      type: "move.miss",
      turn,
      actorId: actor.instanceId,
      targetId: target.instanceId,
      move: move.name,
    });
    applyCrashDamage(actor, side, move, turn, pushReplay);
    return { damage: 0, effectiveness: 1, critical: false, missed: true };
  }

  if (move.effectId === 9 && target.status?.type !== "sleep") {
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      side,
      targetSide,
      move,
      label: `${move.name} failed because ${target.speciesName} is awake.`,
    });
    return { damage: 0, effectiveness: 1, critical: false, missed: false };
  }

  applyBeforeDamageEffects(actor, target, move, sideStates[targetSide], turn, pushReplay);

  const hitCount = rollHitCount(move, rng);
  const fixedDamage = rollFixedDamage(actor, target, move, rng);
  const result = calculateDamage(actor, target, move, rng, damageScale, {
    defenderReflect: Boolean(sideStates[targetSide].reflectTurns),
    defenderLightScreen: Boolean(sideStates[targetSide].lightScreenTurns),
    fixedDamage,
    hitCount,
    criticalChanceBonus: actor.volatile?.focusEnergy ? 1 : 0,
  });
  const damage = applyDamageToTarget(actor, target, move, result.damage, targetSide, turn, pushReplay);

  if (damage > 0 || move.category !== "status") {
    pushReplay({
      type: "damage.apply",
      turn,
      actorId: actor.instanceId,
      targetId: target.instanceId,
      move: move.name,
      moveType: move.type,
      damage,
      effectiveness: result.effectiveness,
      critical: result.critical,
      targetHpBefore,
      targetHpAfter: target.currentHp,
    });
  }

  if (hitCount > 1) {
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      side,
      targetSide,
      move,
      label: `${move.name} hit ${hitCount} times.`,
    });
  }

  applyAfterDamageEffects({
    actor,
    target,
    actorTeam: action.actorTeam,
    targetTeam: action.targetTeam,
    side,
    targetSide,
    move,
    damage,
    turn,
    rng,
    sideStates,
    actedThisTurn,
    pushReplay,
  });

  pushFaintIfNeeded(target, targetSide, turn, pushReplay);
  pushFaintIfNeeded(actor, side, turn, pushReplay);

  return {
    damage,
    effectiveness: result.effectiveness,
    critical: result.critical,
    missed: false,
  };
}

function resolveCalledMove(
  move: MoveDefinition,
  actor: Creature,
  target: Creature,
  rng: SeededRng,
  pushReplay: (event: BattleReplayEventInput) => void,
  turn: number,
): MoveDefinition | undefined {
  if (move.effectId === 10) {
    const copied = target.volatile?.lastMoveId ? movesById[target.volatile.lastMoveId] : undefined;

    if (!copied || copied.effectId === 10) {
      pushMoveEffect(pushReplay, {
        turn,
        actor,
        target,
        move,
        label: `${move.name} failed to copy a move.`,
      });
      return undefined;
    }

    return copied;
  }

  if (move.effectId === 84) {
    const candidates = Object.values(movesById).filter(
      (candidate) => candidate.id !== move.id && candidate.category !== "status",
    );
    return rng.pick(candidates);
  }

  return undefined;
}

function shouldStartCharge(actor: Creature, move: MoveDefinition): boolean {
  return move.flags.includes("charge") && actor.volatile?.chargingMoveId !== move.id;
}

function getMoveHitChance(actor: Creature, target: Creature, move: MoveDefinition): number {
  if (
    move.target === "user" ||
    move.target === "users-field" ||
    move.target === "entire-field" ||
    move.effectId === 18
  ) {
    return 1;
  }

  return clamp(
    move.accuracy * getModifiedStat(actor, "accuracy") / getModifiedStat(target, "evasion"),
    0,
    1,
  );
}

function applyDamageToTarget(
  actor: Creature,
  target: Creature,
  move: MoveDefinition,
  rawDamage: number,
  targetSide: BattleSide,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): number {
  const damage = Math.min(target.currentHp, Math.max(0, rawDamage));

  if (damage <= 0) {
    return 0;
  }

  if (target.volatile?.substituteHp && move.effectId !== 305) {
    const hpBefore = target.volatile.substituteHp;
    const hpAfter = Math.max(0, hpBefore - damage);
    target.volatile = {
      ...target.volatile,
      substituteHp: hpAfter || undefined,
    };
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      targetSide,
      move,
      label:
        hpAfter > 0
          ? `${target.speciesName}'s substitute took the hit.`
          : `${target.speciesName}'s substitute broke.`,
    });
    return damage;
  }

  target.currentHp = Math.max(0, target.currentHp - damage);
  target.volatile = {
    ...target.volatile,
    lastDamageTaken: damage,
    lastDamageCategory: move.category === "status" ? undefined : move.category,
  };
  return damage;
}

interface AfterDamageOptions {
  actor: Creature;
  target: Creature;
  actorTeam: Creature[];
  targetTeam: Creature[];
  side: BattleSide;
  targetSide: BattleSide;
  move: MoveDefinition;
  damage: number;
  turn: number;
  rng: SeededRng;
  sideStates: Record<BattleSide, BattleSideState>;
  actedThisTurn: ReadonlySet<string>;
  pushReplay: (event: BattleReplayEventInput) => void;
}

function applyAfterDamageEffects(options: AfterDamageOptions): void {
  const {
    actor,
    target,
    actorTeam,
    targetTeam,
    side,
    targetSide,
    move,
    damage,
    turn,
    rng,
    sideStates,
    actedThisTurn,
    pushReplay,
  } = options;

  applyHealing(actor, target, move, damage, turn, pushReplay);
  applyRecoil(actor, move, damage, turn, pushReplay);
  applyMoveAilment(actor, target, move, turn, rng, pushReplay);
  applyMoveStatChanges(actor, target, move, turn, rng, sideStates[targetSide], pushReplay);
  applyFlinch(actor, target, move, turn, rng, actedThisTurn, pushReplay);
  applyUniqueMoveEffect({
    actor,
    target,
    actorTeam,
    targetTeam,
    side,
    targetSide,
    move,
    damage,
    turn,
    rng,
    sideStates,
    pushReplay,
  });
}

function applyBeforeDamageEffects(
  actor: Creature,
  target: Creature,
  move: MoveDefinition,
  targetSideState: BattleSideState,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  if (move.effectId === 187) {
    targetSideState.reflectTurns = undefined;
    targetSideState.lightScreenTurns = undefined;
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${move.name} broke protective screens.`,
    });
  }
}

function applyHealing(
  actor: Creature,
  target: Creature,
  move: MoveDefinition,
  damage: number,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const drain = move.meta.drain > 0 && damage > 0 ? move.meta.drain / 100 : 0;
  const healing = getHealingRatio(move);
  const healAmount =
    drain > 0
      ? Math.floor(damage * drain)
      : healing > 0
        ? Math.floor(actor.stats.hp * healing)
        : 0;

  if (healAmount <= 0) {
    return;
  }

  const hpBefore = actor.currentHp;
  actor.currentHp = Math.min(actor.stats.hp, actor.currentHp + healAmount);

  if (actor.currentHp > hpBefore) {
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${actor.speciesName} recovered ${actor.currentHp - hpBefore} HP.`,
    });
  }
}

function applyRecoil(
  actor: Creature,
  move: MoveDefinition,
  damage: number,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const recoilRatio = move.meta.drain < 0 ? Math.abs(move.meta.drain) / 100 : 0;

  if (recoilRatio <= 0 || damage <= 0) {
    return;
  }

  const hpBefore = actor.currentHp;
  const recoil = Math.min(actor.currentHp, Math.max(1, Math.floor(damage * recoilRatio)));
  actor.currentHp = Math.max(0, actor.currentHp - recoil);
  pushMoveEffect(pushReplay, {
    turn,
    actor,
    entityId: actor.instanceId,
    move,
    label: `${actor.speciesName} took ${hpBefore - actor.currentHp} recoil damage.`,
  });
}

function applyCrashDamage(
  actor: Creature,
  side: BattleSide,
  move: MoveDefinition,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  if (move.effectId !== 46) {
    return;
  }

  const damage = Math.min(actor.currentHp, Math.max(1, Math.floor(actor.stats.hp / 2)));
  actor.currentHp = Math.max(0, actor.currentHp - damage);
  pushMoveEffect(pushReplay, {
    turn,
    actor,
    entityId: actor.instanceId,
    move,
    label: `${actor.speciesName} crashed and took ${damage} damage.`,
  });
  pushFaintIfNeeded(actor, side, turn, pushReplay);
}

function applyMoveAilment(
  actor: Creature,
  target: Creature,
  move: MoveDefinition,
  turn: number,
  rng: SeededRng,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const ailment =
    move.meta.ailment && move.meta.ailment !== "none"
      ? move.meta.ailment
      : move.statusEffect?.status;

  if (!ailment || target.currentHp <= 0) {
    if (move.effectId === 37 && rng.chance(0.2)) {
      applyMajorStatus(actor, target, rng.pick(["burn", "paralysis", "freeze"]), move, turn, rng, pushReplay);
    }
    return;
  }

  const chance =
    move.meta.ailmentChance > 0
      ? move.meta.ailmentChance / 100
      : move.statusEffect
        ? move.statusEffect.chance
        : move.meta.category === "ailment"
          ? 1
          : 0;

  if (chance <= 0 || !rng.chance(chance)) {
    return;
  }

  if (isSupportedBattleStatus(ailment)) {
    applyMajorStatus(actor, target, ailment, move, turn, rng, pushReplay);
    return;
  }

  if (ailment === "confusion") {
    target.volatile = {
      ...target.volatile,
      confusionTurns: rng.int(move.meta.minTurns ?? 2, move.meta.maxTurns ?? 5),
    };
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${target.speciesName} became confused.`,
    });
    return;
  }

  if (ailment === "trap") {
    target.volatile = {
      ...target.volatile,
      trapTurns: rng.int(move.meta.minTurns ?? 4, move.meta.maxTurns ?? 5),
      trapSourceId: actor.instanceId,
    };
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${target.speciesName} was trapped by ${move.name}.`,
    });
    return;
  }

  if (ailment === "leech-seed") {
    if (target.types.includes("grass")) {
      pushReplay({
        type: "status.immune",
        turn,
        actorId: actor.instanceId,
        targetId: target.instanceId,
        move: move.name,
        moveType: move.type,
        moveCategory: move.category,
        status: "poison",
      });
      return;
    }

    target.volatile = {
      ...target.volatile,
      leechSeedSourceId: actor.instanceId,
    };
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${target.speciesName} was seeded.`,
    });
    return;
  }

  if (ailment === "yawn") {
    target.volatile = {
      ...target.volatile,
      yawnTurns: 1,
    };
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${target.speciesName} grew drowsy.`,
    });
    return;
  }

  if (ailment === "disable") {
    const disabledMoveId = target.volatile?.lastMoveId ?? target.moves[0]?.id;
    target.volatile = {
      ...target.volatile,
      disabledMoveId,
      disabledTurns: 3,
    };
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${target.speciesName}'s move was disabled.`,
    });
  }
}

function applyMajorStatus(
  actor: Creature,
  target: Creature,
  status: BattleStatus,
  move: MoveDefinition,
  turn: number,
  rng: SeededRng,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  if (target.status) {
    return;
  }

  if (target.volatile?.substituteHp && move.category === "status") {
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${target.speciesName}'s substitute blocked ${move.name}.`,
    });
    return;
  }

  if (isStatusImmune(target, status)) {
    pushReplay({
      type: "status.immune",
      turn,
      actorId: actor.instanceId,
      targetId: target.instanceId,
      move: move.name,
      moveType: move.type,
      moveCategory: move.category,
      status,
    });
    return;
  }

  target.status = createStatusState(status, rng, move);
  pushReplay({
    type: "status.apply",
    turn,
    actorId: actor.instanceId,
    targetId: target.instanceId,
    move: move.name,
    moveType: move.type,
    moveCategory: move.category,
    status: target.status.type,
    turnsRemaining: target.status.turnsRemaining,
  });
}

function applyMoveStatChanges(
  actor: Creature,
  target: Creature,
  move: MoveDefinition,
  turn: number,
  rng: SeededRng,
  targetSideState: BattleSideState,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  if (move.statChanges.length === 0 && move.effectId !== 309) {
    return;
  }

  const chance = move.meta.statChance > 0 ? move.meta.statChance / 100 : 1;

  if (!rng.chance(chance)) {
    return;
  }

  if (move.effectId === 309) {
    applyStatChanges(
      actor,
      actor,
      [
        { stat: "attack", change: 2 },
        { stat: "special", change: 2 },
        { stat: "speed", change: 2 },
        { stat: "defense", change: -1 },
        { stat: "special", change: -1 },
      ],
      true,
      turn,
      move,
      pushReplay,
    );
    return;
  }

  const statTarget =
    move.target === "user" || move.effectId === 183 || move.effectId === 317 ? actor : target;
  const isBeneficial = statTarget === actor;

  if (!isBeneficial && targetSideState.mistTurns) {
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${target.speciesName} is protected by mist.`,
    });
    return;
  }

  if (!isBeneficial && target.volatile?.substituteHp) {
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${target.speciesName}'s substitute blocked stat changes.`,
    });
    return;
  }

  applyStatChanges(actor, statTarget, move.statChanges, isBeneficial, turn, move, pushReplay);
}

function applyStatChanges(
  actor: Creature,
  target: Creature,
  changes: readonly MoveStatChange[],
  _isBeneficial: boolean,
  turn: number,
  move: MoveDefinition,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const applied: string[] = [];
  const stages = { ...target.statStages };

  for (const change of changes) {
    const current = stages[change.stat] ?? 0;
    const next = clamp(current + change.change, -6, 6);

    if (next !== current) {
      stages[change.stat] = next;
      applied.push(`${change.stat} ${change.change > 0 ? "+" : ""}${change.change}`);
    }
  }

  target.statStages = stages;

  if (applied.length > 0) {
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      target,
      move,
      label: `${target.speciesName}'s ${applied.join(", ")}.`,
    });
  }
}

function applyFlinch(
  actor: Creature,
  target: Creature,
  move: MoveDefinition,
  turn: number,
  rng: SeededRng,
  actedThisTurn: ReadonlySet<string>,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const flinchChance =
    move.meta.flinchChance > 0
      ? move.meta.flinchChance / 100
      : move.effectId === 159
        ? 1
        : 0;

  if (flinchChance <= 0 || actedThisTurn.has(target.instanceId) || !rng.chance(flinchChance)) {
    return;
  }

  target.volatile = {
    ...target.volatile,
    flinched: true,
  };
  pushMoveEffect(pushReplay, {
    turn,
    actor,
    target,
    move,
    label: `${target.speciesName} flinched.`,
  });
}

interface UniqueMoveOptions {
  actor: Creature;
  target: Creature;
  actorTeam: Creature[];
  targetTeam: Creature[];
  side: BattleSide;
  targetSide: BattleSide;
  move: MoveDefinition;
  damage: number;
  turn: number;
  rng: SeededRng;
  sideStates: Record<BattleSide, BattleSideState>;
  pushReplay: (event: BattleReplayEventInput) => void;
}

function applyUniqueMoveEffect(options: UniqueMoveOptions): void {
  const {
    actor,
    target,
    actorTeam,
    targetTeam,
    side,
    targetSide,
    move,
    damage,
    turn,
    rng,
    sideStates,
    pushReplay,
  } = options;

  switch (move.effectId) {
    case 8:
      actor.currentHp = 0;
      pushMoveEffect(pushReplay, {
        turn,
        actor,
        side,
        entityId: actor.instanceId,
        move,
        label: `${actor.speciesName} fainted from ${move.name}.`,
      });
      break;
    case 26:
      clearStatStages(actor);
      clearStatStages(target);
      pushMoveEffect(pushReplay, { turn, actor, target, move, label: "All stat changes were reset." });
      break;
    case 29:
    case 314:
      forceSwitch(targetTeam, target, targetSide, turn, move, pushReplay);
      break;
    case 31:
      if (actor.moves[0]) {
        actor.types = [actor.moves[0].type];
        pushMoveEffect(pushReplay, {
          turn,
          actor,
          side,
          move,
          label: `${actor.speciesName} converted to ${actor.moves[0].type}.`,
        });
      }
      break;
    case 36:
      sideStates[side].lightScreenTurns = 5;
      pushMoveEffect(pushReplay, { turn, actor, side, move, label: "Light Screen was set." });
      break;
    case 38:
      actor.currentHp = actor.stats.hp;
      actor.status = { type: "sleep", turnsRemaining: 2 };
      pushReplay({
        type: "status.apply",
        turn,
        actorId: actor.instanceId,
        targetId: actor.instanceId,
        move: move.name,
        moveType: move.type,
        moveCategory: move.category,
        status: "sleep",
        turnsRemaining: 2,
      });
      break;
    case 47:
      sideStates[side].mistTurns = 5;
      pushMoveEffect(pushReplay, { turn, actor, side, move, label: "Mist covered the team." });
      break;
    case 48:
      actor.volatile = { ...actor.volatile, focusEnergy: true };
      pushMoveEffect(pushReplay, { turn, actor, side, move, label: `${actor.speciesName} focused.` });
      break;
    case 58:
      transformCreature(actor, target);
      pushMoveEffect(pushReplay, { turn, actor, target, side, targetSide, move, label: `${actor.speciesName} transformed.` });
      break;
    case 66:
      sideStates[side].reflectTurns = 5;
      pushMoveEffect(pushReplay, { turn, actor, side, move, label: "Reflect was set." });
      break;
    case 80:
      createSubstitute(actor, turn, move, pushReplay);
      break;
    case 82:
      applyStatChanges(actor, actor, [{ stat: "attack", change: 1 }], true, turn, move, pushReplay);
      break;
    case 83:
      mimicTargetMove(actor, target, turn, move, pushReplay);
      break;
    case 86:
      pushMoveEffect(pushReplay, { turn, actor, side, move, label: `${move.name} had no effect.` });
      break;
    case 87:
      target.volatile = {
        ...target.volatile,
        disabledMoveId: target.volatile?.lastMoveId ?? target.moves[0]?.id,
        disabledTurns: 3,
      };
      pushMoveEffect(pushReplay, { turn, actor, target, side, targetSide, move, label: `${target.speciesName}'s move was disabled.` });
      break;
    case 91:
      target.volatile = {
        ...target.volatile,
        encoreMoveId: target.volatile?.lastMoveId ?? target.moves[0]?.id,
        encoreTurns: 3,
      };
      pushMoveEffect(pushReplay, { turn, actor, target, side, targetSide, move, label: `${target.speciesName} received an encore.` });
      break;
    case 112:
      actor.volatile = { ...actor.volatile, protected: true };
      pushMoveEffect(pushReplay, { turn, actor, side, move, label: `${actor.speciesName} protected itself.` });
      break;
    case 154:
      forceSwitch(actorTeam, actor, side, turn, move, pushReplay);
      break;
    case 176:
      target.volatile = { ...target.volatile, tauntTurns: 3 };
      pushMoveEffect(pushReplay, { turn, actor, target, side, targetSide, move, label: `${target.speciesName} was taunted.` });
      break;
    case 177:
      applyStatChanges(
        actor,
        actor,
        [
          { stat: "attack", change: 1 },
          { stat: "special", change: 1 },
        ],
        true,
        turn,
        move,
        pushReplay,
      );
      break;
    case 229:
      if (damage > 0) {
        forceSwitch(actorTeam, actor, side, turn, move, pushReplay);
      }
      break;
    case 267:
      sideStates[targetSide].stealthRock = true;
      pushMoveEffect(pushReplay, { turn, actor, target, side, targetSide, move, label: "Pointed stones floated around the opposing side." });
      break;
    case 305:
      clearStatStages(target);
      pushMoveEffect(pushReplay, { turn, actor, target, side, targetSide, move, label: `${target.speciesName}'s stat changes were cleared.` });
      break;
  }

  if (move.effectId === 28) {
    applyLockedMoveState(actor, move, rng, turn, pushReplay);
  }

  if (move.flags.includes("recharge")) {
    actor.volatile = {
      ...actor.volatile,
      rechargeTurns: 1,
    };
  }
}

function executeBide(
  actor: Creature,
  target: Creature,
  move: MoveDefinition,
  turn: number,
  rng: SeededRng,
  pushReplay: (event: BattleReplayEventInput) => void,
): MoveOutcome {
  const volatile = actor.volatile ?? {};

  if (!volatile.bideTurns) {
    actor.volatile = {
      ...volatile,
      bideTurns: rng.int(2, 3),
      bideDamage: 0,
    };
    pushMoveEffect(pushReplay, { turn, actor, move, label: `${actor.speciesName} began storing energy.` });
    return { damage: 0, effectiveness: 1, critical: false, missed: false };
  }

  if (volatile.bideTurns > 1) {
    actor.volatile = {
      ...volatile,
      bideTurns: volatile.bideTurns - 1,
    };
    pushMoveEffect(pushReplay, { turn, actor, move, label: `${actor.speciesName} is storing energy.` });
    return { damage: 0, effectiveness: 1, critical: false, missed: false };
  }

  const damage = Math.min(target.currentHp, Math.max(1, (volatile.bideDamage ?? 0) * 2));
  target.currentHp = Math.max(0, target.currentHp - damage);
  actor.volatile = {
    ...volatile,
    bideTurns: undefined,
    bideDamage: undefined,
  };
  pushReplay({
    type: "damage.apply",
    turn,
    actorId: actor.instanceId,
    targetId: target.instanceId,
    move: move.name,
    moveType: move.type,
    damage,
    effectiveness: 1,
    critical: false,
    targetHpBefore: target.currentHp + damage,
    targetHpAfter: target.currentHp,
  });
  return { damage, effectiveness: 1, critical: false, missed: false };
}

function rollHitCount(move: MoveDefinition, rng: SeededRng): number {
  const min = move.meta.minHits ?? 1;
  const max = move.meta.maxHits ?? min;

  if (min <= 1 && max <= 1) {
    return 1;
  }

  if (min === max) {
    return min;
  }

  return rng.int(min, max);
}

function getExpectedHitCount(move: MoveDefinition): number {
  const min = move.meta.minHits ?? 1;
  const max = move.meta.maxHits ?? min;
  return (min + max) / 2;
}

function estimateFixedDamage(
  attacker: Creature,
  defender: Creature,
  move: MoveDefinition,
): number | undefined {
  if (move.effectId === 42) {
    return 40;
  }

  if (move.effectId === 131) {
    return 20;
  }

  if (move.effectId === 41) {
    return Math.max(1, Math.floor(defender.currentHp / 2));
  }

  if (move.effectId === 88) {
    return estimateBattleLevel(attacker);
  }

  if (move.effectId === 89) {
    return estimateBattleLevel(attacker);
  }

  if (move.effectId === 90 && attacker.volatile?.lastDamageCategory === "physical") {
    return Math.max(1, (attacker.volatile.lastDamageTaken ?? 1) * 2);
  }

  if (move.effectId === 145 && attacker.volatile?.lastDamageCategory === "special") {
    return Math.max(1, (attacker.volatile.lastDamageTaken ?? 1) * 2);
  }

  if (move.effectId === 39) {
    return defender.currentHp;
  }

  return undefined;
}

function rollFixedDamage(
  attacker: Creature,
  defender: Creature,
  move: MoveDefinition,
  rng: SeededRng,
): number | undefined {
  if (move.effectId === 89) {
    const level = estimateBattleLevel(attacker);
    return rng.int(Math.max(1, Math.floor(level / 2)), Math.max(1, Math.floor(level * 1.5)));
  }

  return estimateFixedDamage(attacker, defender, move);
}

function estimateBattleLevel(creature: Creature): number {
  if (typeof creature.level === "number") {
    return clamp(Math.round(creature.level), 1, 100);
  }

  const total =
    creature.stats.hp +
    creature.stats.attack +
    creature.stats.defense +
    creature.stats.special +
    creature.stats.speed;
  return clamp(Math.floor(total / 18), 10, 100);
}

function getHealingRatio(move: MoveDefinition): number {
  if (move.effectId === 38) {
    return 1;
  }

  return move.meta.healing > 0 ? move.meta.healing / 100 : 0;
}

function scoreStatusEffect(defender: Creature, move: MoveDefinition): number {
  if (defender.status || defender.currentHp <= 0) {
    return 0;
  }

  const ailment = move.meta.ailment;

  if (ailment === "burn" || ailment === "poison") {
    return 20;
  }

  if (ailment === "sleep" || ailment === "freeze") {
    return 28;
  }

  if (ailment === "paralysis") {
    return 18;
  }

  if (ailment === "confusion" || ailment === "trap" || ailment === "leech-seed" || ailment === "yawn") {
    return 14;
  }

  return 0;
}

function scoreStatChanges(attacker: Creature, defender: Creature, move: MoveDefinition): number {
  return move.statChanges.reduce((total, change) => {
    const target = move.target === "user" || move.effectId === 183 ? attacker : defender;
    const sign = target === attacker ? 1 : -1;
    const current = target.statStages?.[change.stat] ?? 0;
    const room = change.change > 0 ? 6 - current : current + 6;
    return total + Math.min(Math.abs(change.change), Math.max(0, room)) * 8 * sign * Math.sign(change.change);
  }, 0);
}

function resolvePreMoveSkip(
  actor: Creature,
  side: BattleSide,
  turn: number,
  rng: SeededRng,
  pushReplay: (event: BattleReplayEventInput) => void,
): boolean {
  if (actor.volatile?.rechargeTurns) {
    actor.volatile = {
      ...actor.volatile,
      rechargeTurns: actor.volatile.rechargeTurns - 1 || undefined,
    };
    pushSkip(actor, side, turn, actor.status?.type ?? "paralysis", "must recharge", pushReplay);
    return true;
  }

  if (actor.volatile?.flinched) {
    actor.volatile = {
      ...actor.volatile,
      flinched: false,
    };
    pushSkip(actor, side, turn, actor.status?.type ?? "paralysis", "flinched", pushReplay);
    return true;
  }

  if (resolveConfusion(actor, side, turn, rng, pushReplay)) {
    return true;
  }

  if (resolveMajorStatusSkip(actor, side, turn, rng, pushReplay)) {
    return true;
  }

  if (actor.volatile?.bideTurns) {
    actor.volatile.bideDamage =
      (actor.volatile.bideDamage ?? 0) + (actor.volatile.lastDamageTaken ?? 0);
  }

  return false;
}

function resolveConfusion(
  actor: Creature,
  side: BattleSide,
  turn: number,
  rng: SeededRng,
  pushReplay: (event: BattleReplayEventInput) => void,
): boolean {
  const turns = actor.volatile?.confusionTurns;

  if (!turns) {
    return false;
  }

  actor.volatile = {
    ...actor.volatile,
    confusionTurns: turns <= 1 ? undefined : turns - 1,
  };

  if (!rng.chance(1 / 3)) {
    return false;
  }

  const damage = Math.min(actor.currentHp, Math.max(1, Math.floor(actor.stats.hp / 8)));
  const hpBefore = actor.currentHp;
  actor.currentHp = Math.max(0, actor.currentHp - damage);
  pushMoveEffect(pushReplay, {
    turn,
    actor,
    side,
    entityId: actor.instanceId,
    label: `${actor.speciesName} hurt itself in confusion for ${damage}.`,
  });
  pushReplay({
    type: "status.tick",
    turn,
    entityId: actor.instanceId,
    side,
    status: "confusion",
    damage,
    hpBefore,
    hpAfter: actor.currentHp,
  });
  pushFaintIfNeeded(actor, side, turn, pushReplay);
  return true;
}

function resolveMajorStatusSkip(
  actor: Creature,
  side: BattleSide,
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

    pushSkip(actor, side, turn, status.type, "paralysis", pushReplay);
    return true;
  }

  if (status.type !== "sleep" && status.type !== "freeze") {
    return false;
  }

  const remainingTurns = status.turnsRemaining ?? 1;
  pushSkip(actor, side, turn, status.type, status.type, pushReplay);

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

function pushSkip(
  actor: Creature,
  side: BattleSide,
  turn: number,
  status: BattleStatus,
  reason: string,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  pushReplay({
    type: "turn.skip",
    turn,
    entityId: actor.instanceId,
    side,
    status,
    reason,
  });
}

function applyEndOfTurnEffects(
  team: readonly Creature[],
  opposingTeam: readonly Creature[],
  side: BattleSide,
  turn: number,
  sideStates: Record<BattleSide, BattleSideState>,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const creature = getActiveCreature(team);

  if (!creature) {
    return;
  }

  applyResidualMajorStatus(creature, side, turn, pushReplay);
  applyTrapDamage(creature, side, turn, pushReplay);
  applyLeechSeed(creature, team, opposingTeam, side, turn, pushReplay);
  applyYawn(creature, turn, pushReplay);
  tickVolatileCounters(creature);
  creature.volatile = {
    ...creature.volatile,
    protected: false,
    flinched: false,
  };

  if (sideStates[side].stealthRock && creature.currentHp > 0) {
    sideStates[side].stealthRock = false;
    damageCreature(
      creature,
      side,
      Math.max(1, Math.floor(creature.stats.hp / 8)),
      turn,
      "stealth-rock",
      pushReplay,
    );
  }
}

function applyResidualMajorStatus(
  creature: Creature,
  side: BattleSide,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const status = creature.status?.type;

  if (status !== "burn" && status !== "poison") {
    return;
  }

  const damageRatio = status === "poison" ? 0.125 : 0.0625;
  damageCreature(
    creature,
    side,
    Math.max(1, Math.floor(creature.stats.hp * damageRatio)),
    turn,
    status,
    pushReplay,
  );
}

function applyTrapDamage(
  creature: Creature,
  side: BattleSide,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const turns = creature.volatile?.trapTurns;

  if (!turns || creature.currentHp <= 0) {
    return;
  }

  damageCreature(
    creature,
    side,
    Math.max(1, Math.floor(creature.stats.hp / 8)),
    turn,
    "trap",
    pushReplay,
  );
  creature.volatile = {
    ...creature.volatile,
    trapTurns: turns <= 1 ? undefined : turns - 1,
  };
}

function applyLeechSeed(
  creature: Creature,
  team: readonly Creature[],
  opposingTeam: readonly Creature[],
  side: BattleSide,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const sourceId = creature.volatile?.leechSeedSourceId;

  if (!sourceId || creature.currentHp <= 0) {
    return;
  }

  const damage = Math.min(creature.currentHp, Math.max(1, Math.floor(creature.stats.hp / 8)));
  damageCreature(creature, side, damage, turn, "leech-seed", pushReplay);
  const source =
    opposingTeam.find((candidate) => candidate.instanceId === sourceId) ??
    team.find((candidate) => candidate.instanceId === sourceId);

  if (source && source.currentHp > 0) {
    source.currentHp = Math.min(source.stats.hp, source.currentHp + damage);
  }
}

function applyYawn(
  creature: Creature,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const turns = creature.volatile?.yawnTurns;

  if (!turns) {
    return;
  }

  if (turns > 1) {
    creature.volatile = {
      ...creature.volatile,
      yawnTurns: turns - 1,
    };
    return;
  }

  creature.volatile = {
    ...creature.volatile,
    yawnTurns: undefined,
  };

  if (!creature.status) {
    creature.status = { type: "sleep", turnsRemaining: 2 };
    pushReplay({
      type: "status.apply",
      turn,
    actorId: creature.instanceId,
    targetId: creature.instanceId,
    move: "Yawn",
    moveType: "normal",
    moveCategory: "status",
    status: "sleep",
    turnsRemaining: 2,
  });
  }
}

function tickVolatileCounters(creature: Creature): void {
  const volatile = creature.volatile;

  if (!volatile) {
    return;
  }

  creature.volatile = {
    ...volatile,
    tauntTurns: decrementCounter(volatile.tauntTurns),
    encoreTurns: decrementCounter(volatile.encoreTurns),
    disabledTurns: decrementCounter(volatile.disabledTurns),
    disabledMoveId: volatile.disabledTurns === 1 ? undefined : volatile.disabledMoveId,
    encoreMoveId: volatile.encoreTurns === 1 ? undefined : volatile.encoreMoveId,
  };
}

function tickSideState(sideState: BattleSideState): void {
  sideState.reflectTurns = decrementCounter(sideState.reflectTurns);
  sideState.lightScreenTurns = decrementCounter(sideState.lightScreenTurns);
  sideState.mistTurns = decrementCounter(sideState.mistTurns);
}

function decrementCounter(value: number | undefined): number | undefined {
  if (!value || value <= 1) {
    return undefined;
  }

  return value - 1;
}

function damageCreature(
  creature: Creature,
  side: BattleSide,
  damage: number,
  turn: number,
  label: BattleStatus | "confusion" | "trap" | "leech-seed" | "stealth-rock",
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const hpBefore = creature.currentHp;
  const applied = Math.min(hpBefore, damage);
  creature.currentHp = Math.max(0, creature.currentHp - applied);
  pushReplay({
    type: "status.tick",
    turn,
    entityId: creature.instanceId,
    side,
    status: label,
    damage: applied,
    hpBefore,
    hpAfter: creature.currentHp,
  });
  pushFaintIfNeeded(creature, side, turn, pushReplay);
}

function createStatusState(
  status: BattleStatus,
  rng: SeededRng,
  move?: MoveDefinition,
): BattleStatusState {
  if (status === "sleep" || status === "freeze") {
    return {
      type: status,
      turnsRemaining: rng.int(move?.meta.minTurns ?? 1, move?.meta.maxTurns ?? 3),
    };
  }

  return { type: status };
}

function isSupportedBattleStatus(value: string | null | undefined): value is BattleStatus {
  return (
    value === "burn" ||
    value === "poison" ||
    value === "paralysis" ||
    value === "sleep" ||
    value === "freeze"
  );
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

function applyLockedMoveState(
  actor: Creature,
  move: MoveDefinition,
  rng: SeededRng,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const volatile = actor.volatile ?? {};

  if (!volatile.lockedMoveId) {
    actor.volatile = {
      ...volatile,
      lockedMoveId: move.id,
      lockedTurns: rng.int(1, 2),
    };
    return;
  }

  const remaining = volatile.lockedTurns ?? 0;

  if (remaining > 1) {
    actor.volatile = {
      ...volatile,
      lockedTurns: remaining - 1,
    };
    return;
  }

  actor.volatile = {
    ...volatile,
    lockedMoveId: undefined,
    lockedTurns: undefined,
    confusionTurns: rng.int(2, 5),
  };
  pushMoveEffect(pushReplay, {
    turn,
    actor,
    move,
    label: `${actor.speciesName} became confused from fatigue.`,
  });
}

function createSubstitute(
  actor: Creature,
  turn: number,
  move: MoveDefinition,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  if (actor.volatile?.substituteHp) {
    return;
  }

  const cost = Math.floor(actor.stats.hp / 4);

  if (actor.currentHp <= cost) {
    pushMoveEffect(pushReplay, {
      turn,
      actor,
      move,
      label: `${actor.speciesName} did not have enough HP for a substitute.`,
    });
    return;
  }

  actor.currentHp -= cost;
  actor.volatile = {
    ...actor.volatile,
    substituteHp: cost,
  };
  pushMoveEffect(pushReplay, {
    turn,
    actor,
    move,
    label: `${actor.speciesName} made a substitute.`,
  });
}

function mimicTargetMove(
  actor: Creature,
  target: Creature,
  turn: number,
  move: MoveDefinition,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const copied = target.moves.find((candidate) => candidate.id !== move.id);

  if (!copied) {
    return;
  }

  actor.moves = [copied, ...actor.moves.slice(1)];
  pushMoveEffect(pushReplay, {
    turn,
    actor,
    target,
    move,
    label: `${actor.speciesName} mimicked ${copied.name}.`,
  });
}

function transformCreature(actor: Creature, target: Creature): void {
  actor.types = [...target.types];
  actor.stats = { ...target.stats, hp: actor.stats.hp };
  actor.moves = target.moves.map((move) => ({
    ...move,
    flags: [...move.flags],
    statChanges: move.statChanges.map((change) => ({ ...change })),
    meta: { ...move.meta },
    statusEffect: move.statusEffect ? { ...move.statusEffect } : undefined,
  }));
}

function forceSwitch(
  team: Creature[],
  current: Creature,
  side: BattleSide,
  turn: number,
  move: MoveDefinition,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  const currentIndex = team.indexOf(current);
  const replacementIndex = team.findIndex(
    (candidate, index) => index !== currentIndex && candidate.currentHp > 0,
  );

  if (currentIndex < 0 || replacementIndex < 0) {
    return;
  }

  const [removed] = team.splice(currentIndex, 1);
  team.push(removed);
  pushMoveEffect(pushReplay, {
    turn,
    actor: current,
    side,
    entityId: current.instanceId,
    move,
    label: `${current.speciesName} was forced out.`,
  });
}

function clearStatStages(creature: Creature): void {
  creature.statStages = undefined;
}

function pushFaintIfNeeded(
  creature: Creature,
  side: BattleSide,
  turn: number,
  pushReplay: (event: BattleReplayEventInput) => void,
): void {
  if (creature.currentHp > 0) {
    return;
  }

  const previousFaint = false;

  if (!previousFaint) {
    pushReplay({
      type: "creature.faint",
      turn,
      entityId: creature.instanceId,
      side,
    });
  }
}

function pushMoveEffect(
  pushReplay: (event: BattleReplayEventInput) => void,
  options: {
    turn: number;
    actor?: Creature;
    target?: Creature;
    side?: BattleSide;
    targetSide?: BattleSide;
    entityId?: string;
    move?: MoveDefinition;
    label: string;
  },
): void {
  pushReplay({
    type: "move.effect",
    turn: options.turn,
    actorId: options.actor?.instanceId,
    actorSide: options.side,
    targetId: options.target?.instanceId,
    targetSide: options.targetSide,
    entityId: options.entityId,
    side: options.side,
    move: options.move?.name,
    moveType: options.move?.type,
    moveCategory: options.move?.category,
    label: options.label,
  });
}

function hasLivingCreature(team: readonly Creature[]): boolean {
  return team.some((creature) => creature.currentHp > 0);
}

function getActiveCreature(team: readonly Creature[]): Creature | undefined {
  return team.find((creature) => creature.currentHp > 0);
}

function getEffectiveSpeed(creature: Creature): number {
  const speed = getModifiedStat(creature, "speed");

  return creature.status?.type === "paralysis"
    ? Math.max(1, Math.floor(speed * 0.5))
    : Math.max(1, Math.floor(speed));
}

function clearBattleStatuses(team: readonly Creature[]): Creature[] {
  return team.map((creature) => ({
    ...creature,
    status: undefined,
    statStages: undefined,
    volatile: undefined,
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
