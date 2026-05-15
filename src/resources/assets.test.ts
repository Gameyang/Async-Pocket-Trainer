import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

import pokemonRuntimeData from "../game/data/pokemonBattleRuntimeData.json" with { type: "json" };
import showdownAudioManifest from "./audio/showdownAudioManifest.json" with { type: "json" };
import trainerPortraitManifest from "./trainers/trainerPortraitManifest.json" with { type: "json" };

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
const sceneBgmFolders = ["starter-ready", "battle-capture", "team-decision", "game-over"];

const showdownCryStemOverrides: Record<string, string> = {
  "nidoran-f": "nidoranf",
  "nidoran-m": "nidoranm",
  "mr-mime": "mrmime",
};

describe("local generated assets", () => {
  it("keeps deterministic trainer portrait bundle paths present", () => {
    for (const asset of trainerPortraitManifest.procedural) {
      const bytes = readAsset(asset);

      expect(bytes.byteLength).toBeGreaterThan(128);
      expect(isPng(bytes) || isWebp(bytes)).toBe(true);
    }
  });

  it("keeps Hugging Face trainer portraits as transparent 96px WebP sprites", async () => {
    for (const asset of trainerPortraitManifest.huggingFace) {
      await expectTransparentWebpSprite(asset);
    }
  });

  it("keeps Pokemon Showdown trainer portraits as transparent 96px WebP sprites", async () => {
    expect(trainerPortraitManifest.pokemonShowdown.length).toBeGreaterThan(1000);

    for (const asset of trainerPortraitManifest.pokemonShowdown) {
      await expectTransparentWebpSprite(asset);
    }
  });

  it("keeps generated trainer portrait choices present", () => {
    expect(trainerPortraitManifest.generated.length).toBe(
      2 +
        trainerPortraitManifest.huggingFace.length +
        trainerPortraitManifest.pokemonShowdown.length,
    );

    for (const asset of trainerPortraitManifest.generated) {
      const bytes = readAsset(asset);

      expect(bytes.byteLength).toBeGreaterThan(128);
    }
  });

  it("keeps BGM and SFX files as browser-playable compressed M4A assets", () => {
    for (const asset of [...sfx, ...bgm]) {
      const bytes = readAsset(asset);

      expect(bytes.byteLength).toBeGreaterThan(512);
      expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");
    }
  });

  it("keeps Pokemon Showdown audio pack outputs as browser-playable M4A assets", () => {
    expect(showdownAudioManifest.rootAudio.length).toBeGreaterThanOrEqual(20);
    expect(showdownAudioManifest.cries.length).toBeGreaterThan(1000);

    for (const asset of showdownAudioManifest.rootAudio) {
      const bytes = readCurrentRootAudioAsset(asset.outputPath);

      expect(bytes.byteLength).toBeGreaterThan(512);
      expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");
    }

    for (const asset of showdownAudioManifest.cries) {
      const bytes = readAsset(asset.outputPath);

      expect(bytes.byteLength).toBeGreaterThan(512);
      expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");
    }
  });

  it("keeps every runtime Pokemon mapped to a Pokemon Showdown cry asset", () => {
    const cryOutputs = new Set(showdownAudioManifest.cries.map((asset) => asset.outputPath));

    for (const species of pokemonRuntimeData.pokemon) {
      const cryStem = showdownCryStemOverrides[species.identifier] ?? species.identifier;
      expect(cryOutputs.has(`audio/cries/showdown/${cryStem}.m4a`)).toBe(true);
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

async function expectTransparentWebpSprite(assetPath: string): Promise<void> {
  const bytes = readAsset(assetPath);
  const metadata = await sharp(bytes).metadata();

  expect(isWebp(bytes)).toBe(true);
  expect(metadata.width).toBe(96);
  expect(metadata.height).toBe(96);
  expect(metadata.hasAlpha).toBe(true);
}

function readAsset(path: string): Buffer {
  return readFileSync(new URL(`./${path.replace(/^resources\//, "")}`, import.meta.url));
}

function readCurrentRootAudioAsset(path: string): Buffer {
  const normalizedPath = path.replace(/^resources\//, "");
  const directUrl = new URL(`./${normalizedPath}`, import.meta.url);
  if (existsSync(directUrl)) {
    return readFileSync(directUrl);
  }

  const fileName = normalizedPath.split("/").at(-1);
  if (fileName) {
    if (fileName === "notification.m4a") {
      const fallbackUrl = new URL("./audio/sfx/phase-change.m4a", import.meta.url);
      if (existsSync(fallbackUrl)) {
        return readFileSync(fallbackUrl);
      }
    }

    for (const sceneFolder of sceneBgmFolders) {
      const sceneUrl = new URL(`./audio/bgm/${sceneFolder}/${fileName}`, import.meta.url);
      if (existsSync(sceneUrl)) {
        return readFileSync(sceneUrl);
      }
    }
  }

  return readFileSync(directUrl);
}

function isPng(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isWebp(bytes: Buffer): boolean {
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}
