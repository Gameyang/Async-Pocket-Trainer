import { describe, expect, it } from "vitest";

import { sheetTrainerRowToValues } from "./googleSheetsAdapter";
import {
  createSyntheticTrainerSnapshot,
  createSyntheticTrainerSnapshots,
} from "./syntheticTrainerSnapshots";
import { parseSheetTrainerRow, serializeTrainerSnapshot } from "./trainerSnapshot";

describe("synthetic trainer snapshots", () => {
  it("creates deterministic Google Sheets-ready rows for checkpoint waves", async () => {
    const options = {
      seed: "manual-seed",
      waves: [5, 10],
      countPerWave: 2,
      createdAt: "2026-05-15T00:00:00.000Z",
      maxAttempts: 120,
    };

    const first = await createSyntheticTrainerSnapshots(options);
    const second = await createSyntheticTrainerSnapshots(options);
    const rows = first.map(serializeTrainerSnapshot);

    expect(first).toEqual(second);
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.wave)).toEqual([5, 5, 10, 10]);
    expect(rows.every((row) => row.playerId.startsWith("synthetic-manual-seed-"))).toBe(true);
    expect(rows.every((row) => row.trainerName.startsWith("Synthetic"))).toBe(true);
    expect(rows.every((row) => row.seed.startsWith("manual-seed:wave-"))).toBe(true);
    expect(rows.map(parseSheetTrainerRow)).toEqual(first);
    expect(rows.map(sheetTrainerRowToValues).every((values) => values.length === 9)).toBe(true);
  }, 15_000);

  it("rejects non-checkpoint waves", async () => {
    await expect(
      createSyntheticTrainerSnapshot({
        seed: "manual-seed",
        wave: 6,
        index: 0,
        createdAt: "2026-05-15T00:00:00.000Z",
      }),
    ).rejects.toThrow(/checkpoint waves/);
  });

  it("uses explicitly provided trainer names", async () => {
    const snapshots = await createSyntheticTrainerSnapshots({
      seed: "named-seed",
      waves: [5],
      countPerWave: 2,
      trainerNames: ["Spark Tester", "Sleep Boss"],
      createdAt: "2026-05-15T00:00:00.000Z",
      maxAttempts: 120,
    });

    expect(snapshots.map((snapshot) => snapshot.trainerName)).toEqual([
      "Spark Tester",
      "Sleep Boss",
    ]);
  });
});
