import { describe, expect, it } from "vitest";

import { HeadlessGameClient, type HeadlessClientSnapshot } from "./headlessClient";
import { getMove, getSpecies } from "./data/catalog";
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

  it("rolls starter creature stats when the run starts", () => {
    const statKeys = Array.from({ length: 8 }, (_, index) => {
      const client = new HeadlessGameClient({ seed: `starter-roll-${index}` });
      client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
      const starter = client.getSnapshot().team[0];

      return [
        starter.stats.hp,
        starter.stats.attack,
        starter.stats.defense,
        starter.stats.special,
        starter.stats.speed,
      ].join(":");
    });

    expect(new Set(statKeys).size).toBeGreaterThan(1);
  });

  it("keeps dex and skill TP rewards pending until the player claims them", () => {
    const client = new HeadlessGameClient({ seed: "manual-dex-rewards" });

    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const started = client.getSnapshot();
    const starterMoveId = started.team[0].moves[0].id;

    expect(started.unlockedSpeciesIds).toContain(1);
    expect(started.unlockedMoveIds).toContain(starterMoveId);
    expect(client.getMetaCurrency().trainerPoints).toBe(0);
    expect(client.getFrame().entities[0].moveDex).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moveId: starterMoveId,
          unlocked: true,
          rewardClaimable: true,
        }),
      ]),
    );

    dispatchFrameAction(client, `claim:skill:${starterMoveId}`);
    const afterSkillClaim = client.getMetaCurrency().trainerPoints;
    expect(afterSkillClaim).toBeGreaterThan(0);
    expect(client.getFrame().actions.map((action) => action.id)).not.toContain(
      `claim:skill:${starterMoveId}`,
    );

    const gameOverSnapshot = client.saveSnapshot();
    gameOverSnapshot.state.phase = "gameOver";
    client.loadSnapshot(gameOverSnapshot);
    dispatchFrameAction(client, "restart:starter-choice");
    dispatchFrameAction(client, "claim:dex:1");

    expect(client.getMetaCurrency().trainerPoints).toBeGreaterThan(afterSkillClaim);
    expect(client.getFrame().actions.map((action) => action.id)).not.toContain("claim:dex:1");
  });

  it("teaches moves only from the target species learnset and disables invalid targets", () => {
    const client = new HeadlessGameClient({ seed: "learnset-tm-targets" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const charmanderClient = new HeadlessGameClient({ seed: "learnset-tm-targets-charmander" });
    charmanderClient.dispatch({ type: "START_RUN", starterSpeciesId: 4 });

    const saved = client.saveSnapshot();
    saved.state.money = 500;
    saved.state.team = [saved.state.team[0], charmanderClient.getSnapshot().team[0]];
    saved.state.shopInventory = {
      wave: saved.state.currentWave,
      rerollCount: 0,
      entries: [{ actionId: "shop:teach-move:fire", stock: 1, initialStock: 1 }],
    };
    client.loadSnapshot(saved);

    const [bulbasaur, charmander] = client.getSnapshot().team;
    const fireAction = client
      .getFrame()
      .actions.find((action) => action.id === "shop:teach-move:fire");

    expect(fireAction?.enabled).toBe(true);
    expect(fireAction?.eligibleTargetIds).toEqual([charmander.instanceId]);

    const beforeDeniedMoney = client.getSnapshot().money;
    client.dispatch({
      type: "BUY_TEACH_MOVE",
      element: "fire",
      targetEntityId: bulbasaur.instanceId,
    });
    expect(client.getSnapshot().money).toBe(beforeDeniedMoney);
    expect(client.getSnapshot().events.at(-1)?.type).toBe("teach_move_denied");

    client.dispatch({
      type: "BUY_TEACH_MOVE",
      element: "fire",
      targetEntityId: charmander.instanceId,
    });
    const learnedMoveId = client.getSnapshot().events.at(-1)?.data?.move;
    const charmanderLearnset = new Set(
      getSpecies(charmander.speciesId).levelUpMoves.map((entry) => entry.moveId),
    );

    expect(typeof learnedMoveId).toBe("string");
    expect(charmanderLearnset.has(String(learnedMoveId))).toBe(true);
    expect(getMove(String(learnedMoveId)).type).toBe("fire");
  });

  it("sorts team order through shop sorting items", () => {
    const client = new HeadlessGameClient({ seed: "team-sort-shop" });
    const charmanderClient = new HeadlessGameClient({ seed: "team-sort-shop-charmander" });
    const squirtleClient = new HeadlessGameClient({ seed: "team-sort-shop-squirtle" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    charmanderClient.dispatch({ type: "START_RUN", starterSpeciesId: 4 });
    squirtleClient.dispatch({ type: "START_RUN", starterSpeciesId: 7 });

    const saved = client.saveSnapshot();
    const bulbasaur = saved.state.team[0];
    const charmander = charmanderClient.getSnapshot().team[0];
    const squirtle = squirtleClient.getSnapshot().team[0];
    saved.state.money = 20;
    saved.state.team = [
      {
        ...bulbasaur,
        instanceId: "sort-low",
        powerScore: 10,
        currentHp: Math.max(1, Math.floor(bulbasaur.stats.hp * 0.9)),
      },
      {
        ...charmander,
        instanceId: "sort-high",
        powerScore: 30,
        currentHp: Math.max(1, Math.floor(charmander.stats.hp * 0.6)),
      },
      {
        ...squirtle,
        instanceId: "sort-mid",
        powerScore: 20,
        currentHp: Math.max(1, Math.floor(squirtle.stats.hp * 0.3)),
      },
    ];
    saved.state.shopInventory = {
      wave: saved.state.currentWave,
      rerollCount: 0,
      entries: [
        { actionId: "shop:team-sort:power:desc", stock: 1, initialStock: 1 },
        { actionId: "shop:team-sort:health:asc", stock: 1, initialStock: 1 },
      ],
    };
    client.loadSnapshot(saved);

    const expectedPowerDescendingOrder = client
      .getSnapshot()
      .team.slice()
      .sort((left, right) => right.powerScore - left.powerScore)
      .map((creature) => creature.instanceId);
    dispatchFrameAction(client, "shop:team-sort:power:desc");
    expect(client.getSnapshot().team.map((creature) => creature.instanceId)).toEqual(
      expectedPowerDescendingOrder,
    );
    expect(client.getSnapshot().money).toBe(17);
    expect(client.getSnapshot().events.at(-1)?.type).toBe("team_sorted");
    expect(
      client
        .getSnapshot()
        .shopInventory?.entries.find((entry) => entry.actionId === "shop:team-sort:power:desc")
        ?.stock,
    ).toBe(0);

    const expectedHealthAscendingOrder = client
      .getSnapshot()
      .team.slice()
      .sort((left, right) => left.currentHp / left.stats.hp - right.currentHp / right.stats.hp)
      .map((creature) => creature.instanceId);
    dispatchFrameAction(client, "shop:team-sort:health:asc");
    expect(client.getSnapshot().team.map((creature) => creature.instanceId)).toEqual(
      expectedHealthAscendingOrder,
    );
    expect(client.getSnapshot().money).toBe(14);
  });

  it("rolls eight shop product items across every inventory group", () => {
    const client = new HeadlessGameClient({ seed: "shop-nine-grid" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });

    const inventory = client.getSnapshot().shopInventory;
    const groups = new Set(inventory?.entries.map((entry) => shopInventoryGroup(entry.actionId)));
    expect(inventory?.entries).toHaveLength(8);
    expect(groups).toEqual(new Set(["recovery", "balls", "encounter", "team", "premium"]));

    const productActionIds = client
      .getFrame()
      .actions.map((action) => action.id)
      .filter((id) => id.startsWith("shop:") && id !== "shop:reroll");

    expect(productActionIds).toHaveLength(8);
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
    const snapshot = shopClient.saveSnapshot();
    snapshot.state.money = 200;
    // Seed deterministic inventory for the assertions below
    snapshot.state.shopInventory = {
      wave: snapshot.state.currentWave,
      rerollCount: 0,
      entries: [
        { actionId: "shop:rest", stock: 1, initialStock: 1 },
        { actionId: "shop:pokeball", stock: 3, initialStock: 3 },
        { actionId: "shop:greatball", stock: 2, initialStock: 2 },
        { actionId: "shop:ultraball", stock: 2, initialStock: 2 },
        { actionId: "shop:heal:single:1", stock: 1, initialStock: 1 },
        { actionId: "shop:heal:team:1", stock: 1, initialStock: 1 },
        { actionId: "shop:rarity-boost:1", stock: 1, initialStock: 1 },
        { actionId: "shop:level-boost:1", stock: 1, initialStock: 1 },
        { actionId: "shop:type-lock:fire", stock: 1, initialStock: 1 },
        { actionId: "shop:stat-boost:hp:1", stock: 1, initialStock: 1 },
      ],
    };
    shopClient.loadSnapshot(snapshot);
    const shopFrame = shopClient.getFrame();
    expect(shopFrame.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        "encounter:next",
        "shop:rest",
        "shop:pokeball",
        "shop:greatball",
        "shop:ultraball",
        "shop:heal:single:1",
        "shop:heal:team:1",
        "shop:rarity-boost:1",
        "shop:level-boost:1",
        "shop:type-lock:fire",
        "shop:stat-boost:hp:1",
        "shop:reroll",
      ]),
    );
    dispatchFrameAction(shopClient, "shop:rarity-boost:1");
    expect(shopClient.getSnapshot().encounterBoost).toMatchObject({ rarityBonus: 0.1, wave: 1 });
    dispatchFrameAction(shopClient, "shop:level-boost:1");
    expect(shopClient.getSnapshot().encounterBoost).toMatchObject({ levelMin: 1, levelMax: 2 });
    dispatchFrameAction(shopClient, "shop:type-lock:fire");
    expect(shopClient.getSnapshot().encounterBoost).toMatchObject({ lockedType: "fire" });
    dispatchFrameAction(shopClient, "shop:stat-boost:hp:1");
    expect(shopClient.getSnapshot().team[0].stats.hp).toBeGreaterThan(
      snapshot.state.team[0].stats.hp,
    );
    dispatchFrameAction(shopClient, "shop:pokeball");
    dispatchFrameAction(shopClient, "shop:rest");
    expect(shopClient.getSnapshot().events.map((event) => event.type)).toContain("team_rested");
    expect(shopClient.getSnapshot().events.map((event) => event.type)).toContain("ball_bought");
    expect(shopClient.getSnapshot().events.map((event) => event.type)).toContain(
      "stat_boost_applied",
    );

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
    const pendingCapture = captureClient.getSnapshot().pendingCapture;
    if (!pendingCapture) {
      throw new Error("Expected a pending capture.");
    }
    const expectedCaptureHp = Math.ceil(pendingCapture.stats.hp * 0.5);
    expect(pendingCapture.currentHp).toBe(expectedCaptureHp);
    dispatchFrameAction(captureClient, "team:keep");
    expect(captureClient.getSnapshot()).toMatchObject({
      phase: "ready",
      currentWave: 2,
    });
    expect(captureClient.getSnapshot().team).toHaveLength(2);
    expect(
      captureClient
        .getSnapshot()
        .team.find((creature) => creature.instanceId === pendingCapture.instanceId)?.currentHp,
    ).toBe(expectedCaptureHp);

    const restartClient = startFromFrameAction("input-restart");
    const gameOverSnapshot = restartClient.saveSnapshot();
    gameOverSnapshot.state.phase = "gameOver";
    gameOverSnapshot.state.gameOverReason = "Restart coverage.";
    const restored = HeadlessGameClient.fromSnapshot(gameOverSnapshot);
    expect(restored.getFrame().actions.map((action) => action.id)).toEqual([
      "restart:team:0",
      "restart:starter-choice",
    ]);
    dispatchFrameAction(restored, "restart:team:0");
    expect(restored.getSnapshot()).toMatchObject({
      phase: "ready",
      currentWave: 1,
    });
    expect(restored.getSnapshot().team[0].speciesId).toBe(1);
    expect(restored.getSnapshot().team[0].currentHp).toBe(restored.getSnapshot().team[0].stats.hp);

    const starterRestored = HeadlessGameClient.fromSnapshot(gameOverSnapshot);
    dispatchFrameAction(starterRestored, "restart:starter-choice");
    expect(starterRestored.getSnapshot()).toMatchObject({
      phase: "starterChoice",
      currentWave: 1,
      team: [],
    });
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

    client.dispatch({ type: "CHOOSE_ROUTE", routeId: "supply" });
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

function shopInventoryGroup(actionId: string): string {
  if (actionId === "shop:rest" || actionId.startsWith("shop:heal:")) return "recovery";
  if (
    actionId === "shop:pokeball" ||
    actionId === "shop:greatball" ||
    actionId === "shop:ultraball" ||
    actionId === "shop:hyperball" ||
    actionId === "shop:masterball"
  ) {
    return "balls";
  }
  if (
    actionId.startsWith("shop:rarity-boost:") ||
    actionId.startsWith("shop:level-boost:") ||
    actionId.startsWith("shop:type-lock:")
  ) {
    return "encounter";
  }
  if (
    actionId.startsWith("shop:stat-boost:") ||
    actionId.startsWith("shop:teach-move:") ||
    actionId.startsWith("shop:team-sort:")
  ) {
    return "team";
  }
  if (actionId.startsWith("shop:premium:")) return "premium";
  return "unknown";
}
