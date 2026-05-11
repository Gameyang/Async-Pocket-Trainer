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
  });
});
