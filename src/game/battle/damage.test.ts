import { describe, expect, it } from "vitest";

import { SeededRng } from "../rng";
import type { Creature, MoveDefinition } from "../types";
import { runAutoBattle } from "./battleEngine";
import { calculateDamage, getTypeEffectiveness } from "./damage";

describe("battle damage rules", () => {
  it("applies type effectiveness including immunities", () => {
    expect(getTypeEffectiveness("fire", ["grass"])).toBe(2);
    expect(getTypeEffectiveness("electric", ["ground"])).toBe(0);
  });

  it("records guaranteed misses in the battle log and replay stream", () => {
    const miss = move({ id: "miss", name: "Miss", type: "normal", power: 40, accuracy: 0 });
    const result = runAutoBattle({
      kind: "wild",
      playerTeam: [creature("player", [miss])],
      enemyTeam: [creature("enemy", [miss])],
      rng: new SeededRng("miss-test"),
      maxTurns: 1,
    });

    expect(result.log).toHaveLength(2);
    expect(result.log.every((entry) => entry.missed)).toBe(true);
    expect(result.replay.filter((event) => event.type === "move.miss")).toHaveLength(2);
  });

  it("marks critical hits and increases damage", () => {
    const attacker = creature("attacker", [tackle], { speed: 999 });
    const defender = creature("defender", [tackle]);
    const normal = calculateDamage(attacker, defender, tackle, new FixedChanceRng(false));
    const critical = calculateDamage(attacker, defender, tackle, new FixedChanceRng(true));

    expect(normal.critical).toBe(false);
    expect(critical.critical).toBe(true);
    expect(critical.damage).toBeGreaterThan(normal.damage);
  });

  it("applies status ailments and residual poison damage through replay events", () => {
    const poisonSting = move({
      id: "poison-sting",
      name: "Poison Sting",
      type: "poison",
      power: 1,
      accuracy: 1,
      statusEffect: { status: "poison", chance: 1 },
    });
    const result = runAutoBattle({
      kind: "wild",
      playerTeam: [creature("player", [poisonSting], { speed: 100 })],
      enemyTeam: [creature("enemy", [tackle], { speed: 1 })],
      rng: new FixedChanceRng(true),
      maxTurns: 1,
    });

    const statusApply = result.replay.find((event) => event.type === "status.apply");
    const poisonTick = result.replay.find((event) => event.type === "status.tick");

    expect(statusApply).toMatchObject({ status: "poison", targetId: "enemy" });
    expect(poisonTick).toMatchObject({ status: "poison", entityId: "enemy", damage: 12 });
    expect(result.enemyTeam[0].status).toBeUndefined();
  });

  it("skips turns for sleep effects", () => {
    const sleepTap = move({
      id: "sleep-tap",
      name: "Sleep Tap",
      type: "psychic",
      power: 1,
      accuracy: 1,
      statusEffect: { status: "sleep", chance: 1 },
    });
    const result = runAutoBattle({
      kind: "wild",
      playerTeam: [creature("player", [sleepTap], { speed: 100 })],
      enemyTeam: [creature("enemy", [tackle], { speed: 1 })],
      rng: new FixedChanceRng(true),
      maxTurns: 1,
    });

    expect(result.replay).toContainEqual(
      expect.objectContaining({
        type: "turn.skip",
        entityId: "enemy",
        status: "sleep",
      }),
    );
  });

  it("records status immunity instead of applying blocked ailments", () => {
    const ember = move({
      id: "ember",
      name: "Ember",
      type: "fire",
      power: 1,
      accuracy: 1,
      statusEffect: { status: "burn", chance: 1 },
    });
    const result = runAutoBattle({
      kind: "wild",
      playerTeam: [creature("player", [ember], { speed: 100 })],
      enemyTeam: [{ ...creature("enemy", [tackle], { speed: 1 }), types: ["fire"] }],
      rng: new FixedChanceRng(true),
      maxTurns: 1,
    });

    expect(result.replay).toContainEqual(
      expect.objectContaining({
        type: "status.immune",
        targetId: "enemy",
        status: "burn",
      }),
    );
    expect(result.replay.some((event) => event.type === "status.apply")).toBe(false);
  });

  it("reduces physical damage from burned attackers", () => {
    const attacker = creature("attacker", [tackle], { attack: 100 });
    const burnedAttacker = {
      ...attacker,
      status: { type: "burn" as const },
    };
    const defender = creature("defender", [tackle]);
    const normal = calculateDamage(attacker, defender, tackle, new FixedChanceRng(false));
    const burned = calculateDamage(burnedAttacker, defender, tackle, new FixedChanceRng(false));

    expect(burned.damage).toBeLessThan(normal.damage);
  });
});

const tackle = move({
  id: "tackle",
  name: "Tackle",
  type: "normal",
  power: 40,
  accuracy: 1,
});

class FixedChanceRng extends SeededRng {
  constructor(private readonly chanceValue: boolean) {
    super("fixed");
  }

  override nextFloat(): number {
    return 0.5;
  }

  override chance(_probability: number): boolean {
    return this.chanceValue;
  }
}

function move(
  options: Pick<MoveDefinition, "id" | "name" | "type" | "power" | "accuracy"> &
    Partial<Pick<MoveDefinition, "category" | "statusEffect">>,
) {
  return {
    ...options,
    category: options.category ?? "physical",
  } satisfies MoveDefinition;
}

function creature(
  instanceId: string,
  moves: MoveDefinition[],
  statOverrides: Partial<Creature["stats"]> = {},
): Creature {
  const stats = {
    hp: 100,
    attack: 50,
    defense: 50,
    special: 50,
    speed: 50,
    ...statOverrides,
  };

  return {
    instanceId,
    speciesId: 1,
    speciesName: instanceId,
    types: ["normal"],
    stats,
    currentHp: stats.hp,
    moves,
    rarityScore: 1,
    powerScore: 1,
    captureRate: 1,
  };
}
