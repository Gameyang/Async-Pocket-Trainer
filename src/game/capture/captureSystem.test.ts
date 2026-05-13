import { describe, expect, it } from "vitest";

import { defaultBalance } from "../data/catalog";
import type { Creature, MoveDefinition } from "../types";
import { calculateCaptureChance } from "./captureSystem";

describe("capture economy curve", () => {
  it("rewards low HP and better balls while keeping late catches possible", () => {
    const fullHpRare = creature({ currentHp: 100, rarityScore: 120, captureRate: 0.42 });
    const lowHpRare = creature({ currentHp: 12, rarityScore: 120, captureRate: 0.42 });

    const fullHpPokeBall = calculateCaptureChance(fullHpRare, 35, "pokeBall");
    const lowHpPokeBall = calculateCaptureChance(lowHpRare, 35, "pokeBall");
    const lowHpGreatBall = calculateCaptureChance(lowHpRare, 35, "greatBall");

    expect(lowHpPokeBall).toBeGreaterThan(fullHpPokeBall);
    expect(lowHpGreatBall).toBeGreaterThan(lowHpPokeBall);
    expect(lowHpGreatBall).toBeGreaterThanOrEqual(0.48);
  });

  it("prices great balls as a premium mid-run upgrade instead of a cheap replacement", () => {
    expect(defaultBalance.greatBallCost).toBeGreaterThan(defaultBalance.pokeBallCost * 2);
    expect(defaultBalance.greatBallCost).toBeLessThan(defaultBalance.pokeBallCost * 3);
  });

  it("supports defeated-capture floors and elite route bonuses", () => {
    const defeated = creature({ currentHp: 0, rarityScore: 80, captureRate: 0.4 });
    const fullLowHpBonus = calculateCaptureChance(defeated, 8, "pokeBall");
    const floored = calculateCaptureChance(defeated, 8, "pokeBall", {
      hpRatioFloor: defaultBalance.defeatedCaptureHpRatioFloor,
    });
    const elite = calculateCaptureChance(defeated, 8, "pokeBall", {
      hpRatioFloor: defaultBalance.defeatedCaptureHpRatioFloor,
      chanceBonus: defaultBalance.eliteCaptureChanceBonus,
    });

    expect(floored).toBeLessThan(fullLowHpBonus);
    expect(elite).toBeGreaterThan(floored);
  });
});

const tackle: MoveDefinition = {
  id: "tackle",
  name: "Tackle",
  type: "normal",
  power: 40,
  accuracy: 1,
  category: "physical",
};

function creature(
  overrides: Partial<Pick<Creature, "currentHp" | "rarityScore" | "captureRate">>,
): Creature {
  return {
    instanceId: "test-creature",
    speciesId: 1,
    speciesName: "Testmon",
    types: ["normal"],
    stats: {
      hp: 100,
      attack: 50,
      defense: 50,
      special: 50,
      speed: 50,
    },
    currentHp: overrides.currentHp ?? 100,
    moves: [tackle],
    rarityScore: overrides.rarityScore ?? 50,
    powerScore: 280,
    captureRate: overrides.captureRate ?? 0.45,
  };
}
