import { describe, expect, it } from "vitest";

import { chooseReplacementIndex, scoreCreature, shouldReplaceByPower } from "./scoring";
import type { Creature, MoveDefinition } from "./types";

describe("team replacement policy", () => {
  it("uses a lower replacement threshold for greedy strategy", () => {
    expect(shouldReplaceByPower(100, 101, "greedy")).toBe(true);
    expect(shouldReplaceByPower(100, 101, "conserveBalls")).toBe(false);
    expect(shouldReplaceByPower(100, 110, "conserveBalls")).toBe(true);
  });

  it("selects the weakest slot only when the strategy accepts the captured power", () => {
    const team = [creature("weak", 100), creature("strong", 200)];
    const slightUpgrade = creature("slight", 105);
    const clearUpgrade = creature("clear", 120);

    expect(chooseReplacementIndex(team, slightUpgrade, "greedy")).toBe(0);
    expect(chooseReplacementIndex(team, slightUpgrade, "conserveBalls")).toBeUndefined();
    expect(chooseReplacementIndex(team, clearUpgrade, "conserveBalls")).toBe(0);
  });
});

describe("creature score", () => {
  it("makes high-roll stats and premium STAB moves visibly lift team power", () => {
    const ordinary = scoreCreature({
      types: ["fire"],
      stats: {
        hp: 62,
        attack: 56,
        defense: 50,
        special: 58,
        speed: 54,
      },
      moves: [move("ember", "fire", 40), move("scratch", "normal", 40)],
    });
    const standout = scoreCreature({
      types: ["fire"],
      stats: {
        hp: 74,
        attack: 70,
        defense: 61,
        special: 88,
        speed: 82,
      },
      moves: [
        move("flamethrower", "fire", 95),
        move("slash", "normal", 70),
        move("bite", "dark", 60),
      ],
    });

    expect(standout - ordinary).toBeGreaterThanOrEqual(160);
    expect(standout / ordinary).toBeGreaterThanOrEqual(1.45);
  });
});

const tackle: MoveDefinition = {
  id: "tackle",
  name: "Tackle",
  type: "normal",
  power: 40,
  accuracy: 1,
  category: "physical",
  priority: 0,
  flags: [],
  statChanges: [],
  meta: {
    drain: 0,
    healing: 0,
    critRate: 0,
    ailmentChance: 0,
    flinchChance: 0,
    statChance: 0,
  },
};

function move(id: string, type: MoveDefinition["type"], power: number): MoveDefinition {
  return {
    id,
    name: id,
    type,
    power,
    accuracy: 1,
    category: "physical",
    priority: 0,
    flags: [],
    statChanges: [],
    meta: {
      drain: 0,
      healing: 0,
      critRate: 0,
      ailmentChance: 0,
      flinchChance: 0,
      statChance: 0,
    },
  };
}

function creature(instanceId: string, powerScore: number): Creature {
  return {
    instanceId,
    speciesId: 1,
    speciesName: instanceId,
    types: ["normal"],
    stats: {
      hp: 100,
      attack: 50,
      defense: 50,
      special: 50,
      speed: 50,
    },
    currentHp: 100,
    moves: [tackle],
    rarityScore: 1,
    powerScore,
    captureRate: 1,
  };
}
