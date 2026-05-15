import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("renderer contract boundaries", () => {
  it("keeps HTML renderer events on FrameAction.action dispatch", () => {
    const source = readSource("htmlRenderer.ts");

    expect(source).not.toMatch(/getSnapshot|autoStep|autoPlay/);
    expect(source).toContain("client.dispatch(action.action)");
  });

  it("keeps renderers consuming GameFrame instead of raw GameState", () => {
    const html = readSource("htmlRenderer.ts");
    const canvas = readSource("canvasRenderer.ts");

    expect(html).not.toMatch(/GameState|HeadlessGameClient/);
    expect(canvas).not.toMatch(/GameState|HeadlessGameClient/);
    expect(canvas).toContain("GameFrame");
    expect(canvas).toContain("entity.assetPath");
  });

  it("keeps browser-visible renderer hooks stable", () => {
    const source = readSource("htmlRenderer.ts");

    expect(source).toContain("data-screen");
    expect(source).toContain("data-action-id");
    expect(source).toContain("data-capture-result");
    expect(source).toContain("data-battle-effect");
    expect(source).toContain("fx-overlay");
    expect(source).toContain("effectEngine.spawn");
    expect(source).toContain("resolveAssetPath(entity.assetPath)");
    expect(source).toContain("resolveAssetPath(option.assetPath)");
    expect(source).toContain("resolveTrainerAssetPath(trainer.portraitPath)");
  });

  it("keeps battle feedback using visible damage glyphs and move VFX hooks", () => {
    const source = readSource("htmlRenderer.ts");

    expect(source).toContain("damage-atlas");
    expect(source).toContain("damage-glyph");
    expect(source).toContain("move-vfx");
    expect(source).toContain("data-move-shape");
    expect(source).toContain("data-move-type");
    expect(source).toContain("data-motion-clip");
    expect(source).toContain("resolveBattleMotionTemplate");
    expect(source).toContain("data-camera-shake");
    expect(source).toContain("data-camera-shake-intensity");
    expect(source).toContain("shouldShakeBattleCamera");
    expect(source).toContain("resolveEffectShape");
  });

  it("keeps battle status badges attached to HP bars", () => {
    const source = readSource("htmlRenderer.ts");
    const css = readRootSource("style.css");

    expect(source).toContain("currentStatuses.set");
    expect(source).toContain('event.type === "status.apply"');
    expect(source).toContain("renderBattleStatusBadge");
    expect(source).toContain("data-battle-status-badge");
    expect(css).toContain(".battle-card .hp-line");
    expect(css).toContain(".battle-status-badge");
  });

  it("keeps battle effects able to layer Lottie templates over DOM shapes", () => {
    const engine = readEffectsSource("engine.ts");
    const lottie = readEffectsSource("lottieDirector.ts");

    expect(engine).toContain("applyLottieMotionTemplate");
    expect(lottie).toContain("lottie-web");
    expect(lottie).toContain("fx-lottie-layer");
  });

  it("does not advertise an installable PWA shell on static GitHub Pages", () => {
    const index = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

    expect(index).not.toContain('rel="manifest"');
  });
});

function readSource(fileName: string): string {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

function readRootSource(fileName: string): string {
  return readFileSync(new URL(`../${fileName}`, import.meta.url), "utf8");
}

function readEffectsSource(fileName: string): string {
  return readFileSync(new URL(`./effects/${fileName}`, import.meta.url), "utf8");
}
