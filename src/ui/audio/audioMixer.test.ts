import { describe, expect, it } from "vitest";

import type { FrameVisualCue } from "../../game/view/frame";
import { resolveCueSoundKeys, resolveSfxLayer, resolveSfxVolume } from "./audioMixer";

describe("AudioMixer helpers", () => {
  it("keeps primary, supplemental, and cry sounds in the same cue bundle", () => {
    const cue = {
      soundKey: "sfx.capture.success",
      soundKeys: ["sfx.cry.pool.abc123"],
      cryKey: "sfx.cry.pikachu",
    } as unknown as FrameVisualCue;

    expect(resolveCueSoundKeys(cue)).toEqual([
      "sfx.capture.success",
      "sfx.cry.pool.abc123",
      "sfx.cry.pikachu",
    ]);
  });

  it("routes simultaneous SFX into independent mixer layers", () => {
    expect(resolveSfxLayer("sfx.battle.type.fire")).toBe("impact");
    expect(resolveSfxLayer("sfx.creature.faint")).toBe("impact");
    expect(resolveSfxLayer("sfx.cry.pikachu")).toBe("cry");
    expect(resolveSfxLayer("sfx.cry.pool.abc123")).toBe("cry");
    expect(resolveSfxLayer("sfx.capture.success")).toBe("ui");
    expect(resolveSfxLayer("sfx.phase.change")).toBe("ui");
  });

  it("keeps per-sound gains near the SFX bus level instead of double-attenuating them", () => {
    expect(resolveSfxVolume("sfx.battle.type.fire")).toBe(1);
    expect(resolveSfxVolume("sfx.capture.success")).toBe(1);
    expect(resolveSfxVolume("sfx.cry.pikachu")).toBeGreaterThanOrEqual(0.9);
    expect(resolveSfxVolume("sfx.phase.change")).toBeGreaterThanOrEqual(0.75);
  });
});
