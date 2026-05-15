import { describe, expect, it } from "vitest";

import { runAutoBattle } from "./battle/battleEngine";
import { defaultBalance, getMove, getUnlockedLevelUpMoveIds } from "./data/catalog";
import {
  cloneCreature,
  createCreature,
  normalizeCreatureBattleLoadout,
  replaceCreatureMoveByRole,
} from "./creatureFactory";
import { SeededRng } from "./rng";
import type { Creature, MoveDefinition } from "./types";

describe("creature cloning", () => {
  it("normalizes legacy saved moves that predate battle metadata fields", () => {
    const legacyTackle = {
      id: "tackle",
      name: "Tackle",
      type: "normal",
      power: 40,
      accuracy: 1,
      category: "physical",
    } as MoveDefinition;
    const cloned = cloneCreature(creature("legacy", [legacyTackle]));

    expect(cloned.moves[0]).toMatchObject({
      id: "tackle",
      priority: 0,
      flags: expect.any(Array),
      statChanges: expect.any(Array),
      meta: expect.objectContaining({ drain: 0 }),
    });
  });

  it("can battle with a creature loaded from an older move schema", () => {
    const legacyQuickAttack = {
      id: "quick-attack",
      name: "Quick Attack",
      type: "normal",
      power: 40,
      accuracy: 1,
      category: "physical",
    } as MoveDefinition;
    const result = runAutoBattle({
      kind: "wild",
      playerTeam: [creature("player", [legacyQuickAttack])],
      enemyTeam: [creature("enemy", [legacyQuickAttack])],
      rng: new SeededRng("legacy-move"),
      maxTurns: 1,
    });

    expect(result.replay.at(-1)).toMatchObject({ type: "battle.end" });
  });
});

describe("creature move assignment", () => {
  it("uses original opening move loadouts for level-five starters", () => {
    const expectedMovesByStarter = new Map([
      [1, ["tackle", "growl"]],
      [4, ["scratch", "growl"]],
      [7, ["tackle", "tail-whip"]],
    ]);

    for (const [speciesId, expectedMoves] of expectedMovesByStarter) {
      for (let index = 0; index < 8; index += 1) {
        const created = createCreature({
          rng: new SeededRng(`opening-starter-${speciesId}-${index}`),
          wave: 1,
          balance: defaultBalance,
          speciesId,
          level: 5,
          role: "starter",
        });

        expect(created.moves.map((move) => move.id)).toEqual(expectedMoves);
      }
    }
  });

  it("assigns exactly one attack and one support move", () => {
    const created = createCreature({
      rng: new SeededRng("expanded-move-pool"),
      wave: 1,
      balance: defaultBalance,
      speciesId: 1,
      role: "wild",
    });

    expect(created.moves).toHaveLength(2);
    expect(created.level).toBe(1);
    expect(created.statProfile).toBeDefined();
    expect(created.statBonuses).toEqual({
      hp: 0,
      attack: 0,
      defense: 0,
      special: 0,
      speed: 0,
    });
    expect(created.moves.filter((move) => move.category !== "status")).toHaveLength(1);
    expect(created.moves.filter((move) => move.category === "status")).toHaveLength(1);
  });

  it("samples only moves unlocked by the creature level before fallback", () => {
    const created = createCreature({
      rng: new SeededRng("level-gated-pikachu"),
      wave: 20,
      balance: defaultBalance,
      speciesId: 25,
      role: "wild",
    });
    const unlocked = getUnlockedLevelUpMoveIds(25, 20);

    expect(created.level).toBe(20);
    expect(created.moves.map((move) => move.id).every((moveId) => unlocked.includes(moveId))).toBe(
      true,
    );
    expect(created.moves.map((move) => move.id)).not.toContain("thunderbolt");
  });

  it("uses tackle as the strict attack fallback for support-only species", () => {
    for (const speciesId of [11, 14, 132]) {
      const created = createCreature({
        rng: new SeededRng(`support-only-${speciesId}`),
        wave: 1,
        balance: defaultBalance,
        speciesId,
        role: "wild",
      });

      expect(created.moves.map((move) => move.category)).toEqual(["physical", "status"]);
      expect(created.moves[0].id).toBe("tackle");
    }
  });

  it("uses the attack fallback for weak off-type level-one attacks", () => {
    const created = createCreature({
      rng: new SeededRng("weak-off-type-attack"),
      wave: 1,
      balance: defaultBalance,
      speciesId: 41,
      role: "wild",
    });

    expect(created.moves.map((move) => move.category)).toEqual(["physical", "status"]);
    expect(created.moves[0].id).toBe("tackle");
  });

  it("uses harden as the strict support fallback for attack-only low-level species", () => {
    const created = createCreature({
      rng: new SeededRng("attack-only-low-level"),
      wave: 1,
      balance: defaultBalance,
      speciesId: 4,
      role: "wild",
    });

    expect(created.moves.map((move) => move.id)).toEqual(["scratch", "harden"]);
    expect(created.moves.map((move) => move.category)).toEqual(["physical", "status"]);
  });

  it("replaces learned moves in the matching auto-battle role slot", () => {
    const base = createCreature({
      rng: new SeededRng("role-slot-learning"),
      wave: 1,
      balance: defaultBalance,
      speciesId: 4,
      role: "wild",
    });
    const withAttack = replaceCreatureMoveByRole(base, getMove("ember"));
    const withSupport = replaceCreatureMoveByRole(base, getMove("growl"));

    expect(withAttack.map((move) => move.id)).toEqual(["ember", "harden"]);
    expect(withSupport.map((move) => move.id)).toEqual(["scratch", "growl"]);
  });

  it("normalizes restored battle loadouts to one attack and one support move", () => {
    const restored = normalizeCreatureBattleLoadout(
      creature("restored", [
        {
          id: "scratch",
          name: "Scratch",
          type: "normal",
          power: 40,
          accuracy: 1,
          category: "physical",
        } as MoveDefinition,
      ]),
    );

    expect(restored.moves).toHaveLength(2);
    expect(restored.moves.filter((move) => move.category !== "status")).toHaveLength(1);
    expect(restored.moves.filter((move) => move.category === "status")).toHaveLength(1);
  });
});

function creature(instanceId: string, moves: MoveDefinition[]): Creature {
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
    moves,
    rarityScore: 1,
    powerScore: 1,
    captureRate: 1,
  };
}
