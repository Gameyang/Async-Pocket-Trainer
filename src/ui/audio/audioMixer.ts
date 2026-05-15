import type { FrameVisualCue } from "../../game/view/frame.ts";

// Centralised audio playback for BGM and SFX.
//
// Why this lives in its own module: the previous in-renderer playback path had no recovery from
// AudioContext interruption, no defence against in-flight buffer loads being orphaned by phase
// transitions, and cue dedup state was easy to mix up with the render loop. Here the mixer owns
// AudioContext lifecycle, buffer cache, cue dedup, BGM swap sequencing, and ducking — the
// renderer just calls `unlock()` once and `apply()` per frame.

const MASTER_GAIN = 0.85;
const BGM_BASE_GAIN = 0.4;
const BGM_DUCKED_GAIN = 0.2;
const SFX_BASE_GAIN = 0.6;
const SFX_TOTAL_VOICE_LIMIT = 56;
const BGM_DUCK_ATTACK_SEC = 0.04;
const BGM_DUCK_RELEASE_SEC = 0.25;

export type SfxLayer = "impact" | "cry" | "ui";

const SFX_LAYER_CONFIG: Record<
  SfxLayer,
  {
    gain: number;
    priority: number;
    voiceLimit: number;
  }
> = {
  impact: { gain: 1.0, priority: 3, voiceLimit: 32 },
  cry: { gain: 0.95, priority: 2, voiceLimit: 20 },
  ui: { gain: 0.9, priority: 1, voiceLimit: 10 },
};

export interface AudioMixerFrame {
  bgmKey: string;
  visualCues: readonly FrameVisualCue[];
  battleReplayKey: string;
  activeReplaySequence: number | undefined;
  isReplayPlaying: boolean;
  hasOngoingReplay: boolean;
}

export interface AudioMixerOptions {
  resolveSfxUrl: (soundKey: string) => string | undefined;
  resolveBgmUrl: (bgmKey: string) => string | undefined;
  preloadSfxUrls?: () => readonly string[];
  warn?: (message: string, error?: unknown) => void;
}

interface BgmSlot {
  key: string;
  loadSeq: number;
  source?: AudioBufferSourceNode;
}

interface SfxVoice {
  source: AudioBufferSourceNode;
  layer: SfxLayer;
  priority: number;
  startedAt: number;
}

export class AudioMixer {
  private readonly options: AudioMixerOptions;
  private unlocked = false;
  private lifecycleHidden = false;
  private ctx?: AudioContext;
  private masterGain?: GainNode;
  private bgmGain?: GainNode;
  private sfxGain?: GainNode;
  private sfxLayerGains?: Record<SfxLayer, GainNode>;
  private compressor?: DynamicsCompressorNode;
  private bgm?: BgmSlot;
  private bgmLoadCounter = 0;
  private activeSfxVoices: SfxVoice[] = [];
  private bufferCache = new Map<string, Promise<AudioBuffer | undefined>>();
  private playedCueIds = new Set<string>();
  private lastReplayKey = "";
  private didPreloadSfx = false;
  private listenerCleanup: Array<() => void> = [];

  constructor(options: AudioMixerOptions) {
    this.options = options;
    this.installLifecycleListeners();
  }

  unlock(): void {
    this.unlocked = true;
    if (!this.ensureGraph()) {
      return;
    }
    this.preloadSfx();
    void this.ctx?.resume().catch(() => undefined);
  }

  apply(frame: AudioMixerFrame): void {
    if (!this.unlocked || this.lifecycleHidden) {
      this.pause();
      return;
    }

    if (!this.ensureGraph()) {
      return;
    }

    const ctx = this.ctx;
    if (!ctx) {
      return;
    }

    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }

    if (frame.battleReplayKey !== this.lastReplayKey) {
      this.playedCueIds.clear();
      this.lastReplayKey = frame.battleReplayKey;
    }

    this.setBgm(frame.bgmKey);

    const cues = frame.visualCues.filter((cue) => this.shouldPlayCue(cue, frame));
    for (const cue of cues) {
      const soundKeys = resolveCueSoundKeys(cue);
      if (this.playedCueIds.has(cue.id)) {
        continue;
      }
      if (soundKeys.length === 0) {
        continue;
      }
      this.playedCueIds.add(cue.id);
      const cueStartTime = ctx.currentTime;
      for (const soundKey of soundKeys) {
        this.playSfx(soundKey, cueStartTime);
      }
    }
  }

  pause(): void {
    if (this.ctx?.state === "running") {
      void this.ctx.suspend().catch(() => undefined);
    }
  }

  dispose(): void {
    for (const cleanup of this.listenerCleanup) {
      cleanup();
    }
    this.listenerCleanup.length = 0;

    if (this.bgm?.source) {
      try {
        this.bgm.source.stop();
      } catch {
        // already stopped
      }
    }
    this.bgm = undefined;

    for (const voice of this.activeSfxVoices) {
      this.stopSfxVoice(voice);
    }
    this.activeSfxVoices.length = 0;
    this.playedCueIds.clear();

    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = undefined;
    }
    this.compressor?.disconnect();
    this.masterGain?.disconnect();
    this.bgmGain?.disconnect();
    this.sfxGain?.disconnect();
    if (this.sfxLayerGains) {
      for (const gain of Object.values(this.sfxLayerGains)) {
        gain.disconnect();
      }
    }
    this.compressor = undefined;
    this.masterGain = undefined;
    this.bgmGain = undefined;
    this.sfxGain = undefined;
    this.sfxLayerGains = undefined;
  }

  // === internals ===

  private ensureGraph(): boolean {
    if (this.ctx) {
      return true;
    }

    if (typeof window === "undefined") {
      return false;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return false;
    }

    const ctx = new Ctor();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 8;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.12;

    const masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_GAIN;
    const bgmGain = ctx.createGain();
    bgmGain.gain.value = BGM_BASE_GAIN;
    const sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_BASE_GAIN;
    const sfxLayerGains = {
      impact: ctx.createGain(),
      cry: ctx.createGain(),
      ui: ctx.createGain(),
    } satisfies Record<SfxLayer, GainNode>;
    for (const [layer, gain] of Object.entries(sfxLayerGains) as Array<[SfxLayer, GainNode]>) {
      gain.gain.value = SFX_LAYER_CONFIG[layer].gain;
      gain.connect(sfxGain);
    }

    bgmGain.connect(masterGain);
    sfxGain.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);

    const onStateChange = () => {
      // iOS Safari may transition the context to "interrupted" when a phone call or other
      // foreground audio steals output. Once we get focus back, resume so BGM and SFX recover.
      if (this.unlocked && !this.lifecycleHidden && ctx.state === "suspended") {
        void ctx.resume().catch(() => undefined);
      }
    };
    ctx.addEventListener("statechange", onStateChange);
    this.listenerCleanup.push(() => ctx.removeEventListener("statechange", onStateChange));

    this.ctx = ctx;
    this.compressor = compressor;
    this.masterGain = masterGain;
    this.bgmGain = bgmGain;
    this.sfxGain = sfxGain;
    this.sfxLayerGains = sfxLayerGains;
    return true;
  }

  private preloadSfx(): void {
    if (this.didPreloadSfx || !this.ctx) {
      return;
    }

    this.didPreloadSfx = true;
    for (const url of this.options.preloadSfxUrls?.() ?? []) {
      if (url) {
        void this.loadBuffer(url);
      }
    }
  }

  private installLifecycleListeners(): void {
    if (typeof document === "undefined") {
      return;
    }

    const updateVisibility = () => {
      const hidden = document.hidden || document.visibilityState === "hidden";
      this.lifecycleHidden = hidden;
      if (hidden) {
        this.pause();
      } else if (this.unlocked && this.ctx?.state === "suspended") {
        void this.ctx.resume().catch(() => undefined);
      }
    };

    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("pagehide", updateVisibility);
    window.addEventListener("pageshow", updateVisibility);
    window.addEventListener("freeze", updateVisibility);
    window.addEventListener("resume", updateVisibility);
    this.listenerCleanup.push(() => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("pagehide", updateVisibility);
      window.removeEventListener("pageshow", updateVisibility);
      window.removeEventListener("freeze", updateVisibility);
      window.removeEventListener("resume", updateVisibility);
    });

    // Seed initial state.
    updateVisibility();
  }

  private setBgm(key: string): void {
    if (this.bgm?.key === key && this.bgm.source) {
      return;
    }

    // Any in-flight load for a previous key becomes stale once we bump the counter.
    this.bgmLoadCounter += 1;
    const seq = this.bgmLoadCounter;

    if (this.bgm?.source) {
      try {
        this.bgm.source.stop();
      } catch {
        // already stopped
      }
    }
    this.bgm = { key, loadSeq: seq };

    const url = this.options.resolveBgmUrl(key);
    if (!url) {
      this.options.warn?.(`bgm url missing for key ${key}`);
      return;
    }

    void this.loadBuffer(url).then((buffer) => {
      if (!buffer || !this.ctx || !this.bgmGain) {
        return;
      }
      // Discard the result if the user moved on to another key while we were loading,
      // or if another invocation already attached a source for this seq.
      if (!this.bgm || this.bgm.loadSeq !== seq || this.bgm.source) {
        return;
      }

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.bgmGain);

      source.addEventListener("ended", () => {
        // A looping source should not "end" — when it does, the browser dropped the loop (iOS
        // sometimes does this after an interruption). Restart for the same key if we're still
        // supposed to be playing it.
        if (this.bgm?.source !== source) {
          return;
        }
        const currentKey = this.bgm.key;
        this.bgm.source = undefined;
        if (this.unlocked && !this.lifecycleHidden) {
          this.setBgm(currentKey);
        }
      });

      try {
        source.start();
        this.bgm.source = source;
      } catch (error) {
        this.options.warn?.(`bgm start failed for ${key}`, error);
        this.bgm.source = undefined;
      }
    });
  }

  private playSfx(soundKey: string, requestedAt: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.sfxLayerGains) {
      return;
    }

    const url = this.options.resolveSfxUrl(soundKey);
    if (!url) {
      this.options.warn?.(`missing sfx asset for ${soundKey}`);
      return;
    }

    const volume = resolveSfxVolume(soundKey);
    const layer = resolveSfxLayer(soundKey);
    const shouldDuck = soundKey !== "sfx.phase.change";

    void this.loadBuffer(url).then((buffer) => {
      if (!buffer || !this.ctx || !this.sfxLayerGains) {
        return;
      }
      if (this.lifecycleHidden || !this.unlocked) {
        return;
      }

      this.reserveSfxVoice(layer);

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(this.sfxLayerGains[layer]);
      const startedAt = Math.max(
        this.ctx.currentTime,
        requestedAt + resolveSfxStartOffset(soundKey),
      );
      const voice: SfxVoice = {
        source,
        layer,
        priority: SFX_LAYER_CONFIG[layer].priority,
        startedAt,
      };
      source.addEventListener("ended", () => {
        this.releaseSfxVoice(voice);
      });
      this.activeSfxVoices.push(voice);

      if (shouldDuck) {
        this.duckBgm(buffer.duration);
      }

      try {
        source.start(startedAt);
      } catch (error) {
        this.options.warn?.(`sfx start failed for ${soundKey}`, error);
        this.releaseSfxVoice(voice);
      }
    });
  }

  private reserveSfxVoice(layer: SfxLayer): void {
    const layerLimit = SFX_LAYER_CONFIG[layer].voiceLimit;
    while (this.activeSfxVoices.filter((voice) => voice.layer === layer).length >= layerLimit) {
      const oldestLayerVoice = this.activeSfxVoices
        .filter((voice) => voice.layer === layer)
        .sort((left, right) => left.startedAt - right.startedAt)[0];
      if (!oldestLayerVoice) {
        break;
      }
      this.stopSfxVoice(oldestLayerVoice);
      this.releaseSfxVoice(oldestLayerVoice);
    }

    while (this.activeSfxVoices.length >= SFX_TOTAL_VOICE_LIMIT) {
      const lowestPriorityVoice = this.activeSfxVoices
        .slice()
        .sort((left, right) => left.priority - right.priority || left.startedAt - right.startedAt)[0];
      if (!lowestPriorityVoice) {
        break;
      }
      this.stopSfxVoice(lowestPriorityVoice);
      this.releaseSfxVoice(lowestPriorityVoice);
    }
  }

  private releaseSfxVoice(voice: SfxVoice): void {
    const index = this.activeSfxVoices.indexOf(voice);
    if (index >= 0) {
      this.activeSfxVoices.splice(index, 1);
    }
  }

  private stopSfxVoice(voice: SfxVoice): void {
    try {
      voice.source.stop();
    } catch {
      // already stopped
    }
  }

  private duckBgm(sfxDurationSec: number): void {
    if (!this.ctx || !this.bgmGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const hold = Math.max(0.15, Math.min(sfxDurationSec, 0.9));
    const gain = this.bgmGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(BGM_DUCKED_GAIN, now + BGM_DUCK_ATTACK_SEC);
    gain.setValueAtTime(BGM_DUCKED_GAIN, now + BGM_DUCK_ATTACK_SEC + hold);
    gain.linearRampToValueAtTime(
      BGM_BASE_GAIN,
      now + BGM_DUCK_ATTACK_SEC + hold + BGM_DUCK_RELEASE_SEC,
    );
  }

  private loadBuffer(url: string): Promise<AudioBuffer | undefined> {
    const cached = this.bufferCache.get(url);
    if (cached) {
      return cached;
    }

    const ctx = this.ctx;
    if (!ctx) {
      return Promise.resolve(undefined);
    }

    const promise = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer))
      .catch((error) => {
        this.options.warn?.(`buffer load failed for ${url}`, error);
        // Drop the cached rejection so a later play can retry the fetch.
        this.bufferCache.delete(url);
        return undefined;
      });

    this.bufferCache.set(url, promise);
    return promise;
  }

  private shouldPlayCue(cue: FrameVisualCue, frame: AudioMixerFrame): boolean {
    if (frame.isReplayPlaying) {
      return isBattleSfxCue(cue) && cue.sequence === frame.activeReplaySequence;
    }
    if (frame.hasOngoingReplay && isBattleSfxCue(cue)) {
      return false;
    }
    return true;
  }
}

function isBattleSfxCue(cue: FrameVisualCue): boolean {
  return (
    cue.type === "battle.hit" ||
    cue.type === "battle.miss" ||
    cue.type === "battle.support" ||
    cue.type === "creature.faint"
  );
}

export function resolveCueSoundKeys(cue: FrameVisualCue): string[] {
  const supplemental = cue.soundKeys ?? [];
  const keys = [cue.soundKey, ...supplemental];
  if (cue.cryKey && cue.cryKey !== cue.soundKey) {
    keys.push(cue.cryKey);
  }
  return dedupeSoundKeys(keys);
}

function dedupeSoundKeys(keys: string[]): string[] {
  return [...new Set(keys)];
}

export function resolveSfxLayer(soundKey: string): SfxLayer {
  if (soundKey.startsWith("sfx.cry.")) {
    return "cry";
  }
  if (
    soundKey === "sfx.phase.change" ||
    soundKey === "sfx.capture.success" ||
    soundKey === "sfx.capture.fail"
  ) {
    return "ui";
  }
  return "impact";
}

function resolveSfxStartOffset(soundKey: string): number {
  return resolveSfxLayer(soundKey) === "cry" ? 0.025 : 0;
}

export function resolveSfxVolume(soundKey: string): number {
  if (soundKey.startsWith("sfx.cry.")) {
    return 0.9;
  }
  if (soundKey === "sfx.battle.critical.hit") {
    return 1.0;
  }
  if (soundKey.startsWith("sfx.battle.support.")) {
    return 0.9;
  }
  if (soundKey.startsWith("sfx.battle.type.")) {
    return 1.0;
  }
  if (soundKey === "sfx.battle.hit") {
    return 1.0;
  }
  if (soundKey === "sfx.battle.miss") {
    return 0.85;
  }
  if (soundKey === "sfx.creature.faint") {
    return 1.0;
  }
  if (soundKey === "sfx.capture.success" || soundKey === "sfx.capture.fail") {
    return 1.0;
  }
  if (soundKey === "sfx.phase.change") {
    return 0.75;
  }
  return 1.0;
}
