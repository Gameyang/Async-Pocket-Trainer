import { describe, expect, it, vi } from "vitest";

import { HeadlessGameClient } from "../game/headlessClient";
import { createCanvasFrameRenderer } from "./canvasRenderer";

describe("canvas frame renderer", () => {
  it("draws a game frame without throwing and emits canvas operations", () => {
    const operations: string[] = [];
    const canvas = createFakeCanvas(operations);
    const imageCtor = vi.fn(function FakeImage(this: FakeImageLike) {
      this.complete = false;
      this.naturalWidth = 0;
      this.src = "";
    });
    vi.stubGlobal("Image", imageCtor);

    const client = new HeadlessGameClient({ seed: "canvas-smoke" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const renderer = createCanvasFrameRenderer(canvas, {
      resolveAssetPath: (assetPath) => assetPath,
    });

    expect(() => renderer.render(client.getFrame())).not.toThrow();
    expect(operations).toContain("clearRect");
    expect(operations).toContain("fillRect");
    expect(operations).toContain("fillText");
    expect(operations).toContain("ellipse");
    expect(imageCtor).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("draws battle cue overlays from visual cues", () => {
    const operations: string[] = [];
    const canvas = createFakeCanvas(operations);
    const imageCtor = vi.fn(function FakeImage(this: FakeImageLike) {
      this.complete = false;
      this.naturalWidth = 0;
      this.src = "";
    });
    vi.stubGlobal("Image", imageCtor);

    const client = new HeadlessGameClient({ seed: "vis-2" });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 7 });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    const renderer = createCanvasFrameRenderer(canvas, {
      resolveAssetPath: (assetPath) => assetPath,
    });

    expect(() => renderer.render(client.getFrame())).not.toThrow();
    expect(client.getFrame().visualCues.map((cue) => cue.effectKey)).toContain(
      "battle.superEffective",
    );
    expect(operations.filter((operation) => operation === "fillText").length).toBeGreaterThan(4);
    expect(operations).toContain("strokeRect");

    vi.unstubAllGlobals();
  });
});

interface FakeImageLike {
  complete: boolean;
  naturalWidth: number;
  src: string;
}

function createFakeCanvas(operations: string[]): HTMLCanvasElement {
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    clearRect: () => operations.push("clearRect"),
    fillRect: () => operations.push("fillRect"),
    strokeRect: () => operations.push("strokeRect"),
    fillText: () => operations.push("fillText"),
    drawImage: () => operations.push("drawImage"),
    beginPath: () => operations.push("beginPath"),
    ellipse: () => operations.push("ellipse"),
    fill: () => operations.push("fill"),
    stroke: () => operations.push("stroke"),
    save: () => operations.push("save"),
    restore: () => operations.push("restore"),
    createLinearGradient: () => ({
      addColorStop: () => operations.push("addColorStop"),
    }),
  };

  return {
    width: 0,
    height: 0,
    getContext: (contextType: string) => (contextType === "2d" ? context : null),
  } as unknown as HTMLCanvasElement;
}
