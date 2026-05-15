import { describe, expect, it } from "vitest";

import { compareHeadlessQaReports, summarizeHeadlessQaReport } from "./reportSummary";
import { runHeadlessQa } from "./simulate";

describe("headless QA simulation", () => {
  it("reports invariant failures separately from rendering", async () => {
    const report = await runHeadlessQa({
      seed: "qa-test",
      runs: 8,
      waves: 8,
      strategy: "greedy",
    });

    expect(report.invariantErrors).toEqual([]);
    expect(report.aggregate.runs).toBe(8);
    expect(report.aggregate.averageFinalWave).toBeGreaterThan(1);
    expect(report.waveBalance.length).toBeGreaterThan(0);
    expect(report.waveBalance[0]).toMatchObject({
      wave: 1,
      battleResults: expect.any(Number),
      averageTeamPower: expect.any(Number),
      teamPowerDistribution: expect.objectContaining({
        min: expect.any(Number),
        median: expect.any(Number),
        max: expect.any(Number),
      }),
      captureSuccessRate: expect.any(Number),
    });
  });

  it("keeps 30-wave autoplay progression viable for long-run QA", async () => {
    const report = await runHeadlessQa({
      seed: "long-run-regression",
      runs: 20,
      waves: 30,
      strategy: "greedy",
    });

    expect(report.invariantErrors).toEqual([]);
    // 게임 밸런스(레벨 시스템, 보급 제거, 인벤토리 제약) 조정에 맞춰 임계값 완화
    // Captured teammates now join at half HP, lowering this deterministic autoplay floor.
    expect(report.aggregate.averageFinalWave).toBeGreaterThanOrEqual(6);
  }, 15_000);

  it("reports shop price economy pressure for balance checks", async () => {
    const report = await runHeadlessQa({
      seed: "shop-price-balance",
      runs: 12,
      waves: 18,
      strategy: "greedy",
    });
    const economy = report.shopEconomy.aggregate;
    const categories = new Map(
      report.shopEconomy.categories.map((category) => [category.category, category]),
    );

    expect(report.invariantErrors).toEqual([]);
    expect(economy.readyFrames).toBeGreaterThan(0);
    expect(economy.coinOfferSamples).toBeGreaterThan(0);
    expect(economy.totalCoinEarned).toBeGreaterThan(0);
    expect(economy.coinPurchases).toBeGreaterThan(0);
    expect(economy.averageCheapestCoinOffer).toBeLessThanOrEqual(economy.averageMoneyAtShop);
    expect(economy.coinOfferMoneyAffordableRate).toBeGreaterThanOrEqual(0.2);
    expect(economy.spendToIncomeRatio).toBeGreaterThanOrEqual(0.05);
    expect(economy.spendToAvailableCoinRatio).toBeLessThanOrEqual(0.95);
    expect(categories.get("capture")?.purchases ?? 0).toBeGreaterThan(0);
    expect(categories.get("recovery")?.offerSamples ?? 0).toBeGreaterThan(0);
    expect(categories.get("teamUpgrade")?.moneyBlockedRate ?? 0).toBeLessThan(0.9);
  });

  it("produces deterministic seed replay summaries and balance comparison deltas", async () => {
    const options = {
      seed: "replay-summary",
      runs: 4,
      waves: 6,
      strategy: "greedy" as const,
    };
    const first = await runHeadlessQa(options);
    const second = await runHeadlessQa(options);
    const summary = summarizeHeadlessQaReport(first);
    const comparison = compareHeadlessQaReports(first, second);

    expect(second).toEqual(first);
    expect(summary).toMatchObject({
      options,
      invariantErrorCount: 0,
      aggregate: expect.objectContaining({
        runs: 4,
      }),
    });
    expect(summary.waves[0]).toMatchObject({
      wave: 1,
      battleWinRate: expect.any(Number),
      medianTeamPower: expect.any(Number),
    });
    expect(comparison.delta).toEqual({
      completedTargetWave: 0,
      gameOvers: 0,
      averageFinalWave: 0,
      averageTeamPower: 0,
      averageHealthRatio: 0,
    });
  });
});
