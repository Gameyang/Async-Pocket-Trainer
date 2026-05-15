import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../headlessClient";
import { createTeamRecordSummary, createTrainerTeamId } from "../sync/teamBattleRecord";
import { createTrainerSnapshot } from "../sync/trainerSnapshot";
import { validateFrameContract } from "./frame";

describe("game frame contract", () => {
  it("exposes renderer-facing entities, actions, and visual cues without requiring DOM", () => {
    const client = new HeadlessGameClient({ seed: "frame-contract" });
    let frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.scene.bgmTrackKey).toMatch(/^bgm\.showdown\.[a-z0-9-]+$/);
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
    expect(frame.scene.trainer).toBeUndefined();
    expect(replay.slice(0, 4).map((event) => event.type)).toEqual([
      "trainer.intro",
      "trainer.throw",
      "creature.summon",
      "battle.start",
    ]);
    expect(replay[3]).toMatchObject({ sequence: 4, sourceSequence: 1, type: "battle.start" });
    expect(replay[1].playerLine).toMatch(/이상해씨/);
    expect(replay[2].playerLine).toMatch(/이상해씨/);
    expect(replay.at(-1)?.type).toBe("battle.end");
    expect(
      replay.some((event) => event.type === "damage.apply" || event.type === "move.miss"),
    ).toBe(true);
    expect(frame.visualCues.length).toBeGreaterThan(0);
    expect(frame.visualCues.every((cue) => Number.isInteger(cue.sequence))).toBe(true);
    expect(frame.visualCues.every((cue) => cue.effectKey.length > 0)).toBe(true);
    expect(frame.visualCues.every((cue) => cue.soundKey.length > 0)).toBe(true);
    expect(frame.visualCues.find((cue) => cue.type === "phase.change")?.cryKey).toMatch(
      /^sfx\.cry\.[a-z0-9-]+$/,
    );
    expect(frame.visualCues.find((cue) => cue.type === "phase.change")?.soundKeys).toContainEqual(
      expect.stringMatching(/^sfx\.cry\.pool\.[a-z0-9-]+$/),
    );
    expect(frame.scene.bgmKey).toBe("bgm.battleCapture");
  });

  it("exposes phase-specific scene metadata for starters, capture, and team decisions", () => {
    const client = new HeadlessGameClient({ seed: "capture-1" });
    let frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.phase).toBe("starterChoice");
    expect(frame.scene.starterOptions.map((option) => option.speciesId)).toEqual([1, 4, 7]);
    expect(frame.scene.starterOptions.map((option) => option.level)).toEqual([5, 5, 5]);
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
    expect(frame.visualCues.find((cue) => cue.type === "capture.success")?.cryKey).toMatch(
      /^sfx\.cry\.[a-z0-9-]+$/,
    );
    expect(
      frame.visualCues.find((cue) => cue.type === "capture.success")?.soundKeys,
    ).toContainEqual(expect.stringMatching(/^sfx\.cry\.pool\.[a-z0-9-]+$/));
  });

  it("exposes the run battle field order as a world-map node graph", () => {
    const client = new HeadlessGameClient({ seed: "field-map" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const order = client.getSnapshot().battleFieldOrder ?? [];
    let frame = client.getFrame();

    expect(frame.scene.worldMap?.mode).toBe("start");
    expect(frame.scene.worldMap?.activeIndex).toBe(0);
    expect(frame.scene.worldMap?.nodes.map((node) => node.id)).toEqual([
      order[17],
      order[0],
      order[1],
    ]);
    expect(frame.scene.worldMap?.nodes).toHaveLength(3);
    expect(frame.scene.worldMap?.nodes[0]).toMatchObject({
      id: order[17],
      status: "previous",
    });
    expect(frame.scene.worldMap?.nodes[1]).toMatchObject({
      id: order[0],
      status: "active",
      waveStart: 1,
      waveEnd: 5,
    });
    expect(frame.scene.worldMap?.nodes[2]).toMatchObject({
      id: order[1],
      status: "next",
      waveStart: 6,
      waveEnd: 10,
    });

    const saved = client.saveSnapshot();
    saved.state.phase = "ready";
    saved.state.currentWave = 6;
    client.loadSnapshot(saved);
    frame = client.getFrame();

    expect(frame.scene.worldMap?.mode).toBe("transition");
    expect(frame.scene.worldMap?.activeIndex).toBe(1);
    expect(frame.scene.worldMap?.nodes[1]).toMatchObject({
      id: order[1],
      status: "active",
      timeOfDay: "night",
    });
  });

  it("rotates every downloaded Showdown BGM track through scene metadata", () => {
    const expectedTrackKeys = new Set([
      "bgm.showdown.bw-rival",
      "bgm.showdown.bw-subway-trainer",
      "bgm.showdown.bw-trainer",
      "bgm.showdown.bw2-homika-dogars",
      "bgm.showdown.bw2-kanto-gym-leader",
      "bgm.showdown.bw2-rival",
      "bgm.showdown.colosseum-miror-b",
      "bgm.showdown.dpp-rival",
      "bgm.showdown.dpp-trainer",
      "bgm.showdown.hgss-johto-trainer",
      "bgm.showdown.hgss-kanto-trainer",
      "bgm.showdown.oras-rival",
      "bgm.showdown.oras-trainer",
      "bgm.showdown.sm-rival",
      "bgm.showdown.sm-trainer",
      "bgm.showdown.spl-elite4",
      "bgm.showdown.xd-miror-b",
      "bgm.showdown.xy-rival",
      "bgm.showdown.xy-trainer",
    ]);
    const observedTrackKeys = new Set<string>();
    const phases = ["ready", "captureDecision", "teamDecision", "gameOver"] as const;

    for (const phase of phases) {
      for (
        let wave = 1;
        wave <= 120 && observedTrackKeys.size < expectedTrackKeys.size;
        wave += 1
      ) {
        const client = new HeadlessGameClient({ seed: `bgm-rotation-${phase}-${wave}` });
        client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
        const snapshot = client.saveSnapshot();
        snapshot.state.phase = phase;
        snapshot.state.currentWave = wave;
        client.loadSnapshot(snapshot);
        observedTrackKeys.add(client.getFrame().scene.bgmTrackKey);
      }
    }

    expect(observedTrackKeys).toEqual(expectedTrackKeys);
  });

  it("localizes move detail effects for renderer-facing summaries", () => {
    const client = new HeadlessGameClient({ seed: "move-detail-ko" });

    client.dispatch({ type: "START_RUN", starterSpeciesId: 25 });
    const frame = client.getFrame();
    const thunderShock = frame.entities[0]?.moves.find((move) => move.id === "thunder-shock");

    expect(thunderShock).toMatchObject({
      category: "special",
      accuracyLabel: "100%",
      effect: "10% 확률로 상대를 마비 상태로 만듭니다.",
    });
    expect(thunderShock?.effect).not.toMatch(/Has a|target|Inflicts/i);
  });

  it("classifies replay cues with readable names and effect tiers", () => {
    const superEffective = findBattleFrameWithCue("battle.superEffective", 7);
    const resisted = findBattleFrameWithCue("battle.resisted", 1);
    const critical = findBattleFrameWithCue("battle.criticalHit", 4);
    const missed = findBattleFrameWithCue("battle.miss", 1);
    const support = findBattleFrameWithCue("battle.support", 1);
    const superEffectiveEvent = superEffective.battleReplay.events.find(
      (event) => event.type === "damage.apply" && (event.effectiveness ?? 1) > 1,
    );
    const typedHitCue = superEffective.visualCues.find(
      (cue) =>
        cue.type === "battle.hit" &&
        cue.sequence === (superEffectiveEvent?.sourceSequence ?? superEffectiveEvent?.sequence),
    );
    const criticalCue = critical.visualCues.find((cue) => cue.effectKey === "battle.criticalHit");
    const supportCue = support.visualCues.find((cue) => cue.type === "battle.support");
    const supportEvent = support.battleReplay.events.find(
      (event) => (event.sourceSequence ?? event.sequence) === supportCue?.sequence,
    );
    const missCue = missed.visualCues.find((cue) => cue.type === "battle.miss");
    const missEvent = missed.battleReplay.events.find(
      (event) => (event.sourceSequence ?? event.sequence) === missCue?.sequence,
    );

    expect(superEffective.visualCues).toContainEqual(
      expect.objectContaining({
        type: "battle.hit",
        effectKey: "battle.superEffective",
        label: expect.not.stringMatching(/\d+-\d+-[0-9a-f]+/),
      }),
    );
    expect(resisted.visualCues).toContainEqual(
      expect.objectContaining({
        type: "battle.hit",
        effectKey: "battle.resisted",
      }),
    );
    expect(missed.visualCues).toContainEqual(
      expect.objectContaining({
        type: "battle.miss",
        effectKey: "battle.miss",
      }),
    );
    expect(typedHitCue).toMatchObject({
      soundKey: `sfx.battle.type.${superEffectiveEvent?.moveType}`,
      moveType: superEffectiveEvent?.moveType,
      moveCategory: superEffectiveEvent?.moveCategory,
    });
    expect(superEffectiveEvent?.moveCategory).toMatch(/physical|special|status/);
    expect(missCue).toMatchObject({
      moveType: missEvent?.moveType,
      moveCategory: missEvent?.moveCategory,
    });
    expect(missCue?.soundKeys).toContainEqual(
      expect.stringMatching(/^sfx\.cry\.pool\.[a-z0-9-]+$/),
    );
    expect(missEvent?.moveType).toMatch(
      /normal|fire|water|grass|electric|poison|ground|flying|bug|fighting|psychic|rock|ghost|ice|dragon|dark|steel|fairy/,
    );
    expect(criticalCue).toMatchObject({
      soundKey: expect.stringMatching(/^sfx\.battle\.type\.[a-z-]+\.critical$/),
      critical: true,
    });
    expect(typedHitCue?.soundKeys).toContainEqual(
      expect.stringMatching(/^sfx\.cry\.pool\.[a-z0-9-]+$/),
    );
    expect(supportCue).toMatchObject({
      soundKey: `sfx.battle.support.type.${supportEvent?.moveType}`,
      moveType: supportEvent?.moveType,
    });
    expect(supportCue?.soundKeys).toContainEqual(
      expect.stringMatching(/^sfx\.cry\.pool\.[a-z0-9-]+$/),
    );
    expect(superEffectiveEvent?.label).not.toMatch(/\d+-\d+-[0-9a-f]+/);
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
    expect(frame.visualCues.find((cue) => cue.type === "capture.fail")?.soundKeys).toContainEqual(
      expect.stringMatching(/^sfx\.cry\.pool\.[a-z0-9-]+$/),
    );
  });

  it("marks sheet trainer encounters with deterministic portrait metadata", () => {
    const opponent = new HeadlessGameClient({
      seed: "frame-sheet-opponent",
      trainerName: "Sheet Rival",
    });
    opponent.dispatch({ type: "START_RUN", starterSpeciesId: 4 });
    opponent.setMetaCurrency({
      trainerPoints: 0,
      claimedAchievements: [],
      ownedTrainerPortraitIds: ["ps-trainer-aaron"],
      selectedTrainerPortraitId: "ps-trainer-aaron",
    });
    const opponentSnapshot = createTrainerSnapshot(opponent.getSnapshot(), {
      playerId: "sheet-rival",
      createdAt: "2026-05-12T00:00:00.000Z",
      runSummary: opponent.getRunSummary(),
      wave: 5,
    });
    opponentSnapshot.teamRecord = createTeamRecordSummary(
      createTrainerTeamId(opponentSnapshot),
      3,
      1,
    );
    const client = new HeadlessGameClient({
      seed: "frame-sheet-challenger",
      trainerSnapshots: [opponentSnapshot],
    });

    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const waveFive = client.saveSnapshot();
    waveFive.state.phase = "ready";
    waveFive.state.currentWave = 5;
    waveFive.state.money = 999;
    client.loadSnapshot(waveFive);
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    const frame = client.getFrame();
    const replayTypes = frame.battleReplay.events.map((event) => event.type);

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.scene.trainer).toMatchObject({
      source: "sheet",
      label: expect.any(String),
      trainerName: expect.stringContaining("Sheet Rival"),
      portraitPath: expect.stringMatching(/^resources\/trainers\/[a-z0-9-]+\.webp$/),
      record: expect.objectContaining({
        wins: 3,
        losses: 1,
      }),
    });
    expect(frame.scene.trainer?.recordChange?.deltaWinRate).toBeDefined();
    expect(replayTypes.slice(0, 4)).toEqual([
      "trainer.intro",
      "trainer.throw",
      "creature.summon",
      "battle.start",
    ]);
    expect(replayTypes.at(-2)).toBe("trainer.outro");
    expect(
      frame.battleReplay.events.find((event) => event.type === "damage.apply")?.sourceSequence,
    ).toBeDefined();
  });
});

function createBattleFrame(seed: string, starterSpeciesId: number) {
  const client = new HeadlessGameClient({ seed });
  client.dispatch({ type: "START_RUN", starterSpeciesId });
  client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
  return client.getFrame();
}

function findBattleFrameWithCue(effectKey: string, starterSpeciesId: number) {
  for (let index = 0; index < 200; index += 1) {
    const frame = createBattleFrame(`vis-${effectKey}-${index}`, starterSpeciesId);

    if (frame.visualCues.some((cue) => cue.effectKey === effectKey)) {
      return frame;
    }
  }

  throw new Error(`Could not find battle frame with cue ${effectKey}.`);
}

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
