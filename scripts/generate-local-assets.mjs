import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

const trainerDir = new URL("../src/resources/trainers/", import.meta.url);
const bgmDir = new URL("../src/resources/audio/bgm/", import.meta.url);
const sfxDir = new URL("../src/resources/audio/sfx/", import.meta.url);
const execFileAsync = promisify(execFile);
const audioSampleRate = 44100;
const sfxBitrate = "72k";
const bgmBitrate = "48k";
const battleSfxOnly = process.argv.includes("--battle-sfx");
const elementTypes = [
  "normal", "fire", "water", "grass", "electric", "poison",
  "ground", "flying", "bug", "fighting", "psychic", "rock",
  "ghost", "ice", "dragon", "dark", "steel", "fairy",
];

await mkdir(trainerDir, { recursive: true });
await mkdir(bgmDir, { recursive: true });
await mkdir(sfxDir, { recursive: true });

if (!battleSfxOnly) {
  await generateTrainerPortraits();
}

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
  const sfxBuilders = [
    ["battle-hit.m4a", synthHit],
    ["battle-critical-hit.m4a", synthCriticalHit],
    ["battle-miss.m4a", synthMiss],
    ["creature-faint.m4a", synthFaint],
    ["phase-change.m4a", synthPhaseChange],
    ["capture-success.m4a", synthCaptureSuccess],
    ["capture-fail.m4a", synthCaptureFail],
  ];
  const bgm = [
    ["starter-ready.m4a", [262, 330, 392, 330, 294, 349, 440, 349]],
    ["battle-capture.m4a", [220, 277, 330, 277, 196, 247, 294, 247]],
    ["team-decision.m4a", [330, 392, 494, 392, 349, 440, 523, 440]],
    ["game-over.m4a", [262, 247, 220, 196, 175, 165, 147, 131]],
  ];

  for (const [file, build] of sfxBuilders) {
    resetNoiseSeed(file);
    await writeM4a(new URL(file, sfxDir), build(), sfxBitrate);
  }

  for (const type of elementTypes) {
    resetNoiseSeed(`battle-type-${type}.m4a`);
    await writeM4a(
      new URL(`battle-type-${type}.m4a`, sfxDir),
      synthTypeImpact(type, false),
      sfxBitrate,
    );
    resetNoiseSeed(`battle-type-${type}-critical.m4a`);
    await writeM4a(
      new URL(`battle-type-${type}-critical.m4a`, sfxDir),
      synthTypeImpact(type, true),
      sfxBitrate,
    );
    resetNoiseSeed(`battle-support-type-${type}.m4a`);
    await writeM4a(
      new URL(`battle-support-type-${type}.m4a`, sfxDir),
      synthTypeSupport(type),
      sfxBitrate,
    );
  }

  for (const [file, notes] of bgm) {
    await writeM4a(new URL(file, bgmDir), loopSamples(notes), bgmBitrate);
  }
}

async function generateBattleAudio() {
  const sfxBuilders = [
    ["battle-hit.m4a", synthHit],
    ["battle-critical-hit.m4a", synthCriticalHit],
    ["battle-miss.m4a", synthMiss],
    ["creature-faint.m4a", synthFaint],
  ];

  for (const [file, build] of sfxBuilders) {
    resetNoiseSeed(file);
    await writeM4a(new URL(file, sfxDir), build(), sfxBitrate);
  }

  for (const type of elementTypes) {
    resetNoiseSeed(`battle-type-${type}.m4a`);
    await writeM4a(
      new URL(`battle-type-${type}.m4a`, sfxDir),
      synthTypeImpact(type, false),
      sfxBitrate,
    );
    resetNoiseSeed(`battle-type-${type}-critical.m4a`);
    await writeM4a(
      new URL(`battle-type-${type}-critical.m4a`, sfxDir),
      synthTypeImpact(type, true),
      sfxBitrate,
    );
    resetNoiseSeed(`battle-support-type-${type}.m4a`);
    await writeM4a(
      new URL(`battle-support-type-${type}.m4a`, sfxDir),
      synthTypeSupport(type),
      sfxBitrate,
    );
  }
}

function makeBuffer(durationMs) {
  return new Float32Array(Math.floor((durationMs / 1000) * audioSampleRate));
}

function envelopeAt(index, length, attackSamples, releaseSamples) {
  if (index < attackSamples) {
    return index / Math.max(1, attackSamples);
  }
  if (index > length - releaseSamples) {
    return Math.max(0, (length - index) / Math.max(1, releaseSamples));
  }
  return 1;
}

function addTone(buf, opts) {
  const start = Math.floor((opts.startMs / 1000) * audioSampleRate);
  const length = Math.floor((opts.durMs / 1000) * audioSampleRate);
  const attack = Math.floor(((opts.attackMs ?? 2) / 1000) * audioSampleRate);
  const release = Math.floor(((opts.releaseMs ?? 30) / 1000) * audioSampleRate);
  const wave = opts.wave ?? "sine";
  const gain = opts.gain ?? 0.25;
  const lfoRate = opts.lfoRate ?? 0;
  const lfoDepth = opts.lfoDepth ?? 0;
  let phase = 0;

  for (let i = 0; i < length; i += 1) {
    const target = start + i;
    if (target < 0 || target >= buf.length) continue;
    const t = i / Math.max(1, length);
    let freq = opts.freqEnd !== undefined ? opts.freq + (opts.freqEnd - opts.freq) * t : opts.freq;
    if (lfoRate > 0) {
      freq += Math.sin((2 * Math.PI * lfoRate * i) / audioSampleRate) * lfoDepth;
    }
    phase += (2 * Math.PI * freq) / audioSampleRate;
    const cycle = (phase / (2 * Math.PI)) % 1;
    let sample;
    if (wave === "sine") sample = Math.sin(phase);
    else if (wave === "square") sample = Math.sin(phase) >= 0 ? 1 : -1;
    else if (wave === "saw") sample = cycle * 2 - 1;
    else sample = 1 - Math.abs(cycle - 0.5) * 4;
    const env = envelopeAt(i, length, attack, release);
    buf[target] += sample * gain * env;
  }
}

let noiseState = 0x8f1bbcdc;

function resetNoiseSeed(seed) {
  noiseState = 0x811c9dc5;
  for (const char of seed) {
    noiseState ^= char.charCodeAt(0);
    noiseState = Math.imul(noiseState, 0x01000193) >>> 0;
  }
  if (noiseState === 0) {
    noiseState = 0x8f1bbcdc;
  }
}

function nextNoiseSample() {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  return ((noiseState >>> 0) / 0xffffffff) * 2 - 1;
}

function addNoise(buf, opts) {
  const start = Math.floor((opts.startMs / 1000) * audioSampleRate);
  const length = Math.floor((opts.durMs / 1000) * audioSampleRate);
  const attack = Math.floor(((opts.attackMs ?? 2) / 1000) * audioSampleRate);
  const release = Math.floor(((opts.releaseMs ?? 40) / 1000) * audioSampleRate);
  const gain = opts.gain ?? 0.3;
  const lpFactor =
    opts.color === "low" ? 0.08 : opts.color === "mid" ? 0.35 : opts.color === "high" ? 0.85 : 1;
  let lpState = 0;

  for (let i = 0; i < length; i += 1) {
    const target = start + i;
    if (target < 0 || target >= buf.length) continue;
    const noise = nextNoiseSample();
    lpState += lpFactor * (noise - lpState);
    const sample = opts.color ? lpState : noise;
    const env = envelopeAt(i, length, attack, release);
    buf[target] += sample * gain * env;
  }
}

function bufferToSamples(buf) {
  let peak = 0;
  for (const value of buf) {
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  const normalize = peak > 0.95 ? 0.95 / peak : 1;
  const out = new Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] * normalize;
  return out;
}

function addChipArp(buf, opts) {
  const stepMs = opts.stepMs ?? 34;
  const durMs = opts.durMs ?? 64;
  const wave = opts.wave ?? "square";
  const gain = opts.gain ?? 0.1;
  opts.notes.forEach((freq, index) => {
    addTone(buf, {
      startMs: opts.startMs + index * stepMs,
      durMs,
      freq,
      wave,
      gain,
      attackMs: 1,
      releaseMs: durMs * 0.75,
    });
  });
}

function addEcho(buf, delayMs, feedback, wet = 0.35) {
  const delay = Math.max(1, Math.floor((delayMs / 1000) * audioSampleRate));

  for (let i = delay; i < buf.length; i += 1) {
    buf[i] += buf[i - delay] * feedback * wet;
  }
}

function applyBitcrush(buf, levels = 48, holdSamples = 2) {
  let held = 0;
  const hold = Math.max(1, holdSamples);

  for (let i = 0; i < buf.length; i += 1) {
    if (i % hold === 0) {
      held = Math.round(buf[i] * levels) / levels;
    }
    buf[i] = held;
  }
}

function applySaturation(buf, drive = 1.5) {
  const normalizer = Math.tanh(drive);

  for (let i = 0; i < buf.length; i += 1) {
    buf[i] = Math.tanh(buf[i] * drive) / normalizer;
  }
}

function synthHit() {
  const buf = makeBuffer(220);
  addNoise(buf, { startMs: 0, durMs: 72, gain: 0.7, attackMs: 1, releaseMs: 58, color: "mid" });
  addTone(buf, { startMs: 0, durMs: 130, freq: 92, freqEnd: 42, wave: "saw", gain: 0.42, attackMs: 1, releaseMs: 100 });
  addTone(buf, { startMs: 4, durMs: 150, freq: 520, freqEnd: 170, wave: "square", gain: 0.24, attackMs: 1, releaseMs: 120 });
  addChipArp(buf, { startMs: 30, notes: [880, 660, 440], stepMs: 24, durMs: 48, gain: 0.08 });
  applySaturation(buf, 1.7);
  applyBitcrush(buf, 56, 2);
  return bufferToSamples(buf);
}

function synthCriticalHit() {
  const buf = makeBuffer(420);
  addNoise(buf, { startMs: 0, durMs: 125, gain: 0.8, attackMs: 1, releaseMs: 100, color: "mid" });
  addTone(buf, { startMs: 0, durMs: 230, freq: 82, freqEnd: 34, wave: "saw", gain: 0.58, attackMs: 1, releaseMs: 190 });
  addTone(buf, { startMs: 0, durMs: 260, freq: 720, freqEnd: 190, wave: "square", gain: 0.28, releaseMs: 220 });
  addChipArp(buf, { startMs: 20, notes: [1320, 1760, 2200, 1760], stepMs: 28, durMs: 58, gain: 0.14 });
  addTone(buf, { startMs: 160, durMs: 180, freq: 196, freqEnd: 82, wave: "saw", gain: 0.34, releaseMs: 150 });
  addEcho(buf, 78, 0.42, 0.28);
  applySaturation(buf, 2.1);
  applyBitcrush(buf, 44, 2);
  return bufferToSamples(buf);
}

function synthMiss() {
  const buf = makeBuffer(240);
  addTone(buf, { startMs: 0, durMs: 220, freq: 1320, freqEnd: 260, wave: "triangle", gain: 0.32, attackMs: 4, releaseMs: 150 });
  addTone(buf, { startMs: 12, durMs: 185, freq: 1760, freqEnd: 520, wave: "sine", gain: 0.16, attackMs: 4, releaseMs: 130 });
  addNoise(buf, { startMs: 0, durMs: 70, gain: 0.24, attackMs: 1, releaseMs: 60, color: "high" });
  addChipArp(buf, { startMs: 118, notes: [440, 330], stepMs: 30, durMs: 58, gain: 0.08, wave: "triangle" });
  applyBitcrush(buf, 72, 2);
  return bufferToSamples(buf);
}

function synthFaint() {
  const buf = makeBuffer(640);
  addTone(buf, { startMs: 0, durMs: 610, freq: 520, freqEnd: 86, wave: "saw", gain: 0.34, attackMs: 8, releaseMs: 280 });
  addTone(buf, { startMs: 0, durMs: 610, freq: 260, freqEnd: 43, wave: "square", gain: 0.2, attackMs: 8, releaseMs: 280 });
  addChipArp(buf, { startMs: 90, notes: [392, 330, 262, 196], stepMs: 72, durMs: 110, gain: 0.09, wave: "triangle" });
  addNoise(buf, { startMs: 420, durMs: 190, gain: 0.16, attackMs: 20, releaseMs: 150, color: "low" });
  addEcho(buf, 92, 0.36, 0.25);
  applySaturation(buf, 1.35);
  applyBitcrush(buf, 64, 3);
  return bufferToSamples(buf);
}

function synthPhaseChange() {
  const buf = makeBuffer(320);
  const notes = [523, 659, 784];
  notes.forEach((freq, index) => {
    const startMs = index * 90;
    addTone(buf, { startMs, durMs: 110, freq, wave: "sine", gain: 0.3, attackMs: 4, releaseMs: 90 });
    addTone(buf, { startMs, durMs: 110, freq: freq * 2, wave: "sine", gain: 0.12, attackMs: 4, releaseMs: 90 });
    addTone(buf, { startMs, durMs: 110, freq: freq / 2, wave: "triangle", gain: 0.08, attackMs: 4, releaseMs: 90 });
  });
  return bufferToSamples(buf);
}

function synthCaptureSuccess() {
  const buf = makeBuffer(620);
  const notes = [392, 523, 659, 784];
  notes.forEach((freq, index) => {
    const startMs = index * 120;
    addTone(buf, { startMs, durMs: 160, freq, wave: "square", gain: 0.22, attackMs: 3, releaseMs: 140 });
    addTone(buf, { startMs, durMs: 160, freq: freq * 2, wave: "sine", gain: 0.1, attackMs: 3, releaseMs: 140 });
  });
  addTone(buf, { startMs: 480, durMs: 140, freq: 1568, wave: "sine", gain: 0.16, attackMs: 5, releaseMs: 120 });
  addTone(buf, { startMs: 480, durMs: 140, freq: 2093, wave: "sine", gain: 0.1, attackMs: 5, releaseMs: 120 });
  return bufferToSamples(buf);
}

function synthCaptureFail() {
  const buf = makeBuffer(360);
  addTone(buf, { startMs: 0, durMs: 220, freq: 330, freqEnd: 138, wave: "saw", gain: 0.3, attackMs: 3, releaseMs: 180 });
  addTone(buf, { startMs: 0, durMs: 220, freq: 165, freqEnd: 82, wave: "sine", gain: 0.18, attackMs: 3, releaseMs: 180 });
  addNoise(buf, { startMs: 200, durMs: 160, gain: 0.2, attackMs: 5, releaseMs: 120, color: "low" });
  return bufferToSamples(buf);
}

const typeImpactRecipes = {
  normal: (buf, dur) => {
    addNoise(buf, { startMs: 0, durMs: dur * 0.3, gain: 0.32, attackMs: 1, releaseMs: dur * 0.25, color: "mid" });
    addTone(buf, { startMs: 0, durMs: dur * 0.8, freq: 220, freqEnd: 165, wave: "square", gain: 0.28, releaseMs: dur * 0.6 });
    addTone(buf, { startMs: 0, durMs: dur * 0.8, freq: 110, wave: "saw", gain: 0.16, releaseMs: dur * 0.6 });
  },
  fire: (buf, dur) => {
    addNoise(buf, { startMs: 0, durMs: dur * 0.55, gain: 0.5, attackMs: 1, releaseMs: dur * 0.45, color: "mid" });
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 360, freqEnd: 180, wave: "square", gain: 0.3, releaseMs: dur * 0.7 });
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 165, freqEnd: 110, wave: "saw", gain: 0.2, releaseMs: dur * 0.7 });
  },
  water: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur, freq: 220, wave: "sine", gain: 0.3, attackMs: 5, releaseMs: dur * 0.6, lfoRate: 7, lfoDepth: 28 });
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 110, wave: "sine", gain: 0.18, attackMs: 5, releaseMs: dur * 0.6 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.3, gain: 0.2, attackMs: 2, releaseMs: dur * 0.25, color: "high" });
  },
  grass: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 262, wave: "square", gain: 0.26, attackMs: 3, releaseMs: dur * 0.7 });
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 392, wave: "sine", gain: 0.14, attackMs: 3, releaseMs: dur * 0.7 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.45, gain: 0.22, attackMs: 1, releaseMs: dur * 0.4, color: "mid" });
  },
  electric: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur * 0.85, freq: 660, freqEnd: 990, wave: "saw", gain: 0.28, releaseMs: dur * 0.6, lfoRate: 14, lfoDepth: 120 });
    addTone(buf, { startMs: 0, durMs: dur * 0.4, freq: 1320, wave: "square", gain: 0.14, attackMs: 1, releaseMs: dur * 0.35 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.25, gain: 0.28, attackMs: 1, releaseMs: dur * 0.22, color: "high" });
  },
  poison: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 165, wave: "saw", gain: 0.28, releaseMs: dur * 0.7, lfoRate: 5, lfoDepth: 18 });
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 220, wave: "saw", gain: 0.18, releaseMs: dur * 0.7 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.5, gain: 0.22, attackMs: 2, releaseMs: dur * 0.4, color: "low" });
  },
  ground: (buf, dur) => {
    addNoise(buf, { startMs: 0, durMs: dur * 0.85, gain: 0.5, attackMs: 1, releaseMs: dur * 0.7, color: "low" });
    addTone(buf, { startMs: 0, durMs: dur * 0.95, freq: 82, wave: "sine", gain: 0.32, releaseMs: dur * 0.75 });
    addTone(buf, { startMs: 0, durMs: dur * 0.6, freq: 165, freqEnd: 110, wave: "square", gain: 0.16, releaseMs: dur * 0.5 });
  },
  flying: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 880, freqEnd: 392, wave: "sine", gain: 0.32, attackMs: 5, releaseMs: dur * 0.6 });
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 1760, freqEnd: 784, wave: "sine", gain: 0.14, attackMs: 5, releaseMs: dur * 0.6 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.4, gain: 0.18, attackMs: 5, releaseMs: dur * 0.35, color: "high" });
  },
  bug: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 350, wave: "square", gain: 0.28, releaseMs: dur * 0.6, lfoRate: 22, lfoDepth: 40 });
    addTone(buf, { startMs: 0, durMs: dur * 0.6, freq: 700, wave: "saw", gain: 0.12, releaseMs: dur * 0.5 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.4, gain: 0.15, attackMs: 2, releaseMs: dur * 0.35, color: "mid" });
  },
  fighting: (buf, dur) => {
    addNoise(buf, { startMs: 0, durMs: dur * 0.5, gain: 0.6, attackMs: 1, releaseMs: dur * 0.4, color: "mid" });
    addTone(buf, { startMs: 0, durMs: dur * 0.85, freq: 220, freqEnd: 140, wave: "square", gain: 0.34, releaseMs: dur * 0.7 });
    addTone(buf, { startMs: 0, durMs: dur * 0.85, freq: 82, wave: "sine", gain: 0.26, releaseMs: dur * 0.7 });
  },
  psychic: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur, freq: 392, wave: "sine", gain: 0.28, attackMs: 8, releaseMs: dur * 0.7, lfoRate: 5, lfoDepth: 14 });
    addTone(buf, { startMs: 0, durMs: dur, freq: 740, wave: "sine", gain: 0.18, attackMs: 8, releaseMs: dur * 0.7, lfoRate: 5, lfoDepth: 18 });
    addTone(buf, { startMs: 0, durMs: dur, freq: 1480, wave: "sine", gain: 0.08, attackMs: 8, releaseMs: dur * 0.7 });
  },
  rock: (buf, dur) => {
    addNoise(buf, { startMs: 0, durMs: dur * 0.55, gain: 0.6, attackMs: 1, releaseMs: dur * 0.45, color: "low" });
    addTone(buf, { startMs: 0, durMs: dur * 0.85, freq: 110, freqEnd: 82, wave: "square", gain: 0.3, releaseMs: dur * 0.7 });
    addTone(buf, { startMs: 0, durMs: dur * 0.6, freq: 220, wave: "saw", gain: 0.16, releaseMs: dur * 0.5 });
  },
  ghost: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur, freq: 247, freqEnd: 124, wave: "sine", gain: 0.3, attackMs: 12, releaseMs: dur * 0.7, lfoRate: 4, lfoDepth: 16 });
    addTone(buf, { startMs: 0, durMs: dur, freq: 124, freqEnd: 62, wave: "saw", gain: 0.2, attackMs: 12, releaseMs: dur * 0.7 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.5, gain: 0.16, attackMs: 12, releaseMs: dur * 0.4, color: "low" });
  },
  ice: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 880, wave: "sine", gain: 0.3, attackMs: 3, releaseMs: dur * 0.7 });
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 1760, wave: "sine", gain: 0.18, attackMs: 3, releaseMs: dur * 0.7 });
    addTone(buf, { startMs: 40, durMs: dur * 0.8, freq: 2640, wave: "sine", gain: 0.08, attackMs: 6, releaseMs: dur * 0.6 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.2, gain: 0.18, attackMs: 1, releaseMs: dur * 0.18, color: "high" });
  },
  dragon: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur * 0.95, freq: 196, freqEnd: 147, wave: "saw", gain: 0.34, releaseMs: dur * 0.75, lfoRate: 6, lfoDepth: 10 });
    addTone(buf, { startMs: 0, durMs: dur * 0.95, freq: 294, freqEnd: 220, wave: "saw", gain: 0.22, releaseMs: dur * 0.75 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.6, gain: 0.3, attackMs: 2, releaseMs: dur * 0.5, color: "low" });
  },
  dark: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur * 0.95, freq: 165, wave: "square", gain: 0.3, releaseMs: dur * 0.75 });
    addTone(buf, { startMs: 0, durMs: dur * 0.95, freq: 110, wave: "saw", gain: 0.22, releaseMs: dur * 0.75 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.5, gain: 0.24, attackMs: 2, releaseMs: dur * 0.4, color: "low" });
  },
  steel: (buf, dur) => {
    addNoise(buf, { startMs: 0, durMs: dur * 0.25, gain: 0.5, attackMs: 1, releaseMs: dur * 0.22, color: "high" });
    addTone(buf, { startMs: 0, durMs: dur * 0.85, freq: 440, wave: "square", gain: 0.3, releaseMs: dur * 0.7 });
    addTone(buf, { startMs: 0, durMs: dur * 0.6, freq: 880, wave: "sine", gain: 0.16, releaseMs: dur * 0.5 });
    addTone(buf, { startMs: 0, durMs: dur * 0.6, freq: 1320, wave: "sine", gain: 0.1, releaseMs: dur * 0.5 });
  },
  fairy: (buf, dur) => {
    addTone(buf, { startMs: 0, durMs: dur * 0.9, freq: 880, wave: "sine", gain: 0.28, attackMs: 4, releaseMs: dur * 0.7 });
    addTone(buf, { startMs: 30, durMs: dur * 0.85, freq: 1320, wave: "sine", gain: 0.2, attackMs: 4, releaseMs: dur * 0.65 });
    addTone(buf, { startMs: 60, durMs: dur * 0.8, freq: 1760, wave: "sine", gain: 0.12, attackMs: 4, releaseMs: dur * 0.6 });
    addNoise(buf, { startMs: 0, durMs: dur * 0.2, gain: 0.1, attackMs: 1, releaseMs: dur * 0.18, color: "high" });
  },
};

function synthTypeImpact(type, critical) {
  const dur = critical ? 380 : 280;
  const buf = makeBuffer(dur);
  const [low, high] = supportFreqPairs[type];
  typeImpactRecipes[type](buf, dur);
  addChipArp(buf, {
    startMs: critical ? 26 : 18,
    notes: critical ? [high * 2, high * 2.5, high * 3, low * 3] : [high, high * 1.5, low * 2],
    stepMs: critical ? 26 : 30,
    durMs: critical ? 58 : 50,
    gain: critical ? 0.14 : 0.09,
  });
  if (critical) {
    addNoise(buf, { startMs: 0, durMs: dur * 0.4, gain: 0.32, attackMs: 1, releaseMs: dur * 0.32, color: "mid" });
    addTone(buf, { startMs: 0, durMs: dur * 0.85, freq: 90, freqEnd: 45, wave: "saw", gain: 0.3, releaseMs: dur * 0.7 });
    addTone(buf, { startMs: dur * 0.45, durMs: dur * 0.45, freq: 220, freqEnd: 110, wave: "square", gain: 0.16, releaseMs: dur * 0.35 });
    addEcho(buf, 64, 0.4, 0.26);
  }
  applySaturation(buf, critical ? 1.85 : 1.45);
  applyBitcrush(buf, critical ? 48 : 60, critical ? 2 : 3);
  return bufferToSamples(buf);
}

const supportFreqPairs = {
  normal: [262, 392], fire: [330, 494], water: [247, 370], grass: [294, 440],
  electric: [392, 587], poison: [220, 330], ground: [165, 247], flying: [440, 659],
  bug: [277, 415], fighting: [196, 294], psychic: [370, 554], rock: [175, 262],
  ghost: [233, 350], ice: [523, 784], dragon: [220, 330], dark: [196, 294],
  steel: [311, 466], fairy: [587, 880],
};

function synthTypeSupport(type) {
  const [low, high] = supportFreqPairs[type];
  const dur = 460;
  const buf = makeBuffer(dur);
  addTone(buf, { startMs: 0, durMs: dur, freq: low, wave: "sine", gain: 0.22, attackMs: 60, releaseMs: 220 });
  addTone(buf, { startMs: 70, durMs: dur - 70, freq: high, wave: "sine", gain: 0.18, attackMs: 60, releaseMs: 220 });
  addTone(buf, { startMs: 140, durMs: dur - 140, freq: high * 1.5, wave: "triangle", gain: 0.08, attackMs: 60, releaseMs: 220 });
  addChipArp(buf, {
    startMs: 34,
    notes: [low * 2, high * 2, high * 2.5],
    stepMs: 58,
    durMs: 96,
    gain: 0.07,
    wave: "triangle",
  });
  addEcho(buf, 110, 0.32, 0.22);
  applyBitcrush(buf, 72, 2);
  return bufferToSamples(buf);
}

function loopSamples(notes) {
  const samples = [];
  for (const frequency of notes) {
    const length = Math.floor(audioSampleRate * 0.18);
    for (let index = 0; index < length; index += 1) {
      const envelope = 0.55 + 0.45 * Math.sin((Math.PI * index) / length);
      const tone = Math.sin((Math.PI * 2 * frequency * index) / audioSampleRate);
      const harmony = Math.sin((Math.PI * 2 * (frequency / 2) * index) / audioSampleRate);
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

if (battleSfxOnly) {
  await generateBattleAudio();
} else {
  await generateAudio();
}
