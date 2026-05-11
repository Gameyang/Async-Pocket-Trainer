import { describe, expect, it } from "vitest";

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
});
