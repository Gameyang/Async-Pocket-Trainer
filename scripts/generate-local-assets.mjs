import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import { deflateSync } from "node:zlib";

// Audio (SFX + BGM) is sourced from OpenGameArt (CC0). See docs/assets.md for attribution.
// This script only generates the procedural trainer portraits used as encounter badges.
const trainerDir = new URL("../src/resources/trainers/", import.meta.url);

await mkdir(trainerDir, { recursive: true });
await generateTrainerPortraits();

async function generateTrainerPortraits() {
  const portraits = [
    {
      file: "field-scout.webp",
      cap: [216, 75, 61],
      jacket: [47, 126, 84],
      accent: [246, 196, 83],
      skin: [240, 189, 138],
      bgA: [139, 216, 255],
      bgB: [88, 179, 104],
    },
    {
      file: "checkpoint-captain.webp",
      cap: [85, 126, 234],
      jacket: [38, 56, 79],
      accent: [246, 196, 83],
      skin: [217, 155, 113],
      bgA: [255, 225, 137],
      bgB: [119, 199, 239],
    },
    {
      file: "sheet-rival.webp",
      cap: [127, 75, 179],
      jacket: [31, 107, 122],
      accent: [232, 255, 237],
      skin: [228, 173, 121],
      bgA: [158, 230, 179],
      bgB: [85, 126, 234],
    },
  ];

  for (const portrait of portraits) {
    await writeFile(new URL(portrait.file, trainerDir), createPortraitPng(portrait));
  }
}

function createPortraitPng(portrait) {
  const width = 64;
  const height = 64;
  const pixels = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const blend = y / (height - 1);
    const color = mix(portrait.bgA, portrait.bgB, blend);

    for (let x = 0; x < width; x += 1) {
      setPixel(pixels, width, x, y, color);
    }
  }

  fillEllipse(pixels, width, height, 32, 58, 20, 5, [0, 0, 0, 68]);
  fillRoundedRect(pixels, width, height, 16, 38, 32, 23, 8, [16, 23, 34, 255]);
  fillRoundedRect(pixels, width, height, 19, 40, 26, 20, 6, [...portrait.jacket, 255]);
  fillRect(pixels, width, height, 30, 39, 5, 21, [...portrait.accent, 255]);
  fillRoundedRect(pixels, width, height, 24, 31, 16, 13, 4, [16, 23, 34, 255]);
  fillRoundedRect(pixels, width, height, 27, 33, 10, 10, 3, [...portrait.skin, 255]);
  fillRoundedRect(pixels, width, height, 16, 17, 32, 26, 10, [16, 23, 34, 255]);
  fillRoundedRect(pixels, width, height, 19, 20, 26, 21, 8, [...portrait.skin, 255]);
  fillRoundedRect(pixels, width, height, 16, 18, 32, 11, 5, [59, 42, 36, 255]);
  fillRoundedRect(pixels, width, height, 14, 10, 36, 16, 8, [16, 23, 34, 255]);
  fillRoundedRect(pixels, width, height, 17, 12, 30, 11, 6, [...portrait.cap, 255]);
  fillRoundedRect(pixels, width, height, 28, 20, 21, 8, 4, [16, 23, 34, 255]);
  fillRoundedRect(pixels, width, height, 29, 21, 18, 5, 3, [...portrait.cap, 255]);
  fillEllipse(pixels, width, height, 26, 30, 2, 3, [16, 23, 34, 255]);
  fillEllipse(pixels, width, height, 38, 30, 2, 3, [16, 23, 34, 255]);
  fillEllipse(pixels, width, height, 41, 47, 5, 5, [16, 23, 34, 255]);
  fillEllipse(pixels, width, height, 41, 47, 3, 3, [...portrait.accent, 255]);

  return createPng(width, height, pixels);
}

function mix(left, right, amount) {
  return [
    Math.round(left[0] + (right[0] - left[0]) * amount),
    Math.round(left[1] + (right[1] - left[1]) * amount),
    Math.round(left[2] + (right[2] - left[2]) * amount),
    255,
  ];
}

function setPixel(pixels, width, x, y, color) {
  const offset = (y * width + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      if (column >= 0 && column < width && row >= 0 && row < height) {
        setPixel(pixels, width, column, row, color);
      }
    }
  }
}

function fillRoundedRect(pixels, width, height, x, y, rectWidth, rectHeight, radius, color) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      const dx = Math.max(x + radius - column, 0, column - (x + rectWidth - radius - 1));
      const dy = Math.max(y + radius - row, 0, row - (y + rectHeight - radius - 1));

      if (dx * dx + dy * dy <= radius * radius) {
        if (column >= 0 && column < width && row >= 0 && row < height) {
          setPixel(pixels, width, column, row, color);
        }
      }
    }
  }
}

function fillEllipse(pixels, width, height, centerX, centerY, radiusX, radiusY, color) {
  for (let row = Math.floor(centerY - radiusY); row <= Math.ceil(centerY + radiusY); row += 1) {
    for (
      let column = Math.floor(centerX - radiusX);
      column <= Math.ceil(centerX + radiusX);
      column += 1
    ) {
      const dx = (column - centerX) / radiusX;
      const dy = (row - centerY) / radiusY;

      if (dx * dx + dy * dy <= 1 && column >= 0 && column < width && row >= 0 && row < height) {
        setPixel(pixels, width, column, row, color);
      }
    }
  }
}

function createPng(width, height, rgbaPixels) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0;
    Buffer.from(rgbaPixels.slice(y * width * 4, (y + 1) * width * 4)).copy(raw, y * rowLength + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
