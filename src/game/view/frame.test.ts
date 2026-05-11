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
      assetKey: "pokemon:1",
      assetPath: "resources/pokemon/0001.webp",
    });

    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    frame = client.getFrame();

    expect(validateFrameContract(frame)).toEqual([]);
    expect(frame.visualCues.length).toBeGreaterThan(0);
  });
});
