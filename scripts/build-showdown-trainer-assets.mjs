import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import sharp from "sharp";

import { writeTrainerPortraitManifest } from "./trainer-asset-manifest.mjs";

const sourceUrl = "https://play.pokemonshowdown.com/sprites/trainers/";
const cacheDir = new URL("../tmp/showdown-trainer-sprites/", import.meta.url);
const outputDir = new URL("../src/resources/trainers/", import.meta.url);
const metadataPath = new URL(
  "../src/resources/trainers/pokemon-showdown-trainers.json",
  import.meta.url,
);
const outputSize = 96;
const concurrency = 12;

await mkdir(cacheDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

const sprites = await getTrainerSprites();
await mapLimit(sprites, concurrency, async (sprite) => {
  const input = await getSourceImage(sprite.source);
  const output = await resizeTransparentSprite(input);

  await writeFile(new URL(sprite.output, outputDir), output);
});

await writeFile(metadataPath, `${JSON.stringify(sprites, null, 2)}\n`);
const manifest = await writeTrainerPortraitManifest();

process.stdout.write(
  `Built ${sprites.length} Pokemon Showdown trainer portraits into ${fileURLToPath(outputDir)}\n` +
    `Trainer manifest now contains ${manifest.generated.length} generated portrait choices.\n`,
);

async function getTrainerSprites() {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Failed to read Pokemon Showdown trainer index: HTTP ${response.status}`);
  }

  const html = await response.text();
  const sprites = parseTrainerSprites(html);

  if (!sprites.length) {
    throw new Error("Pokemon Showdown trainer index did not contain any PNG sprites.");
  }

  return sprites;
}

function parseTrainerSprites(html) {
  const figures = [...html.matchAll(/<figure id="([^"]+\.png)">([\s\S]*?)<\/figure>/g)];
  const seenOutputs = new Set();

  return figures.map((match) => {
    const source = match[1];
    const block = match[2];
    const caption = block.match(/<figcaption>[\s\S]*?<\/a>(?:<br \/>by ([^<]+))?<\/figcaption>/);
    const artist = caption?.[1] ? decodeHtml(caption[1].trim()) : null;
    const output = `ps-trainer-${toOutputSlug(source)}.webp`;

    if (seenOutputs.has(output)) {
      throw new Error(`Duplicate Showdown trainer output generated for ${source}: ${output}`);
    }

    seenOutputs.add(output);

    return {
      source,
      output,
      artist,
      sourceUrl: new URL(source, sourceUrl).href,
    };
  });
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function toOutputSlug(source) {
  return source
    .replace(/\.png$/i, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

async function getSourceImage(fileName) {
  const cachePath = new URL(fileName, cacheDir);

  try {
    return await readFile(cachePath);
  } catch {
    const response = await fetch(new URL(fileName, sourceUrl));

    if (!response.ok) {
      throw new Error(`Failed to download ${fileName}: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(cachePath, buffer);
    return buffer;
  }
}

async function resizeTransparentSprite(input) {
  const image = sharp(input).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const bounds = padBounds(
    findOpaqueBounds(data, info.width, info.height),
    info.width,
    info.height,
  );

  return sharp(input)
    .ensureAlpha()
    .extract(bounds)
    .resize(outputSize, outputSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: "nearest",
    })
    .webp({ lossless: true, quality: 100 })
    .toBuffer();
}

function findOpaqueBounds(pixels, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= 8) {
        continue;
      }

      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    throw new Error("Transparent sprite did not contain any visible pixels.");
  }

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function padBounds(bounds, imageWidth, imageHeight) {
  const padding = Math.max(2, Math.round(Math.max(bounds.width, bounds.height) * 0.08));
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const right = Math.min(imageWidth, bounds.left + bounds.width + padding);
  const bottom = Math.min(imageHeight, bounds.top + bounds.height + padding);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;

  async function runNext() {
    const current = index;
    index += 1;

    if (current >= items.length) {
      return;
    }

    results[current] = await worker(items[current], current);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

export const pokemonShowdownTrainerSource = sourceUrl;
