import { describe, expect, it } from "vitest";

import { createCreature } from "./creatureFactory";
import { HeadlessGameClient } from "./headlessClient";
import { SeededRng } from "./rng";
import type { Creature } from "./types";

describe("premium shop creature exchange effects", () => {
  it("sells a selected creature for coins based on strength", () => {
    const client = readyClientWithTeam("premium-sell-coin", [25, 1]);
    const before = client.getSnapshot();
    const sold = before.team[0];

    client.dispatch({
      type: "BUY_PREMIUM_SHOP_ITEM",
      offerId: "premium:sell:coin",
      targetEntityId: sold.instanceId,
    });

    const after = client.getSnapshot();
    expect(after.team.map((creature) => creature.instanceId)).not.toContain(sold.instanceId);
    expect(after.money).toBeGreaterThan(before.money);
    expect(after.metaCurrency?.trainerPoints).toBe(58);
  });

  it("sells a selected creature for random ball loot", () => {
    const client = readyClientWithTeam("premium-sell-ball", [25, 1]);
    const before = client.getSnapshot();
    const beforeBallCount = countBalls(before.balls);

    client.dispatch({
      type: "BUY_PREMIUM_SHOP_ITEM",
      offerId: "premium:sell:ball",
      targetEntityId: before.team[0].instanceId,
    });

    const after = client.getSnapshot();
    expect(after.team).toHaveLength(1);
    expect(countBalls(after.balls)).toBeGreaterThan(beforeBallCount);
    expect(after.metaCurrency?.trainerPoints).toBe(57);
  });

  it("sets an 80 percent same-species lure after selling a selected creature", () => {
    const client = readyClientWithTeam("premium-sell-lure", [25, 1]);
    const pikachu = client.getSnapshot().team[0];

    client.dispatch({
      type: "BUY_PREMIUM_SHOP_ITEM",
      offerId: "premium:sell:lure",
      targetEntityId: pikachu.instanceId,
    });

    const after = client.getSnapshot();
    expect(after.encounterBoost).toMatchObject({
      preferredSpeciesId: 25,
      preferredSpeciesChance: 0.8,
    });
    expect(after.team.map((creature) => creature.instanceId)).not.toContain(pikachu.instanceId);
  });

  it("fuses two matching creatures into their next evolution", () => {
    const client = readyClientWithTeam("premium-fuse-evolve", [25, 25]);
    const [left, right] = client.getSnapshot().team;

    client.dispatch({
      type: "BUY_PREMIUM_SHOP_ITEM",
      offerId: "premium:fusion:evolve",
      targetEntityIds: [left.instanceId, right.instanceId],
    });

    const after = client.getSnapshot();
    expect(after.team).toHaveLength(1);
    expect(after.team[0].speciesId).toBe(26);
    expect(after.metaCurrency?.trainerPoints).toBe(52);
  });

  it("fuses two matching creatures into a 120 percent average-stat creature", () => {
    const client = readyClientWithTeam("premium-fuse-stat", [25, 25]);
    const [left, right] = client.getSnapshot().team;
    const expectedHp = Math.round(((left.stats.hp + right.stats.hp) / 2) * 1.2);

    client.dispatch({
      type: "BUY_PREMIUM_SHOP_ITEM",
      offerId: "premium:fusion:stat",
      targetEntityIds: [left.instanceId, right.instanceId],
    });

    const after = client.getSnapshot();
    expect(after.team).toHaveLength(1);
    expect(after.team[0].speciesId).toBe(25);
    expect(after.team[0].stats.hp).toBeGreaterThanOrEqual(expectedHp);
    expect(after.metaCurrency?.trainerPoints).toBe(53);
  });

  it("fuses two matching creatures and unlocks a hidden move-dex skill", () => {
    const client = readyClientWithTeam("premium-fuse-move", [25, 25]);
    const before = client.getSnapshot();
    const beforeUnlocked = new Set(before.unlockedMoveIds ?? []);
    const [left, right] = before.team;

    client.dispatch({
      type: "BUY_PREMIUM_SHOP_ITEM",
      offerId: "premium:fusion:move-dex",
      targetEntityIds: [left.instanceId, right.instanceId],
    });

    const after = client.getSnapshot();
    const moveId = after.events.at(-1)?.data?.move;

    expect(after.team).toHaveLength(1);
    expect(typeof moveId).toBe("string");
    expect(beforeUnlocked.has(String(moveId))).toBe(false);
    expect(after.unlockedMoveIds).toContain(String(moveId));
    expect(after.metaCurrency?.trainerPoints).toBe(52);
  });
});

function readyClientWithTeam(seed: string, speciesIds: readonly number[]): HeadlessGameClient {
  const client = new HeadlessGameClient({ seed });
  client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
  client.setMetaCurrency({ trainerPoints: 60, claimedAchievements: [] });

  const snapshot = client.saveSnapshot();
  const rng = new SeededRng(`${seed}:team`);
  snapshot.state.phase = "ready";
  snapshot.state.team = speciesIds.map((speciesId, index) =>
    createTestCreature(speciesId, index, rng, client),
  );
  client.loadSnapshot(snapshot);
  return client;
}

function createTestCreature(
  speciesId: number,
  index: number,
  rng: SeededRng,
  client: HeadlessGameClient,
): Creature {
  return createCreature({
    rng,
    wave: 6 + index,
    balance: client.getBalance(),
    speciesId,
    level: 12 + index,
    role: "trainer",
  });
}

function countBalls(balls: Record<string, number>): number {
  return Object.values(balls).reduce((sum, count) => sum + count, 0);
}
