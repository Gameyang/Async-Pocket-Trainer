import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath, URL } from "node:url";
import sharp from "sharp";

import { writeTrainerPortraitManifest } from "./trainer-asset-manifest.mjs";

const repoId = "sWizad/pokemon-trainer-sprite-pixelart";
const repoUrl = `https://huggingface.co/${repoId}`;
const rawBaseUrl = `${repoUrl}/resolve/main`;
const cacheDir = new URL("../tmp/hf-trainer-sprites/", import.meta.url);
const outputDir = new URL("../src/resources/trainers/", import.meta.url);
const outputSize = 96;

const samples = [
  { source: "9737393.jpeg", output: "hf-trainer-01-harley-quinn.webp" },
  { source: "9737398.jpeg", output: "hf-trainer-02-summer-dress.webp" },
  { source: "9737407.jpeg", output: "hf-trainer-03-evil-fairy.webp" },
  { source: "9737429.jpeg", output: "hf-trainer-04-turtle-step.webp" },
  { source: "9737466.jpeg", output: "hf-trainer-05-dragon-queen.webp" },
  { source: "9737470.jpeg", output: "hf-trainer-06-long-coat.webp" },
  { source: "9737471.jpeg", output: "hf-trainer-07-red-suit.webp" },
  { source: "9737472.jpeg", output: "hf-trainer-08-silent-comic.webp" },
  { source: "9737478.jpeg", output: "hf-trainer-09-card-trickster.webp" },
  { source: "9737481.jpeg", output: "hf-trainer-10-forest-sword.webp" },
  { source: "9737483.jpeg", output: "hf-trainer-11-armored-hero.webp" },
  { source: "9737499.jpeg", output: "hf-trainer-12-kimono-sakura.webp" },
  { source: "9737502.jpeg", output: "hf-trainer-13-blue-flame-witch.webp" },
  { source: "9737504.jpeg", output: "hf-trainer-14-hooded-solo.webp" },
  { source: "9737508.jpeg", output: "hf-trainer-15-pirate-captain.webp" },
  { source: "9737509.jpeg", output: "hf-trainer-16-winged-angel.webp" },
];

await mkdir(cacheDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

for (const sample of samples) {
  const input = await getSourceImage(sample.source);
  const output = await removeBackgroundAndResize(input);

  await writeFile(new URL(sample.output, outputDir), output);
}

const manifest = await writeTrainerPortraitManifest();

process.stdout.write(
  `Built ${samples.length} Hugging Face trainer portraits into ${fileURLToPath(outputDir)}\n` +
    `Trainer manifest now contains ${manifest.generated.length} generated portrait choices.\n`,
);

async function getSourceImage(fileName) {
  const cachePath = new URL(fileName, cacheDir);

  try {
    return await readFile(cachePath);
  } catch {
    const response = await fetch(`${rawBaseUrl}/${fileName}`);

    if (!response.ok) {
      throw new Error(`Failed to download ${fileName}: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(cachePath, buffer);
    return buffer;
  }
}

async function removeBackgroundAndResize(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data);
  const background = createBackgroundMask(pixels, info.width, info.height);
  softenTransparentEdge(pixels, background, info.width, info.height);
  applyBackgroundMask(pixels, background);
  const crop = findOpaqueBounds(pixels, info.width, info.height);
  const square = squareCrop(crop, info.width, info.height);

  return sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .extract(square)
    .resize(outputSize, outputSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: "nearest",
    })
    .webp({ lossless: true, quality: 100 })
    .toBuffer();
}

function createBackgroundMask(pixels, width, height) {
  const samples = sampleCornerColors(pixels, width, height);
  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let read = 0;
  let write = 0;

  const trySeed = (x, y) => {
    const index = y * width + x;

    if (mask[index] || !isBackgroundCandidate(pixels, index, samples, 58)) {
      return;
    }

    mask[index] = 1;
    queue[write] = index;
    write += 1;
  };

  for (let x = 0; x < width; x += 1) {
    trySeed(x, 0);
    trySeed(x, height - 1);
  }

  for (let y = 1; y < height - 1; y += 1) {
    trySeed(0, y);
    trySeed(width - 1, y);
  }

  while (read < write) {
    const index = queue[read];
    read += 1;
    const x = index % width;
    const y = Math.floor(index / width);

    for (const [nextX, nextY] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        continue;
      }

      const nextIndex = nextY * width + nextX;
      if (!mask[nextIndex] && isBackgroundCandidate(pixels, nextIndex, samples, 62)) {
        mask[nextIndex] = 1;
        queue[write] = nextIndex;
        write += 1;
      }
    }
  }

  return mask;
}

function sampleCornerColors(pixels, width, height) {
  const size = Math.max(8, Math.round(Math.min(width, height) * 0.04));

  return [
    averageRegion(pixels, width, 0, 0, size, size),
    averageRegion(pixels, width, width - size, 0, size, size),
    averageRegion(pixels, width, 0, height - size, size, size),
    averageRegion(pixels, width, width - size, height - size, size, size),
  ];
}

function averageRegion(pixels, width, left, top, regionWidth, regionHeight) {
  const color = [0, 0, 0];
  let count = 0;

  for (let y = top; y < top + regionHeight; y += 1) {
    for (let x = left; x < left + regionWidth; x += 1) {
      const offset = (y * width + x) * 4;
      color[0] += pixels[offset];
      color[1] += pixels[offset + 1];
      color[2] += pixels[offset + 2];
      count += 1;
    }
  }

  return color.map((channel) => channel / count);
}

function isBackgroundCandidate(pixels, index, samples, threshold) {
  const offset = index * 4;
  const color = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];

  return samples.some((sample) => colorDistance(color, sample) <= threshold);
}

function colorDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function softenTransparentEdge(pixels, mask, width, height) {
  const additions = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;

      if (mask[index]) {
        continue;
      }

      const offset = index * 4;
      const isNearWhite =
        pixels[offset] > 205 && pixels[offset + 1] > 205 && pixels[offset + 2] > 205;
      const touchesBackground =
        mask[index - 1] || mask[index + 1] || mask[index - width] || mask[index + width];

      if (isNearWhite && touchesBackground) {
        additions.push(index);
      }
    }
  }

  additions.forEach((index) => {
    mask[index] = 1;
  });
}

function applyBackgroundMask(pixels, mask) {
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      pixels[index * 4 + 3] = 0;
    }
  }
}

function findOpaqueBounds(pixels, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) {
        continue;
      }

      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    throw new Error("Background removal removed the whole image.");
  }

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function squareCrop(crop, imageWidth, imageHeight) {
  const padding = Math.round(Math.max(crop.width, crop.height) * 0.08);
  const size = Math.min(Math.max(crop.width, crop.height) + padding * 2, imageWidth, imageHeight);
  const centerX = crop.left + crop.width / 2;
  const centerY = crop.top + crop.height / 2;
  const left = clamp(Math.round(centerX - size / 2), 0, imageWidth - size);
  const top = clamp(Math.round(centerY - size / 2), 0, imageHeight - size);

  return { left, top, width: size, height: size };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export const huggingFaceTrainerSamples = samples.map((sample) => ({
  ...sample,
  sourceUrl: `${rawBaseUrl}/${basename(sample.source)}`,
}));
