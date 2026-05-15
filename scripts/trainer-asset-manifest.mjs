import { readdir, writeFile } from "node:fs/promises";

const trainerDir = new URL("../src/resources/trainers/", import.meta.url);
const manifestPath = new URL(
  "../src/resources/trainers/trainerPortraitManifest.json",
  import.meta.url,
);

const proceduralGenerated = [
  "resources/trainers/field-scout.webp",
  "resources/trainers/checkpoint-captain.webp",
];
const proceduralAll = [...proceduralGenerated, "resources/trainers/sheet-rival.webp"];

export async function writeTrainerPortraitManifest() {
  const files = await readdir(trainerDir);
  const huggingFace = files
    .filter((fileName) => fileName.startsWith("hf-trainer-") && fileName.endsWith(".webp"))
    .sort()
    .map(toResourcePath);
  const pokemonShowdown = files
    .filter((fileName) => fileName.startsWith("ps-trainer-") && fileName.endsWith(".webp"))
    .sort()
    .map(toResourcePath);

  const manifest = {
    sheet: "resources/trainers/sheet-rival.webp",
    procedural: proceduralAll,
    huggingFace,
    pokemonShowdown,
    generated: [...proceduralGenerated, ...huggingFace, ...pokemonShowdown],
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function toResourcePath(fileName) {
  return `resources/trainers/${fileName}`;
}
