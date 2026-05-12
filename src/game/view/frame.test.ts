import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../headlessClient";
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
  });
});
