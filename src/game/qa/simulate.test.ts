import { describe, expect, it } from "vitest";

import { compareHeadlessQaReports, summarizeHeadlessQaReport } from "./reportSummary";
import { runHeadlessQa } from "./simulate";

describe("headless QA simulation", () => {
  it("reports invariant failures separately from rendering", () => {
    const report = runHeadlessQa({
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

  it("keeps 30-wave autoplay progression viable for long-run QA", () => {
    const report = runHeadlessQa({
      seed: "long-run-regression",
      runs: 20,
      waves: 30,
      strategy: "greedy",
    });

    expect(report.invariantErrors).toEqual([]);
    expect(report.aggregate.completedTargetWave).toBeGreaterThanOrEqual(5);
    expect(report.aggregate.averageFinalWave).toBeGreaterThanOrEqual(22);
  });

  it("produces deterministic seed replay summaries and balance comparison deltas", () => {
    const options = {
      seed: "replay-summary",
      runs: 4,
      waves: 6,
      strategy: "greedy" as const,
    };
    const first = runHeadlessQa(options);
    const second = runHeadlessQa(options);
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
