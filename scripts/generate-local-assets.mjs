import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import { deflateSync } from "node:zlib";

const trainerDir = new URL("../src/resources/trainers/", import.meta.url);
const bgmDir = new URL("../src/resources/audio/bgm/", import.meta.url);
const sfxDir = new URL("../src/resources/audio/sfx/", import.meta.url);

await mkdir(trainerDir, { recursive: true });
await mkdir(bgmDir, { recursive: true });
await mkdir(sfxDir, { recursive: true });

await generateTrainerPortraits();
await generateAudio();

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

async function generateAudio() {
  const sfx = [
    [
      "battle-hit.wav",
      [
        [196, 0.08],
        [146, 0.07],
      ],
      0.38,
    ],
    [
      "battle-critical-hit.wav",
      [
        [294, 0.05],
        [392, 0.05],
        [588, 0.08],
      ],
      0.42,
    ],
    [
      "battle-miss.wav",
      [
        [440, 0.05],
        [330, 0.08],
      ],
      0.28,
    ],
    [
      "creature-faint.wav",
      [
        [220, 0.12],
        [165, 0.14],
        [110, 0.16],
      ],
      0.36,
    ],
    [
      "phase-change.wav",
      [
        [262, 0.08],
        [330, 0.08],
        [392, 0.12],
      ],
      0.26,
    ],
    [
      "capture-success.wav",
      [
        [392, 0.08],
        [523, 0.08],
        [659, 0.16],
      ],
      0.36,
    ],
    [
      "capture-fail.wav",
      [
        [294, 0.08],
        [220, 0.14],
      ],
      0.32,
    ],
  ];

  const bgm = [
    ["starter-ready.wav", [262, 330, 392, 330, 294, 349, 440, 349]],
    ["battle-capture.wav", [220, 277, 330, 277, 196, 247, 294, 247]],
    ["team-decision.wav", [330, 392, 494, 392, 349, 440, 523, 440]],
    ["game-over.wav", [262, 247, 220, 196, 175, 165, 147, 131]],
  ];

  for (const [file, notes, volume] of sfx) {
    await writeFile(new URL(file, sfxDir), createWav(sequenceSamples(notes, volume)));
  }

  for (const [file, notes] of bgm) {
    await writeFile(new URL(file, bgmDir), createWav(loopSamples(notes)));
  }
}

function sequenceSamples(notes, volume) {
  const sampleRate = 22050;
  const samples = [];

  for (const [frequency, duration] of notes) {
    const length = Math.floor(sampleRate * duration);
    for (let index = 0; index < length; index += 1) {
      const envelope = 1 - index / length;
      samples.push(Math.sin((Math.PI * 2 * frequency * index) / sampleRate) * volume * envelope);
    }
  }

  return samples;
}

function loopSamples(notes) {
  const sampleRate = 22050;
  const samples = [];

  for (const frequency of notes) {
    const length = Math.floor(sampleRate * 0.18);
    for (let index = 0; index < length; index += 1) {
      const envelope = 0.55 + 0.45 * Math.sin((Math.PI * index) / length);
      const tone = Math.sin((Math.PI * 2 * frequency * index) / sampleRate);
      const harmony = Math.sin((Math.PI * 2 * (frequency / 2) * index) / sampleRate);
      samples.push((tone * 0.08 + harmony * 0.05) * envelope);
    }
  }

  return samples;
}

function createWav(samples) {
  const sampleRate = 22050;
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * bytesPerSample);
  });

  return buffer;
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
