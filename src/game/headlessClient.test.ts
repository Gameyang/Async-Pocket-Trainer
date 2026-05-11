import { describe, expect, it } from "vitest";

import { HeadlessGameClient, type HeadlessClientSnapshot } from "./headlessClient";

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

  it("saves and loads a run snapshot without changing deterministic continuation", () => {
    const original = new HeadlessGameClient({ seed: "save-load", trainerName: "Snapshot QA" });

    for (let step = 0; step < 7; step += 1) {
      original.autoStep("greedy");
    }

    const saved = original.saveSnapshot();
    const restored = HeadlessGameClient.fromSnapshot(saved);

    expect(restored.getSnapshot()).toEqual(original.getSnapshot());
    expect(restored.getFrame()).toEqual(original.getFrame());

    for (let step = 0; step < 8; step += 1) {
      expect(restored.autoStep("greedy")).toEqual(original.autoStep("greedy"));
    }

    expect(restored.saveSnapshot()).toEqual(original.saveSnapshot());
  });

  it("clones save snapshots at the client boundary", () => {
    const client = new HeadlessGameClient({ seed: "save-clone" });
    client.autoStep("greedy");

    const saved = client.saveSnapshot();
    saved.state.money = 99999;
    saved.balance.startingMoney = 99999;

    expect(client.getSnapshot().money).not.toBe(99999);
    expect(client.getBalance().startingMoney).not.toBe(99999);
  });

  it("rejects snapshots that cannot restore the RNG stream", () => {
    const client = new HeadlessGameClient({ seed: "bad-save" });
    const saved: HeadlessClientSnapshot = {
      ...client.saveSnapshot(),
      state: {
        ...client.getSnapshot(),
        rngState: 0,
      },
    };

    expect(() => HeadlessGameClient.fromSnapshot(saved)).toThrow(/Invalid snapshot RNG state/);
  });
});
