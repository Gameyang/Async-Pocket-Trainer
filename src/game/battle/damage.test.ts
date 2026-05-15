import { describe, expect, it } from "vitest";

import { SeededRng } from "../rng";
import type { Creature, MoveDefinition } from "../types";
import { runAutoBattle } from "./battleEngine";
import { calculateDamage, estimateDamage, getTypeEffectiveness } from "./damage";

describe("battle damage rules", () => {
  it("applies type effectiveness including immunities", () => {
    expect(getTypeEffectiveness("fire", ["grass"])).toBe(2);
    expect(getTypeEffectiveness("electric", ["ground"])).toBe(0);
  });

  it("records guaranteed misses in the battle log and replay stream", () => {
    const miss = move({ id: "miss", name: "Miss", type: "normal", power: 40, accuracy: 0 });
    const result = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [creature("player", [miss])],
      enemyTeam: [creature("enemy", [miss])],
      rng: new SeededRng("miss-test"),
      maxTurns: 1,
    });

    expect(result.log).toHaveLength(2);
    expect(result.log.every((entry) => entry.missed)).toBe(true);
    expect(result.replay.filter((event) => event.type === "move.miss")).toHaveLength(2);
    expect(result.replay.filter((event) => event.type === "move.miss")).toEqual([
      expect.objectContaining({ moveType: "normal", moveCategory: "physical" }),
      expect.objectContaining({ moveType: "normal", moveCategory: "physical" }),
    ]);
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

  it("uses level in the classic damage formula and STAB multiplier", () => {
    const levelFive = creature("level-5", [tackle], { attack: 50, speed: 50 }, 5);
    const levelThirty = creature("level-30", [tackle], { attack: 50, speed: 50 }, 30);
    const defender = creature("defender", [tackle], { defense: 50 });
    const nonStab = { ...tackle, type: "fire" as const };

    expect(estimateDamage(levelThirty, defender, tackle)).toBeGreaterThan(
      estimateDamage(levelFive, defender, tackle),
    );
    expect(estimateDamage(levelFive, defender, tackle)).toBeGreaterThan(
      estimateDamage(levelFive, defender, nonStab),
    );
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
      normalizeLoadouts: false,
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
      normalizeLoadouts: false,
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
      normalizeLoadouts: false,
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

  it("uses priority before speed when ordering moves", () => {
    const quickAttack = move({
      id: "quick-attack",
      name: "Quick Attack",
      type: "normal",
      power: 40,
      accuracy: 1,
      priority: 1,
    });
    const result = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [creature("player", [quickAttack], { speed: 1 })],
      enemyTeam: [creature("enemy", [tackle], { speed: 100 })],
      rng: new AlwaysHitRng(),
      maxTurns: 1,
    });

    expect(result.log[0]).toMatchObject({ actorId: "player", move: "Quick Attack" });
  });

  it("chooses attack and support moves with a fixed 70/30 auto-battle split", () => {
    const growl = move({
      id: "growl",
      name: "Growl",
      type: "normal",
      power: 0,
      accuracy: 1,
      category: "status",
      statChanges: [{ stat: "attack", change: -1 }],
    });
    const lowRoll = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [creature("player", [tackle, growl], { speed: 100 })],
      enemyTeam: [creature("enemy", [tackle], { speed: 1 })],
      rng: new SequenceRng([0.69]),
      maxTurns: 1,
    });
    const supportBoundary = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [creature("player", [tackle, growl], { speed: 100 })],
      enemyTeam: [creature("enemy", [tackle], { speed: 1 })],
      rng: new SequenceRng([0.7]),
      maxTurns: 1,
    });

    expect(lowRoll.log[0]).toMatchObject({ actorId: "player", move: "Tackle" });
    expect(supportBoundary.log[0]).toMatchObject({ actorId: "player", move: "Growl" });
  });

  it("falls back to the usable attack when support moves are blocked", () => {
    const growl = move({
      id: "growl",
      name: "Growl",
      type: "normal",
      power: 0,
      accuracy: 1,
      category: "status",
      statChanges: [{ stat: "attack", change: -1 }],
    });
    const taunted = {
      ...creature("player", [tackle, growl], { speed: 100 }),
      volatile: { tauntTurns: 2 },
    };
    const result = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [taunted],
      enemyTeam: [creature("enemy", [tackle], { speed: 1 })],
      rng: new SequenceRng([0.99]),
      maxTurns: 1,
    });

    expect(result.log[0]).toMatchObject({ actorId: "player", move: "Tackle" });
  });

  it("keeps forced move rules ahead of weighted random move selection", () => {
    const growl = move({
      id: "growl",
      name: "Growl",
      type: "normal",
      power: 0,
      accuracy: 1,
      category: "status",
      statChanges: [{ stat: "attack", change: -1 }],
    });
    const locked = {
      ...creature("player", [tackle, growl], { speed: 100 }),
      volatile: { lockedMoveId: "growl", lockedTurns: 2 },
    };
    const result = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [locked],
      enemyTeam: [creature("enemy", [tackle], { speed: 1 })],
      rng: new SequenceRng([0]),
      maxTurns: 1,
    });

    expect(result.log[0]).toMatchObject({ actorId: "player", move: "Growl" });
  });

  it("activates the first living team member in slot order", () => {
    const result = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [
        { ...creature("slot-1", [tackle]), currentHp: 0 },
        creature("slot-2", [tackle], { speed: 100 }),
      ],
      enemyTeam: [creature("enemy", [tackle], { speed: 1 })],
      rng: new AlwaysHitRng(),
      maxTurns: 1,
    });

    expect(result.replay).toContainEqual(
      expect.objectContaining({
        type: "turn.start",
        activePlayerId: "slot-2",
      }),
    );
  });

  it("lets status-only stat moves change later damage", () => {
    const growl = move({
      id: "growl",
      name: "Growl",
      type: "normal",
      power: 0,
      accuracy: 1,
      category: "status",
      statChanges: [{ stat: "attack", change: -1 }],
    });
    const splash = move({
      id: "splash",
      name: "Splash",
      type: "normal",
      power: 0,
      accuracy: 1,
      category: "status",
      target: "user",
    });
    const weakened = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [creature("player", [growl], { speed: 100 })],
      enemyTeam: [creature("enemy", [tackle], { attack: 100, speed: 1 })],
      rng: new AlwaysHitRng(),
      maxTurns: 1,
    });
    const baseline = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [creature("player", [splash], { speed: 100 })],
      enemyTeam: [creature("enemy", [tackle], { attack: 100, speed: 1 })],
      rng: new AlwaysHitRng(),
      maxTurns: 1,
    });

    expect(weakened.log.find((entry) => entry.actorId === "enemy")?.damage).toBeLessThan(
      baseline.log.find((entry) => entry.actorId === "enemy")?.damage ?? 0,
    );
    expect(weakened.replay.some((event) => event.type === "move.effect")).toBe(true);
  });

  it("supports fixed-damage and multi-hit moves", () => {
    const sonicBoom = move({
      id: "sonic-boom",
      name: "Sonic Boom",
      type: "normal",
      power: 0,
      accuracy: 1,
      category: "special",
      effectId: 131,
    });
    const doubleHit = move({
      id: "double-hit",
      name: "Double Hit",
      type: "normal",
      power: 10,
      accuracy: 1,
      meta: {
        drain: 0,
        healing: 0,
        critRate: 0,
        ailmentChance: 0,
        flinchChance: 0,
        statChance: 0,
        minHits: 2,
        maxHits: 2,
      },
    });

    const fixed = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [creature("player", [sonicBoom], { speed: 100 })],
      enemyTeam: [creature("enemy", [tackle], { speed: 1 })],
      rng: new AlwaysHitRng(),
      maxTurns: 1,
    });
    const multi = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [creature("player", [doubleHit], { speed: 100 })],
      enemyTeam: [creature("enemy", [tackle], { speed: 1 })],
      rng: new AlwaysHitRng(),
      maxTurns: 1,
    });

    expect(fixed.log[0].damage).toBe(20);
    expect(multi.replay).toContainEqual(
      expect.objectContaining({ type: "move.effect", label: "Double Hit hit 2 times." }),
    );
  });

  it("applies drain and recoil effects", () => {
    const absorb = move({
      id: "absorb",
      name: "Absorb",
      type: "grass",
      power: 40,
      accuracy: 1,
      category: "special",
      meta: {
        drain: 50,
        healing: 0,
        critRate: 0,
        ailmentChance: 0,
        flinchChance: 0,
        statChance: 0,
      },
    });
    const takeDown = move({
      id: "take-down",
      name: "Take Down",
      type: "normal",
      power: 90,
      accuracy: 1,
      meta: {
        drain: -50,
        healing: 0,
        critRate: 0,
        ailmentChance: 0,
        flinchChance: 0,
        statChance: 0,
      },
    });
    const miss = move({ id: "miss", name: "Miss", type: "normal", power: 40, accuracy: 0 });
    const drained = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [{ ...creature("player", [absorb], { speed: 100 }), currentHp: 50 }],
      enemyTeam: [creature("enemy", [miss], { speed: 1 })],
      rng: new AlwaysHitRng(),
      maxTurns: 1,
    });
    const recoiled = runAutoBattle({
      kind: "wild",
      normalizeLoadouts: false,
      playerTeam: [creature("player", [takeDown], { speed: 100 })],
      enemyTeam: [creature("enemy", [miss], { speed: 1 })],
      rng: new AlwaysHitRng(),
      maxTurns: 1,
    });

    expect(drained.playerTeam[0].currentHp).toBeGreaterThan(50);
    expect(recoiled.playerTeam[0].currentHp).toBeLessThan(100);
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

class AlwaysHitRng extends SeededRng {
  constructor() {
    super("always-hit");
  }

  override nextFloat(): number {
    return 0.5;
  }

  override chance(probability: number): boolean {
    return probability > 0;
  }
}

class SequenceRng extends SeededRng {
  private index = 0;

  constructor(private readonly values: readonly number[]) {
    super("sequence");
  }

  override nextFloat(): number {
    const value = this.values[this.index] ?? 0.5;
    this.index += 1;
    return value;
  }
}

type MoveOptions = Pick<MoveDefinition, "id" | "name" | "type" | "power" | "accuracy"> &
  Partial<Omit<MoveDefinition, "id" | "name" | "type" | "power" | "accuracy" | "meta">> & {
    meta?: Partial<MoveDefinition["meta"]>;
  };

function move(options: MoveOptions) {
  return {
    ...options,
    category: options.category ?? "physical",
    priority: options.priority ?? 0,
    flags: options.flags ?? [],
    statChanges: options.statChanges ?? [],
    meta: {
      drain: 0,
      healing: 0,
      critRate: 0,
      ailmentChance: 0,
      flinchChance: 0,
      statChance: 0,
      ...options.meta,
    },
  } satisfies MoveDefinition;
}

function creature(
  instanceId: string,
  moves: MoveDefinition[],
  statOverrides: Partial<Creature["stats"]> = {},
  level = 20,
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
    level,
    stats,
    currentHp: stats.hp,
    moves,
    rarityScore: 1,
    powerScore: 1,
    captureRate: 1,
  };
}
