import { describe, expect, it } from "vitest";

import { defaultBalance } from "./data/catalog";
import {
  awardCheckpointDefeat,
  awardDexUnlock,
  awardWaveMilestone,
  emptyMetaCurrency,
} from "./achievements";

describe("achievements", () => {
  it("awards dex unlock once per species", () => {
    const meta = emptyMetaCurrency();
    const first = awardDexUnlock(meta, 1);
    const second = awardDexUnlock(meta, 1);
    expect(first?.trainerPoints).toBeGreaterThan(0);
    expect(second).toBeUndefined();
    expect(meta.claimedAchievements).toContain("dex:1");
  });

  it("rewards rarer species more", () => {
    const meta = emptyMetaCurrency();
    const charmander = awardDexUnlock(meta, 4);
    expect(charmander).toBeDefined();
    const before = meta.trainerPoints;
    const dragonite = awardDexUnlock(meta, 149);
    expect(dragonite?.trainerPoints).toBeGreaterThanOrEqual(charmander?.trainerPoints ?? 0);
    expect(meta.trainerPoints).toBeGreaterThan(before);
  });

  it("only rewards checkpoint multiples", () => {
    const meta = emptyMetaCurrency();
    expect(awardCheckpointDefeat(meta, 4, defaultBalance)).toBeUndefined();
    expect(awardCheckpointDefeat(meta, defaultBalance.checkpointInterval, defaultBalance)).toBeDefined();
    expect(
      awardCheckpointDefeat(meta, defaultBalance.checkpointInterval, defaultBalance),
    ).toBeUndefined();
  });

  it("rewards wave milestones once each", () => {
    const meta = emptyMetaCurrency();
    expect(awardWaveMilestone(meta, 5)?.trainerPoints).toBe(5);
    expect(awardWaveMilestone(meta, 5)).toBeUndefined();
    expect(awardWaveMilestone(meta, 10)?.trainerPoints).toBe(10);
    expect(awardWaveMilestone(meta, 7)).toBeUndefined();
  });
});
