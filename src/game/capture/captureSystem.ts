import { clamp, type SeededRng } from "../rng";
import type { BallType, Creature } from "../types";

const ballModifiers: Record<BallType, number> = {
  pokeBall: 1,
  greatBall: 1.65,
};

export interface CaptureCheck {
  chance: number;
  success: boolean;
}

export function calculateCaptureChance(creature: Creature, wave: number, ball: BallType): number {
  const hpRatio = creature.currentHp / creature.stats.hp;
  const lowHpBonus = 1 + (1 - hpRatio) * 0.78;
  const wavePressure = clamp(1 - Math.max(0, wave - 1) * 0.009, 0.68, 1);
  const rarityPressure = clamp(1 - creature.rarityScore / 310, 0.6, 1);

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
