import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../game/headlessClient";
import type { FrameEntity } from "../game/view/frame";
import { selectCommandItems } from "./framePresentation";

describe("frame presentation command selection", () => {
  it("keeps ready actions available while failed capture feedback is visible", () => {
    const client = firstFailedCaptureClient();
    const frame = client.getFrame();
    const playerEntities = frame.scene.playerSlots
      .map((id) => frame.entities.find((entity) => entity.id === id))
      .filter((entity): entity is FrameEntity => Boolean(entity));
    const commandIds = selectCommandItems(frame, playerEntities, undefined).map(
      (item) => item.action.id,
    );

    expect(frame.phase).toBe("ready");
    expect(frame.scene.capture?.result).toBe("failure");
    expect(commandIds).toContain("encounter:next");
  });
});

function firstFailedCaptureClient(): HeadlessGameClient {
  for (let index = 0; index < 50; index += 1) {
    const client = new HeadlessGameClient({ seed: `ui-capture-fail-${index}` });
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
