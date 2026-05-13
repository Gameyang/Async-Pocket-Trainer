import { typeChart } from "../data/catalog";
import { clamp, type SeededRng } from "../rng";
import type { BattleStat, Creature, ElementType, MoveDefinition } from "../types";

export interface DamageResult {
  damage: number;
  effectiveness: number;
  critical: boolean;
}

export interface DamageContext {
  defenderReflect?: boolean;
  defenderLightScreen?: boolean;
  fixedDamage?: number;
  powerOverride?: number;
  hitCount?: number;
  criticalChanceBonus?: number;
}

export function getTypeEffectiveness(
  moveType: ElementType,
  defenderTypes: readonly ElementType[],
): number {
  return defenderTypes.reduce(
    (multiplier, defenderType) => multiplier * (typeChart[moveType]?.[defenderType] ?? 1),
    1,
  );
}

export function estimateDamage(
  attacker: Creature,
  defender: Creature,
  move: MoveDefinition,
  damageScale = 0.24,
  context: DamageContext = {},
): number {
  if (move.category === "status") {
    return 0;
  }

  if (context.fixedDamage !== undefined) {
    return Math.max(0, Math.floor(context.fixedDamage * (context.hitCount ?? 1) * move.accuracy));
  }

  const power = context.powerOverride ?? getMovePower(attacker, defender, move);

  if (power <= 0) {
    return 0;
  }

  const attack = getAttackStat(attacker, defender, move);
  const defense = getDefenseStat(defender, move);
  const stab = attacker.types.includes(move.type) ? 1.25 : 1;
  const effectiveness = getTypeEffectiveness(move.type, defender.types);
  const sideMultiplier = getSideDefenseMultiplier(move, context);
  const raw = ((power * attack) / Math.max(1, defense)) * damageScale + 2;

  return Math.max(
    0,
    Math.floor(raw * stab * effectiveness * sideMultiplier * (context.hitCount ?? 1) * move.accuracy),
  );
}

export function calculateDamage(
  attacker: Creature,
  defender: Creature,
  move: MoveDefinition,
  rng: SeededRng,
  damageScale = 0.24,
  context: DamageContext = {},
): DamageResult {
  const effectiveness = getTypeEffectiveness(move.type, defender.types);

  if (effectiveness === 0) {
    return { damage: 0, effectiveness, critical: false };
  }

  if (context.fixedDamage !== undefined) {
    return {
      damage: Math.max(1, Math.floor(context.fixedDamage * (context.hitCount ?? 1))),
      effectiveness,
      critical: false,
    };
  }

  const power = context.powerOverride ?? getMovePower(attacker, defender, move);

  if (move.category === "status" || power <= 0) {
    return { damage: 0, effectiveness, critical: false };
  }

  const attack = getAttackStat(attacker, defender, move);
  const defense = getDefenseStat(defender, move);
  const stab = attacker.types.includes(move.type) ? 1.25 : 1;
  const sideMultiplier = getSideDefenseMultiplier(move, context);
  const variance = 0.9 + rng.nextFloat() * 0.2;
  const criticalChance = clamp(
    attacker.stats.speed / 720 + (move.meta.critRate + (context.criticalChanceBonus ?? 0)) * 0.12,
    0.04,
    0.5,
  );
  const critical = rng.chance(criticalChance);
  const criticalMultiplier = critical ? 1.5 : 1;
  const raw = ((power * attack) / Math.max(1, defense)) * damageScale + 2;
  const damage = Math.max(
    1,
    Math.floor(
      raw *
        stab *
        effectiveness *
        sideMultiplier *
        variance *
        criticalMultiplier *
        (context.hitCount ?? 1),
    ),
  );

  return { damage, effectiveness, critical };
}

export function getModifiedStat(creature: Creature, stat: BattleStat): number {
  const base = stat === "accuracy" || stat === "evasion" ? 1 : creature.stats[stat];
  const stage = creature.statStages?.[stat] ?? 0;

  if (stat === "attack" && creature.status?.type === "burn") {
    return Math.max(1, Math.floor(base * 0.5 * getStageMultiplier(stage)));
  }

  return Math.max(stat === "accuracy" || stat === "evasion" ? 0.25 : 1, base * getStageMultiplier(stage));
}

export function getStageMultiplier(stage: number): number {
  const clamped = clamp(stage, -6, 6);
  return clamped >= 0 ? (2 + clamped) / 2 : 2 / (2 - clamped);
}

function getAttackStat(attacker: Creature, defender: Creature, move: MoveDefinition): number {
  if (move.effectId === 298) {
    return getModifiedStat(defender, "attack");
  }

  return move.category === "special"
    ? getModifiedStat(attacker, "special")
    : getModifiedStat(attacker, "attack");
}

function getDefenseStat(defender: Creature, move: MoveDefinition): number {
  return move.category === "special"
    ? getModifiedStat(defender, "special")
    : getModifiedStat(defender, "defense");
}

function getSideDefenseMultiplier(move: MoveDefinition, context: DamageContext): number {
  if (move.effectId === 187) {
    return 1;
  }

  if (move.category === "physical" && context.defenderReflect) {
    return 0.5;
  }

  if (move.category === "special" && context.defenderLightScreen) {
    return 0.5;
  }

  return 1;
}

function getMovePower(attacker: Creature, defender: Creature, move: MoveDefinition): number {
  if (move.effectId === 170 && attacker.status) {
    return move.power * 2;
  }

  if (move.effectId === 197) {
    const weight = defender.weightHg ?? defender.stats.hp * 10;

    if (weight >= 2000) {
      return 120;
    }
    if (weight >= 1000) {
      return 100;
    }
    if (weight >= 500) {
      return 80;
    }
    if (weight >= 250) {
      return 60;
    }
    if (weight >= 100) {
      return 40;
    }
    return 20;
  }

  return move.power;
}
