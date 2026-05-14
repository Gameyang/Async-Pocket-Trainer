import { describe, expect, it } from "vitest";

import { sheetTrainerRowToValues } from "./googleSheetsAdapter";
import {
  createSyntheticTrainerSnapshot,
  createSyntheticTrainerSnapshots,
} from "./syntheticTrainerSnapshots";
import { parseSheetTrainerRow, serializeTrainerSnapshot } from "./trainerSnapshot";

describe("synthetic trainer snapshots", () => {
  it("creates deterministic Google Sheets-ready rows for checkpoint waves", () => {
    const options = {
      seed: "manual-seed",
      waves: [5, 10],
      countPerWave: 2,
      createdAt: "2026-05-15T00:00:00.000Z",
      maxAttempts: 120,
    };

    const first = createSyntheticTrainerSnapshots(options);
    const second = createSyntheticTrainerSnapshots(options);
    const rows = first.map(serializeTrainerSnapshot);

    expect(first).toEqual(second);
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.wave)).toEqual([5, 5, 10, 10]);
    expect(rows.every((row) => row.playerId.startsWith("synthetic-manual-seed-"))).toBe(true);
    expect(rows.every((row) => row.trainerName.startsWith("테스트 "))).toBe(true);
    expect(rows.every((row) => row.seed.startsWith("manual-seed:wave-"))).toBe(true);
    expect(rows.map(parseSheetTrainerRow)).toEqual(first);
    expect(rows.map(sheetTrainerRowToValues).every((values) => values.length === 9)).toBe(true);
  });

  it("rejects non-checkpoint waves", () => {
    expect(() =>
      createSyntheticTrainerSnapshot({
        seed: "manual-seed",
        wave: 6,
        index: 0,
        createdAt: "2026-05-15T00:00:00.000Z",
      }),
    ).toThrow(/checkpoint waves/);
  });
});
