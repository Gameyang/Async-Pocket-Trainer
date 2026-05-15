import { describe, expect, it } from "vitest";

import {
  buildShopEconomyDataset,
  formatShopEconomyDatasetCsv,
} from "./shopEconomyDataset";

describe("shop economy dataset", () => {
  it("builds multi-seed shop economy rows for larger balance samples", async () => {
    const dataset = await buildShopEconomyDataset({
      seed: "shop-economy-dataset-test",
      seedCount: 2,
      runs: 2,
      waves: 5,
      strategies: ["greedy"],
      generatedAt: "2026-05-15T00:00:00.000Z",
    });
    const csv = formatShopEconomyDatasetCsv(dataset);

    expect(dataset.generatedAt).toBe("2026-05-15T00:00:00.000Z");
    expect(dataset.options.totalRuns).toBe(4);
    expect(dataset.aggregate.runs).toBe(4);
    expect(dataset.aggregate.scenarioCount).toBe(2);
    expect(dataset.aggregate.invariantErrorCount).toBe(0);
    expect(dataset.strategies).toHaveLength(1);
    expect(dataset.scenarios).toHaveLength(2);
    expect(dataset.categoryRows.length).toBeGreaterThan(0);
    expect(dataset.waveRows.length).toBeGreaterThan(0);
    expect(dataset.categorySummaries.some((row) => row.scope === "all")).toBe(true);
    expect(dataset.waveSummaries.some((row) => row.scope === "greedy")).toBe(true);
    expect(dataset.aggregate.shopEconomy.totalCoinAvailable).toBe(
      dataset.aggregate.shopEconomy.totalStartingCoin +
        dataset.aggregate.shopEconomy.totalCoinEarned,
    );
    expect(csv.split("\n")[0]).toContain("rowType,scope,scenarioId");
    expect(csv).toContain("categorySummary");
    expect(csv).toContain("waveSummary");
  });
});
