import { describe, expect, it } from "vitest";

import { defaultBalance } from "./data/catalog";
import {
  getBallCost,
  getHealProduct,
  getLevelBoostProduct,
  getRarityBoostProduct,
  getStatBoostProduct,
  getStatRerollProduct,
  getTeachMoveProduct,
  getTeamSortProduct,
  getTypeLockProduct,
} from "./shopCatalog";
import {
  ballTypes,
  type ElementType,
  type HealTier,
  type LevelBoostTier,
  type RarityBoostTier,
  type StatBoostTier,
} from "./types";

const healTiers: HealTier[] = [1, 2, 3, 4, 5];
const levelBoostTiers: LevelBoostTier[] = [1, 2, 3, 4];
const rarityBoostTiers: RarityBoostTier[] = [1, 2, 3];
const statBoostTiers: StatBoostTier[] = [1, 2, 3];

describe("shop price bands", () => {
  it("keeps coin rewards generous while item prices stay in distinct bands", () => {
    expect(defaultBalance.startingMoney).toBe(180);
    expect(defaultBalance.rewardBase).toBe(40);
    expect(defaultBalance.rewardPerWave).toBe(8);
    expect(defaultBalance.trainerRewardBonus).toBe(40);

    expect(ballTypes.map((ball) => getBallCost(ball, defaultBalance))).toEqual([
      12, 36, 82, 150, 300,
    ]);
    expect(healTiers.map((tier) => getHealProduct("single", tier).cost)).toEqual([
      8, 16, 30, 50, 78,
    ]);
    expect(healTiers.map((tier) => getHealProduct("team", tier).cost)).toEqual([
      18, 36, 64, 96, 120,
    ]);
    expect(defaultBalance.teamRestCost).toBe(getHealProduct("team", 5).cost);
  });

  it("separates utility, encounter, growth, and premium-grade coin prices", () => {
    const rareElements: ElementType[] = ["psychic", "ghost", "ice", "dragon", "steel", "fairy"];

    expect(getTeamSortProduct("power", "desc").cost).toBe(4);
    expect(levelBoostTiers.map((tier) => getLevelBoostProduct(tier).cost)).toEqual([
      22, 52, 100, 170,
    ]);
    expect(rarityBoostTiers.map((tier) => getRarityBoostProduct(tier).cost)).toEqual([
      40, 90, 180,
    ]);
    expect(statBoostTiers.map((tier) => getStatBoostProduct("attack", tier).cost)).toEqual([
      28, 68, 125,
    ]);
    expect(getStatRerollProduct().cost).toBe(110);
    expect(rareElements.every((element) => getTypeLockProduct(element).cost >= 88)).toBe(true);
    expect(rareElements.every((element) => getTeachMoveProduct(element).cost >= 145)).toBe(true);
  });
});
