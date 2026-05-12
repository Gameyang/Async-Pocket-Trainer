import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../headlessClient";
import { createTrainerSnapshot } from "../sync/trainerSnapshot";
import { validateFrameContract } from "./frame";

describe("game frame contract", () => {
  it("exposes renderer-facing entities, actions, and visual cues without requiring DOM", () => {
    const client = new HeadlessGameClient({ seed: "frame-contract" });
    let frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.actions.map((action) => action.id)).toEqual(["start:1", "start:4", "start:7"]);

    client.dispatch(frame.actions[0].action);
    frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.scene.playerSlots).toHaveLength(1);
    expect(frame.entities[0]).toMatchObject({
      kind: "creature",
      owner: "player",
      slot: 0,
      layout: {
        lane: "player",
        slot: 0,
        role: "active",
      },
      assetKey: "monster:1",
      assetPath: "resources/pokemon/0001.webp",
    });

    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    frame = client.getFrame();
    const replay = frame.battleReplay.events;

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.battleReplay.sequenceIndex).toBe(replay.at(-1)?.sequence);
    expect(replay[0]).toMatchObject({ sequence: 1, turn: 0, type: "battle.start" });
    expect(replay.at(-1)?.type).toBe("battle.end");
    expect(
      replay.some((event) => event.type === "damage.apply" || event.type === "move.miss"),
    ).toBe(true);
    expect(frame.visualCues.length).toBeGreaterThan(0);
    expect(frame.visualCues.every((cue) => Number.isInteger(cue.sequence))).toBe(true);
    expect(frame.visualCues.every((cue) => cue.effectKey.length > 0)).toBe(true);
    expect(frame.visualCues.every((cue) => cue.soundKey.length > 0)).toBe(true);
    expect(frame.scene.bgmKey).toBe("bgm.battleCapture");
  });

  it("exposes phase-specific scene metadata for starters, capture, and team decisions", () => {
    const client = new HeadlessGameClient({ seed: "capture-1" });
    let frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.phase).toBe("starterChoice");
    expect(frame.scene.starterOptions.map((option) => option.speciesId)).toEqual([1, 4, 7]);
    expect(frame.scene.bgmKey).toBe("bgm.starterReady");

    client.dispatch(frame.actions[0].action);
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.phase).toBe("captureDecision");
    expect(frame.scene.capture).toMatchObject({
      result: "choosing",
      shakes: 0,
    });

    client.dispatch({ type: "ATTEMPT_CAPTURE", ball: "greatBall" });
    frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.phase).toBe("teamDecision");
    expect(frame.scene.bgmKey).toBe("bgm.teamDecision");
    expect(frame.scene.capture).toMatchObject({
      result: "success",
      ball: "greatBall",
      shakes: 3,
    });
    expect(frame.visualCues.map((cue) => cue.type)).toContain("capture.success");
  });

  it("keeps failed capture feedback visible after advancing to the next ready wave", () => {
    const client = firstFailedCaptureClient();
    const frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.phase).toBe("ready");
    expect(frame.scene.capture).toMatchObject({
      result: "failure",
      ball: "pokeBall",
    });
    expect(frame.scene.opponentSlots).toHaveLength(1);
    expect(frame.visualCues.map((cue) => cue.type)).toContain("capture.fail");
  });

  it("marks sheet trainer encounters with deterministic portrait metadata", () => {
    const opponent = new HeadlessGameClient({
      seed: "frame-sheet-opponent",
      trainerName: "Sheet Rival",
    });
    opponent.dispatch({ type: "START_RUN", starterSpeciesId: 4 });
    const opponentSnapshot = createTrainerSnapshot(opponent.getSnapshot(), {
      playerId: "sheet-rival",
      createdAt: "2026-05-12T00:00:00.000Z",
      runSummary: opponent.getRunSummary(),
      wave: 5,
    });
    const client = new HeadlessGameClient({
      seed: "frame-sheet-challenger",
      trainerSnapshots: [opponentSnapshot],
    });

    client.autoPlay({ maxWaves: 4, strategy: "greedy" });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    const frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.scene.trainer).toMatchObject({
      source: "sheet",
      label: "Sheet Trainer",
      trainerName: "Sheet Rival Snapshot (592)",
      portraitPath: "resources/trainers/sheet-rival.webp",
    });
  });
});

function firstFailedCaptureClient(): HeadlessGameClient {
  for (let index = 0; index < 50; index += 1) {
    const client = new HeadlessGameClient({ seed: `capture-fail-${index}` });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    if (client.getSnapshot().phase !== "captureDecision") {
      continue;
    }

    client.dispatch({ type: "ATTEMPT_CAPTURE", ball: "pokeBall" });

    if (client.getSnapshot().phase === "ready") {
      return client;
    }
  }

  throw new Error("Could not find deterministic failed capture seed.");
}
