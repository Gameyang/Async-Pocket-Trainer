import { typeChart } from "../data/catalog";
import { clamp, type SeededRng } from "../rng";
import type { Creature, ElementType, MoveDefinition } from "../types";

export interface DamageResult {
  damage: number;
  effectiveness: number;
  critical: boolean;
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
): number {
  const attack =
    move.category === "special" ? attacker.stats.special : getEffectiveAttack(attacker);
  const defense = move.category === "special" ? defender.stats.special : defender.stats.defense;
  const stab = attacker.types.includes(move.type) ? 1.25 : 1;
  const effectiveness = getTypeEffectiveness(move.type, defender.types);
  const raw = ((move.power * attack) / Math.max(1, defense)) * damageScale + 2;

  return Math.max(0, Math.floor(raw * stab * effectiveness * move.accuracy));
}

export function calculateDamage(
  attacker: Creature,
  defender: Creature,
  move: MoveDefinition,
  rng: SeededRng,
  damageScale = 0.24,
): DamageResult {
  const attack =
    move.category === "special" ? attacker.stats.special : getEffectiveAttack(attacker);
  const defense = move.category === "special" ? defender.stats.special : defender.stats.defense;
  const stab = attacker.types.includes(move.type) ? 1.25 : 1;
  const effectiveness = getTypeEffectiveness(move.type, defender.types);
  const variance = 0.9 + rng.nextFloat() * 0.2;
  const criticalChance = clamp(attacker.stats.speed / 720, 0.04, 0.22);
  const critical = rng.chance(criticalChance);
  const criticalMultiplier = critical ? 1.5 : 1;
  const raw = ((move.power * attack) / Math.max(1, defense)) * damageScale + 2;
  const damage =
    effectiveness === 0
      ? 0
      : Math.max(1, Math.floor(raw * stab * effectiveness * variance * criticalMultiplier));

  return { damage, effectiveness, critical };
}

function getEffectiveAttack(attacker: Creature): number {
  return attacker.status?.type === "burn"
    ? Math.max(1, Math.floor(attacker.stats.attack * 0.5))
    : attacker.stats.attack;
}
