import { clamp, type SeededRng } from "../rng";
import type { BallType, Creature } from "../types";

const ballModifiers: Record<BallType, number> = {
  pokeBall: 1,
  greatBall: 1.55,
};

export interface CaptureCheck {
  chance: number;
  success: boolean;
}

export function calculateCaptureChance(creature: Creature, wave: number, ball: BallType): number {
  const hpRatio = creature.currentHp / creature.stats.hp;
  const lowHpBonus = 1 + (1 - hpRatio) * 0.72;
  const wavePressure = clamp(1 - Math.max(0, wave - 1) * 0.012, 0.64, 1);
  const rarityPressure = clamp(1 - creature.rarityScore / 250, 0.58, 1);

  return clamp(
    creature.captureRate * ballModifiers[ball] * lowHpBonus * wavePressure * rarityPressure,
    0.04,
    0.92,
  );
}

export function attemptCapture(
  creature: Creature,
  wave: number,
  ball: BallType,
  rng: SeededRng,
): CaptureCheck {
  const chance = calculateCaptureChance(creature, wave, ball);
  return {
    chance,
    success: rng.chance(chance),
  };
}
