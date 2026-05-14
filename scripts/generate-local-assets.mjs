import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

const trainerDir = new URL("../src/resources/trainers/", import.meta.url);
const bgmDir = new URL("../src/resources/audio/bgm/", import.meta.url);
const sfxDir = new URL("../src/resources/audio/sfx/", import.meta.url);
const execFileAsync = promisify(execFile);
const audioSampleRate = 22050;
const sfxBitrate = "24k";
const bgmBitrate = "40k";

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
      "battle-hit.m4a",
      [
        [196, 0.08],
        [146, 0.07],
      ],
      0.38,
    ],
    [
      "battle-critical-hit.m4a",
      [
        [294, 0.05],
        [392, 0.05],
        [588, 0.08],
      ],
      0.42,
    ],
    [
      "battle-miss.m4a",
      [
        [440, 0.05],
        [330, 0.08],
      ],
      0.28,
    ],
    [
      "creature-faint.m4a",
      [
        [220, 0.12],
        [165, 0.14],
        [110, 0.16],
      ],
      0.36,
    ],
    [
      "phase-change.m4a",
      [
        [262, 0.08],
        [330, 0.08],
        [392, 0.12],
      ],
      0.26,
    ],
    [
      "capture-success.m4a",
      [
        [392, 0.08],
        [523, 0.08],
        [659, 0.16],
      ],
      0.36,
    ],
    [
      "capture-fail.m4a",
      [
        [294, 0.08],
        [220, 0.14],
      ],
      0.32,
    ],
  ];
  const typeSfx = [
    ["normal", [196, 147, 220], 0.3],
    ["fire", [330, 494, 659], 0.34],
    ["water", [220, 294, 392], 0.31],
    ["grass", [262, 330, 262], 0.3],
    ["electric", [659, 880, 740], 0.32],
    ["poison", [185, 165, 220], 0.3],
    ["ground", [130, 98, 146], 0.34],
    ["flying", [523, 659, 784], 0.28],
    ["bug", [349, 294, 349], 0.26],
    ["fighting", [220, 330, 220], 0.36],
    ["psychic", [392, 523, 740], 0.27],
    ["rock", [110, 147, 196], 0.36],
    ["ghost", [247, 185, 123], 0.28],
    ["ice", [740, 659, 523], 0.26],
    ["dragon", [196, 294, 440], 0.38],
    ["dark", [165, 123, 196], 0.32],
    ["steel", [440, 330, 247], 0.34],
    ["fairy", [659, 784, 988], 0.24],
  ];

  const bgm = [
    ["starter-ready.m4a", [262, 330, 392, 330, 294, 349, 440, 349]],
    ["battle-capture.m4a", [220, 277, 330, 277, 196, 247, 294, 247]],
    ["team-decision.m4a", [330, 392, 494, 392, 349, 440, 523, 440]],
    ["game-over.m4a", [262, 247, 220, 196, 175, 165, 147, 131]],
  ];

  for (const [file, notes, volume] of sfx) {
    await writeM4a(new URL(file, sfxDir), sequenceSamples(notes, volume), sfxBitrate);
  }

  for (const [type, notes, volume] of typeSfx) {
    await writeM4a(
      new URL(`battle-type-${type}.m4a`, sfxDir),
      typeImpactSamples(notes, volume, false),
      sfxBitrate,
    );
    await writeM4a(
      new URL(`battle-type-${type}-critical.m4a`, sfxDir),
      typeImpactSamples(notes, volume, true),
      sfxBitrate,
    );
    await writeM4a(
      new URL(`battle-support-type-${type}.m4a`, sfxDir),
      supportTypeSamples(notes, volume),
      sfxBitrate,
    );
  }

  for (const [file, notes] of bgm) {
    await writeM4a(new URL(file, bgmDir), loopSamples(notes), bgmBitrate);
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

function typeImpactSamples(notes, volume, critical) {
  const shapedNotes = notes.map((frequency, index) => [
    critical && index === notes.length - 1 ? frequency * 1.5 : frequency,
    critical ? 0.055 : 0.045,
  ]);
  const tail = critical
    ? [
        [notes.at(-1) * 2, 0.045],
        [notes[0] * 0.75, 0.07],
      ]
    : [[notes[0] * 0.5, 0.05]];

  return sequenceSamples([...shapedNotes, ...tail], critical ? volume * 1.22 : volume);
}

function supportTypeSamples(notes, volume) {
  const arpeggio = notes.map((frequency, index) => [
    index % 2 === 0 ? frequency * 1.25 : frequency * 0.75,
    0.07,
  ]);
  return sequenceSamples([...arpeggio, [notes[0], 0.1]], volume * 0.72);
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
  const sampleRate = audioSampleRate;
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

async function writeM4a(destination, samples, bitrate) {
  const tempDir = await mkdtemp(join(tmpdir(), "async-pocket-audio-"));
  const inputPath = join(tempDir, "source.wav");
  const outputPath = fileURLToPath(destination);

  try {
    await writeFile(inputPath, createWav(samples));
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      String(audioSampleRate),
      "-c:a",
      "aac",
      "-b:a",
      bitrate,
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("ffmpeg is required to generate compressed .m4a audio assets.", {
        cause: error,
      });
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
