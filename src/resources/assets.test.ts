import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import pokemonRuntimeData from "../game/data/pokemonBattleRuntimeData.json" with { type: "json" };

const trainerPortraits = [
  "trainers/field-scout.webp",
  "trainers/checkpoint-captain.webp",
  "trainers/sheet-rival.webp",
];

const sfx = [
  "audio/sfx/battle-hit.wav",
  "audio/sfx/battle-critical-hit.wav",
  "audio/sfx/battle-miss.wav",
  "audio/sfx/creature-faint.wav",
  "audio/sfx/phase-change.wav",
  "audio/sfx/capture-success.wav",
  "audio/sfx/capture-fail.wav",
];

const bgm = [
  "audio/bgm/starter-ready.wav",
  "audio/bgm/battle-capture.wav",
  "audio/bgm/team-decision.wav",
  "audio/bgm/game-over.wav",
];

describe("local generated assets", () => {
  it("keeps deterministic trainer portrait bundle paths present", () => {
    for (const asset of trainerPortraits) {
      const bytes = readAsset(asset);

      expect(bytes.byteLength).toBeGreaterThan(128);
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  it("keeps BGM and SFX files as browser-playable PCM WAV assets", () => {
    for (const asset of [...sfx, ...bgm]) {
      const bytes = readAsset(asset);

      expect(bytes.byteLength).toBeGreaterThan(1024);
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
    }
  });

  it("keeps every runtime Pokemon sprite present as WebP", () => {
    for (const species of pokemonRuntimeData.pokemon) {
      const bytes = readAsset(`pokemon/${species.dexNumber.toString().padStart(4, "0")}.webp`);

      expect(bytes.byteLength).toBeGreaterThan(1024);
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
    }
  });
});

function readAsset(path: string): Buffer {
  return readFileSync(new URL(`./${path}`, import.meta.url));
}
