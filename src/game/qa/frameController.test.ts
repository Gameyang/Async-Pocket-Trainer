import { describe, expect, it } from "vitest";

import { SeededRng } from "../rng";
import type { FrameAction, FrameEntity, GameFrame } from "../view/frame";
import { chooseFrameAction } from "./frameController";

describe("frame action controller", () => {
  it("uses strategy-specific team replacement thresholds", () => {
    const frame = teamDecisionFrame(105);

    expect(chooseFrameAction(frame, "greedy", new SeededRng("controller"))?.id).toBe(
      "team:replace:0",
    );
    expect(chooseFrameAction(frame, "conserveBalls", new SeededRng("controller"))?.id).toBe(
      "team:release",
    );
  });

  it("allows conservative replacement when the captured creature is clearly stronger", () => {
    expect(
      chooseFrameAction(teamDecisionFrame(120), "conserveBalls", new SeededRng("controller"))?.id,
    ).toBe("team:replace:0");
  });
});

function teamDecisionFrame(capturedPower: number): GameFrame {
  return {
    protocolVersion: 1,
    frameId: 1,
    stateKey: "team-decision",
    phase: "teamDecision",
    hud: {
      title: "비동기 포켓 트레이너",
      trainerName: "QA",
      wave: 4,
      money: 0,
      balls: {
        pokeBall: 0,
        greatBall: 0,
        ultraBall: 0,
        hyperBall: 0,
        masterBall: 0,
      },
      teamPower: 300,
      teamHpRatio: 1,
    },
    scene: {
      title: "4웨이브",
      subtitle: "포획한 몬스터를 비교하세요",
      playerSlots: ["weak", "strong"],
      opponentSlots: [],
      pendingCaptureId: "capture",
      starterOptions: [],
      bgmKey: "bgm.teamDecision",
    },
    entities: [
      entity("weak", "player", 0, 100),
      entity("strong", "player", 1, 200),
      entity("capture", "pendingCapture", 0, capturedPower),
    ],
    actions: [
      replaceAction(0),
      replaceAction(1),
      {
        id: "team:release",
        label: "놓아주기",
        role: "danger",
        enabled: true,
        action: { type: "DISCARD_CAPTURE" },
      },
    ],
    timeline: [],
    battleReplay: {
      sequenceIndex: 0,
      events: [],
    },
    visualCues: [],
  };
}

function replaceAction(index: number): FrameAction {
  return {
    id: `team:replace:${index}`,
    label: `${index + 1}번 슬롯과 교체`,
    role: "primary",
    enabled: true,
    action: { type: "ACCEPT_CAPTURE", replaceIndex: index },
  };
}

function entity(id: string, owner: FrameEntity["owner"], slot: number, power: number): FrameEntity {
  return {
    id,
    kind: "creature",
    owner,
    slot,
    layout: {
      lane: owner === "pendingCapture" ? "center" : owner,
      slot,
      role: owner === "pendingCapture" ? "pendingCapture" : slot === 0 ? "active" : "bench",
    },
    assetKey: "monster:1",
    assetPath: "resources/pokemon/0001.webp",
    name: id,
    speciesId: 1,
    typeLabels: ["노말"],
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
    moves: [
      {
        id: "tackle",
        name: "몸통박치기",
        type: "노말",
        power: 40,
        accuracy: 1,
      },
    ],
    scores: {
      power,
      rarity: 1,
    },
    flags: [],
  };
}
