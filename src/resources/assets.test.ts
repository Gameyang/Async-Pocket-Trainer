import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import pokemonRuntimeData from "../game/data/pokemonBattleRuntimeData.json" with { type: "json" };

const battleTypes = [
  "normal",
  "fire",
  "water",
  "grass",
  "electric",
  "poison",
  "ground",
  "flying",
  "bug",
  "fighting",
  "psychic",
  "rock",
  "ghost",
  "ice",
  "dragon",
  "dark",
  "steel",
  "fairy",
];

const trainerPortraits = [
  "trainers/field-scout.webp",
  "trainers/checkpoint-captain.webp",
  "trainers/sheet-rival.webp",
];

const sfx = [
  "audio/sfx/battle-hit.m4a",
  "audio/sfx/battle-critical-hit.m4a",
  "audio/sfx/battle-miss.m4a",
  "audio/sfx/creature-faint.m4a",
  "audio/sfx/phase-change.m4a",
  "audio/sfx/capture-success.m4a",
  "audio/sfx/capture-fail.m4a",
  ...battleTypes.flatMap((type) => [
    `audio/sfx/battle-type-${type}.m4a`,
    `audio/sfx/battle-type-${type}-critical.m4a`,
    `audio/sfx/battle-support-type-${type}.m4a`,
  ]),
];

const bgm = [
  "audio/bgm/starter-ready.m4a",
  "audio/bgm/battle-capture.m4a",
  "audio/bgm/team-decision.m4a",
  "audio/bgm/game-over.m4a",
];

describe("local generated assets", () => {
  it("keeps deterministic trainer portrait bundle paths present", () => {
    for (const asset of trainerPortraits) {
      const bytes = readAsset(asset);

      expect(bytes.byteLength).toBeGreaterThan(128);
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  it("keeps BGM and SFX files as browser-playable compressed M4A assets", () => {
    for (const asset of [...sfx, ...bgm]) {
      const bytes = readAsset(asset);

      expect(bytes.byteLength).toBeGreaterThan(512);
      expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");
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
