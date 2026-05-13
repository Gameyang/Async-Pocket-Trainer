import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../game/headlessClient";
import type { FrameEntity } from "../game/view/frame";
import { selectCommandItems, selectReadyShopActions } from "./framePresentation";

describe("frame presentation command selection", () => {
  it("allows the ready shop grid to expose more than three actions up to the grid cap", () => {
    const client = new HeadlessGameClient({ seed: "ui-shop-grid" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const frame = client.getFrame();
    const playerEntities = resolvePlayerEntities(frame);
    const actionIds = selectReadyShopActions(frame, playerEntities).map((action) => action.id);

    expect(frame.phase).toBe("ready");
    expect(actionIds.length).toBeGreaterThan(3);
    expect(actionIds.length).toBeLessThanOrEqual(12);
    expect(actionIds).toContain("encounter:next");
    expect(actionIds).toContain("shop:rest");
  });

  it("keeps unaffordable shop options visible as disabled cards", () => {
    const client = new HeadlessGameClient({ seed: "ui-shop-disabled" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const snapshot = client.saveSnapshot();
    snapshot.state.money = 0;
    client.loadSnapshot(snapshot);
    const frame = client.getFrame();
    const playerEntities = resolvePlayerEntities(frame);
    const actions = selectReadyShopActions(frame, playerEntities);

    expect(actions.length).toBeLessThanOrEqual(12);
    expect(actions.some((action) => action.id.startsWith("shop:") && !action.enabled)).toBe(true);
  });

  it("keeps ready actions available while failed capture feedback is visible", () => {
    const client = firstFailedCaptureClient();
    const frame = client.getFrame();
    const playerEntities = resolvePlayerEntities(frame);
    const commandIds = selectCommandItems(frame, playerEntities, undefined).map(
      (item) => item.action.id,
    );

    expect(frame.phase).toBe("ready");
    expect(frame.scene.capture?.result).toBe("failure");
    expect(commandIds).toContain("encounter:next");
  });

  it("exposes every game-over restart option", () => {
    const client = new HeadlessGameClient({ seed: "ui-game-over-restart" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const snapshot = client.saveSnapshot();
    snapshot.state.phase = "gameOver";
    client.loadSnapshot(snapshot);
    const frame = client.getFrame();
    const commandIds = selectCommandItems(frame, resolvePlayerEntities(frame), undefined).map(
      (item) => item.action.id,
    );

    expect(commandIds).toEqual(["restart:team:0", "restart:starter-choice"]);
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

function resolvePlayerEntities(frame: ReturnType<HeadlessGameClient["getFrame"]>): FrameEntity[] {
  return frame.scene.playerSlots
    .map((id) => frame.entities.find((entity) => entity.id === id))
    .filter((entity): entity is FrameEntity => Boolean(entity));
}
