import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "./headlessClient";

describe("HeadlessGameClient", () => {
  it("runs deterministic simulations without a DOM renderer", () => {
    const first = new HeadlessGameClient({ seed: "deterministic" });
    const second = new HeadlessGameClient({ seed: "deterministic" });

    first.autoPlay({ maxWaves: 8, strategy: "greedy" });
    second.autoPlay({ maxWaves: 8, strategy: "greedy" });

    expect(first.getSnapshot()).toEqual(second.getSnapshot());
  });

  it("keeps game state bounded through wave, capture, and team decisions", () => {
    const client = new HeadlessGameClient({ seed: "state-bounds" });
    const snapshot = client.autoPlay({ maxWaves: 10, strategy: "greedy" });

    expect(snapshot.currentWave).toBeGreaterThanOrEqual(1);
    expect(snapshot.money).toBeGreaterThanOrEqual(0);
    expect(snapshot.team.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.team.length).toBeLessThanOrEqual(6);
    expect(snapshot.team.every((creature) => creature.currentHp >= 0)).toBe(true);
  });
});
