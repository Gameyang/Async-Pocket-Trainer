import { describe, expect, it } from "vitest";

import { HeadlessGameClient, type HeadlessClientSnapshot } from "./headlessClient";
import { createTrainerSnapshot } from "./sync/trainerSnapshot";

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

  it("uses matching local trainer snapshots for checkpoint PvP encounters", () => {
    const opponent = new HeadlessGameClient({
      seed: "dummy-opponent",
      trainerName: "Dummy Rival",
    });
    opponent.dispatch({ type: "START_RUN", starterSpeciesId: 4 });
    const opponentSnapshot = createTrainerSnapshot(opponent.getSnapshot(), {
      playerId: "dummy-rival",
      createdAt: "2026-05-12T00:00:00.000Z",
      runSummary: opponent.getRunSummary(),
      wave: 5,
    });
    const challenger = new HeadlessGameClient({
      seed: "dummy-challenger",
      trainerSnapshots: [opponentSnapshot],
      balance: {
        wildStatGrowthPerWave: 0,
        trainerStatGrowthPerWave: 0,
        battleDamageScale: 0.08,
      },
    });

    challenger.autoPlay({ maxWaves: 4, strategy: "greedy" });
    expect(challenger.getSnapshot().currentWave).toBe(5);

    challenger.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    const snapshot = challenger.getSnapshot();

    expect(snapshot.lastBattle?.kind).toBe("trainer");
    expect(snapshot.lastBattle?.encounterSource).toBe("sheet");
    expect(snapshot.lastBattle?.opponentName).toContain("Dummy Rival 기록");
    expect(snapshot.lastBattle?.enemyTeam[0].instanceId).toBe(opponentSnapshot.team[0].creatureId);
    expect(snapshot.events.some((event) => event.message.includes("Dummy Rival 기록"))).toBe(true);
  });

  it("covers core user input paths through FrameAction dispatch", () => {
    const shopClient = startFromFrameAction("input-shop");
    const shopFrame = shopClient.getFrame();
    expect(shopFrame.actions.map((action) => action.id)).toEqual([
      "route:normal",
      "route:elite",
      "route:supply",
      "encounter:next",
      "shop:rest",
      "shop:pokeball",
      "shop:greatball",
    ]);
    dispatchFrameAction(shopClient, "route:elite");
    expect(shopClient.getSnapshot().selectedRoute).toMatchObject({ id: "elite", wave: 1 });
    dispatchFrameAction(shopClient, "shop:rest");
    dispatchFrameAction(shopClient, "shop:pokeball");
    expect(shopClient.getSnapshot().events.map((event) => event.type)).toContain("team_rested");
    expect(shopClient.getSnapshot().events.map((event) => event.type)).toContain("ball_bought");

    const skipClient = startFromFrameAction("input-skip");
    dispatchFrameAction(skipClient, "encounter:next");
    expect(skipClient.getSnapshot().phase).toBe("captureDecision");
    dispatchFrameAction(skipClient, "capture:skip");
    expect(skipClient.getSnapshot()).toMatchObject({
      phase: "ready",
      currentWave: 2,
    });

    const captureClient = startFromFrameAction("capture-1");
    dispatchFrameAction(captureClient, "encounter:next");
    dispatchFrameAction(captureClient, "capture:greatball");
    expect(captureClient.getSnapshot().phase).toBe("teamDecision");
    dispatchFrameAction(captureClient, "team:keep");
    expect(captureClient.getSnapshot()).toMatchObject({
      phase: "ready",
      currentWave: 2,
    });
    expect(captureClient.getSnapshot().team).toHaveLength(2);

    const restartClient = startFromFrameAction("input-restart");
    const gameOverSnapshot = restartClient.saveSnapshot();
    gameOverSnapshot.state.phase = "gameOver";
    gameOverSnapshot.state.gameOverReason = "Restart coverage.";
    const restored = HeadlessGameClient.fromSnapshot(gameOverSnapshot);
    dispatchFrameAction(restored, "start:4");
    expect(restored.getSnapshot()).toMatchObject({
      phase: "ready",
      currentWave: 1,
    });
    expect(restored.getSnapshot().team[0].speciesId).toBe(4);
  });

  it("limits supply route value to once per wave", () => {
    const client = startFromFrameAction("supply-limit");
    const damaged = client.saveSnapshot();
    damaged.state.money = 50;
    damaged.state.team = damaged.state.team.map((creature) => ({
      ...creature,
      currentHp: 1,
    }));
    client.loadSnapshot(damaged);

    dispatchFrameAction(client, "route:supply");
    dispatchFrameAction(client, "encounter:next");
    const afterFirst = client.getSnapshot();
    const supplyCost = client.getBalance().supplyRouteCost;
    expect(afterFirst.money).toBe(50 - supplyCost);
    expect(afterFirst.team[0].currentHp).toBeGreaterThan(1);
    expect(afterFirst.supplyUsedAtWave).toBe(afterFirst.currentWave);

    const redamaged = client.saveSnapshot();
    redamaged.state.team[0] = {
      ...redamaged.state.team[0],
      currentHp: 1,
    };
    redamaged.state.selectedRoute = {
      id: "supply",
      wave: afterFirst.currentWave,
    };
    client.loadSnapshot(redamaged);
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    expect(client.getSnapshot().money).toBe(afterFirst.money);
    expect(client.getSnapshot().team[0].currentHp).toBe(1);
    expect(client.getSnapshot().events.at(-1)?.type).toBe("supply_denied");
  });

  it("ignores stale saved route choices from older waves", () => {
    const client = startFromFrameAction("stale-route");
    const saved = client.saveSnapshot();
    saved.state.selectedRoute = {
      id: "elite",
      wave: 0,
    };
    const restored = HeadlessGameClient.fromSnapshot(saved);

    restored.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    expect(restored.getSnapshot().lastBattle?.encounterRoute).toBe("normal");
  });
});

function startFromFrameAction(seed: string): HeadlessGameClient {
  const client = new HeadlessGameClient({ seed });
  dispatchFrameAction(client, "start:1");
  return client;
}

function dispatchFrameAction(client: HeadlessGameClient, actionId: string): void {
  const action = client.getFrame().actions.find((candidate) => candidate.id === actionId);

  if (!action || !action.enabled) {
    throw new Error(`Missing enabled frame action ${actionId}`);
  }

  client.dispatch(action.action);
}
