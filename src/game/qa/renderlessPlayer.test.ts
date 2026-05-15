import { describe, expect, it, vi } from "vitest";

import { createBrowserGameRuntime, createMemoryStorage } from "../../browser/gameRuntime";
import { CODE_SYNC_SETTINGS } from "../../browser/syncSettings";
import { resolveBattleFieldForWave } from "../battleField";
import { SeededRng } from "../rng";
import type { FrameAction, FrameEntity, GameFrame } from "../view/frame";
import { resolveFrameActionPayload } from "./frameController";
import { playRenderlessGame } from "./renderlessPlayer";

const disabledSyncSettings = {
  ...CODE_SYNC_SETTINGS,
  enabled: false,
};

describe("renderless player", () => {
  it("drives the shared runtime through frame actions instead of client autoplay", async () => {
    const runtime = createBrowserGameRuntime({
      storage: createMemoryStorage(),
      seed: "renderless-runtime",
      trainerName: "Renderless QA",
      playerId: "renderless-player",
      syncSettings: disabledSyncSettings,
      now: () => "2026-05-15T00:00:00.000Z",
      random: () => 0,
      prefetchNextCheckpoint: false,
    });
    const autoStep = vi.spyOn(runtime.client, "autoStep");

    await playRenderlessGame(runtime, {
      maxWaves: 1,
      strategy: "greedy",
      rng: new SeededRng("renderless-controller"),
    });

    expect(autoStep).not.toHaveBeenCalled();
  });

  it("adds target ids for target-required shop actions", () => {
    const action: FrameAction = {
      id: "shop:stat-boost:attack:1",
      label: "Attack +3",
      role: "secondary",
      enabled: true,
      cost: 8,
      requiresTarget: true,
      action: { type: "BUY_STAT_BOOST", stat: "attack", tier: 1 },
    };
    const payload = resolveFrameActionPayload(
      readyFrame([entity("weak", 0, 90), entity("carry", 1, 180)]),
      action,
    );

    expect(payload).toEqual({
      type: "BUY_STAT_BOOST",
      stat: "attack",
      tier: 1,
      targetEntityId: "carry",
    });
  });
});

function readyFrame(entities: FrameEntity[]): GameFrame {
  const battleField = resolveBattleFieldForWave(3);

  return {
    protocolVersion: 1,
    frameId: 1,
    stateKey: "ready",
    phase: "ready",
    hud: {
      title: "Async Pocket Trainer",
      trainerName: "QA",
      wave: 3,
      money: 20,
      balls: {
        pokeBall: 3,
        greatBall: 0,
        ultraBall: 0,
        hyperBall: 0,
        masterBall: 0,
      },
      teamPower: 270,
      teamHpRatio: 1,
      trainerPoints: 0,
      battleField,
    },
    scene: {
      title: "Wave 3",
      subtitle: "Ready",
      playerSlots: entities.map((creature) => creature.id),
      opponentSlots: [],
      starterOptions: [],
      battleField,
      bgmKey: "bgm.starterReady",
    },
    entities,
    actions: [],
    timeline: [],
    battleReplay: {
      sequenceIndex: 0,
      events: [],
    },
    visualCues: [],
  };
}

function entity(id: string, slot: number, power: number): FrameEntity {
  return {
    id,
    kind: "creature",
    owner: "player",
    slot,
    layout: {
      lane: "player",
      slot,
      role: slot === 0 ? "active" : "bench",
    },
    assetKey: "monster:1",
    assetPath: "resources/pokemon/0001.webp",
    name: id,
    speciesId: 1,
    level: 1,
    typeLabels: ["Normal"],
    types: ["normal"],
    hp: {
      current: 100,
      max: 100,
      ratio: 1,
    },
    stats: {
      hp: 100,
      attack: 50,
      defense: 50,
      special: 50,
      speed: 50,
    },
    moves: [],
    moveDex: [],
    scores: {
      power,
      rarity: 1,
    },
    flags: [],
  };
}
