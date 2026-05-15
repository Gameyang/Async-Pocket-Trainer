import { describe, expect, it } from "vitest";

import {
  BATTLE_FIELD_WAVE_SPAN,
  battleFieldDefinitions,
  createBattleFieldOrder,
  normalizeBattleFieldOrder,
  resolveBattleFieldForWave,
} from "./battleField";
import { SeededRng } from "./rng";
import type { BattleFieldId } from "./types";

describe("battle field rotation", () => {
  it("rotates fields every five waves and alternates day/night by field block", () => {
    expect(resolveBattleFieldForWave(1)).toMatchObject({
      id: "forest",
      element: "grass",
      timeOfDay: "day",
      waveStart: 1,
      waveEnd: 5,
    });
    expect(resolveBattleFieldForWave(5)).toMatchObject({
      id: "forest",
      timeOfDay: "day",
    });
    expect(resolveBattleFieldForWave(6)).toMatchObject({
      id: "volcano",
      element: "fire",
      timeOfDay: "night",
      waveStart: 6,
      waveEnd: 10,
    });
    expect(resolveBattleFieldForWave(11)).toMatchObject({
      id: "ocean",
      element: "water",
      timeOfDay: "day",
    });
  });

  it("uses a run-specific field order when one is supplied", () => {
    const order: BattleFieldId[] = ["ocean", "city", "volcano", "forest"];

    expect(resolveBattleFieldForWave(1, order)).toMatchObject({
      id: "ocean",
      element: "water",
      timeOfDay: "day",
    });
    expect(resolveBattleFieldForWave(6, order)).toMatchObject({
      id: "city",
      element: "electric",
      timeOfDay: "night",
    });
    expect(resolveBattleFieldForWave(11, order)).toMatchObject({
      id: "volcano",
      element: "fire",
      timeOfDay: "day",
    });
  });

  it("creates a duplicate-free shuffled order for each run", () => {
    const defaultOrder = battleFieldDefinitions.map((definition) => definition.id);
    const firstOrder = createBattleFieldOrder(new SeededRng("field-order-a"));
    const secondOrder = createBattleFieldOrder(new SeededRng("field-order-b"));

    expect(firstOrder).toHaveLength(battleFieldDefinitions.length);
    expect(new Set(firstOrder).size).toBe(battleFieldDefinitions.length);
    expect(firstOrder).not.toEqual(defaultOrder);
    expect(secondOrder).not.toEqual(firstOrder);
  });

  it("normalizes saved field orders by removing duplicates and appending missing fields", () => {
    const order = normalizeBattleFieldOrder(["ocean", "ocean", "forest"]);

    expect(order.slice(0, 2)).toEqual(["ocean", "forest"]);
    expect(order).toHaveLength(battleFieldDefinitions.length);
    expect(new Set(order).size).toBe(battleFieldDefinitions.length);
  });

  it("wraps after all type fields have appeared", () => {
    const firstRepeatWave = battleFieldDefinitions.length * BATTLE_FIELD_WAVE_SPAN + 1;

    expect(resolveBattleFieldForWave(firstRepeatWave)).toMatchObject({
      id: "forest",
      element: "grass",
      timeOfDay: "day",
    });
  });
});
