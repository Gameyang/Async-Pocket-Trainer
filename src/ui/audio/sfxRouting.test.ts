import { describe, expect, it } from "vitest";

import { resolveLocalSfxStem } from "./sfxRouting";

describe("SFX routing", () => {
  it("routes gameplay sound keys to local generated SFX assets first", () => {
    expect(resolveLocalSfxStem("sfx.battle.hit")).toBe("battle-hit");
    expect(resolveLocalSfxStem("sfx.battle.critical.hit")).toBe("battle-critical-hit");
    expect(resolveLocalSfxStem("sfx.battle.miss")).toBe("battle-miss");
    expect(resolveLocalSfxStem("sfx.creature.faint")).toBe("creature-faint");
    expect(resolveLocalSfxStem("sfx.capture.success")).toBe("capture-success");
    expect(resolveLocalSfxStem("sfx.capture.fail")).toBe("capture-fail");
    expect(resolveLocalSfxStem("sfx.phase.change")).toBe("phase-change");
  });

  it("routes typed battle and support sound keys to element SFX assets", () => {
    expect(resolveLocalSfxStem("sfx.battle.type.fire")).toBe("battle-type-fire");
    expect(resolveLocalSfxStem("sfx.battle.type.water.critical")).toBe(
      "battle-type-water-critical",
    );
    expect(resolveLocalSfxStem("sfx.battle.support.type.electric")).toBe(
      "battle-support-type-electric",
    );
  });

  it("leaves Pokemon cry keys for the cry resolver", () => {
    expect(resolveLocalSfxStem("sfx.cry.pikachu")).toBeUndefined();
  });
});
