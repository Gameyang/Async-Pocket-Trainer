import { afterEach, describe, expect, it, vi } from "vitest";

import type { FrameVisualCue } from "../../game/view/frame";
import { AudioMixer, resolveCueSoundKeys, resolveSfxLayer, resolveSfxVolume } from "./audioMixer";

describe("AudioMixer helpers", () => {
  it("keeps primary, supplemental, and cry sounds in the same cue bundle", () => {
    const cue = {
      soundKey: "sfx.capture.success",
      soundKeys: ["sfx.battle.hit"],
      cryKey: "sfx.cry.pikachu",
    } as unknown as FrameVisualCue;

    expect(resolveCueSoundKeys(cue)).toEqual([
      "sfx.capture.success",
      "sfx.battle.hit",
      "sfx.cry.pikachu",
    ]);
  });

  it("routes simultaneous SFX into independent mixer layers", () => {
    expect(resolveSfxLayer("sfx.battle.type.fire")).toBe("impact");
    expect(resolveSfxLayer("sfx.creature.faint")).toBe("impact");
    expect(resolveSfxLayer("sfx.cry.pikachu")).toBe("cry");
    expect(resolveSfxLayer("sfx.capture.success")).toBe("ui");
    expect(resolveSfxLayer("sfx.phase.change")).toBe("ui");
  });

  it("keeps per-sound gains near the SFX bus level instead of double-attenuating them", () => {
    expect(resolveSfxVolume("sfx.battle.type.fire")).toBe(1);
    expect(resolveSfxVolume("sfx.capture.success")).toBe(1);
    expect(resolveSfxVolume("sfx.cry.pikachu")).toBeGreaterThanOrEqual(0.9);
    expect(resolveSfxVolume("sfx.phase.change")).toBeGreaterThanOrEqual(0.75);
  });
});

describe("AudioMixer playback scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps background SFX preload behind the first on-demand battle cue", () => {
    vi.useFakeTimers();
    installFakeAudioGlobals();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mixer = new AudioMixer({
      resolveBgmUrl: () => undefined,
      resolveSfxUrl: (soundKey) => (soundKey === "sfx.battle.hit" ? "hit-url" : undefined),
      preloadSfxUrls: () => ["hit-url", "other-url"],
    });

    mixer.unlock();
    expect(fetchMock).not.toHaveBeenCalled();

    mixer.apply({
      bgmKey: "bgm.missing",
      visualCues: [
        {
          id: "cue-1",
          type: "battle.hit",
          sequence: 1,
          soundKey: "sfx.battle.hit",
        } as unknown as FrameVisualCue,
      ],
      battleReplayKey: "battle-1",
      activeReplaySequence: undefined,
      isReplayPlaying: false,
      hasOngoingReplay: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith("hit-url");

    vi.advanceTimersByTime(250);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("other-url");

    mixer.dispose();
  });

  it("preloads upcoming replay cue assets before their sequence becomes active", () => {
    vi.useFakeTimers();
    installFakeAudioGlobals();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mixer = new AudioMixer({
      resolveBgmUrl: () => undefined,
      resolveSfxUrl: (soundKey) => (soundKey === "sfx.battle.hit" ? "hit-url" : undefined),
    });

    mixer.unlock();
    mixer.apply({
      bgmKey: "bgm.missing",
      visualCues: [
        {
          id: "cue-2",
          type: "battle.hit",
          sequence: 2,
          soundKey: "sfx.battle.hit",
        } as unknown as FrameVisualCue,
      ],
      battleReplayKey: "battle-1",
      activeReplaySequence: 1,
      isReplayPlaying: true,
      hasOngoingReplay: true,
    });

    expect(fetchMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith("hit-url");

    mixer.dispose();
  });
});

function installFakeAudioGlobals(): void {
  vi.stubGlobal("window", {
    AudioContext: FakeAudioContext,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

class FakeAudioContext {
  readonly destination = createFakeNode();
  state = "running";
  currentTime = 0;

  createDynamicsCompressor(): DynamicsCompressorNode {
    return {
      ...createFakeNode(),
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    } as unknown as DynamicsCompressorNode;
  }

  createGain(): GainNode {
    return {
      ...createFakeNode(),
      gain: {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
    } as unknown as GainNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    return {
      ...createFakeNode(),
      buffer: null,
      loop: false,
      addEventListener: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as AudioBufferSourceNode;
  }

  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 0.2 } as AudioBuffer);
  }

  addEventListener(): void {
    return undefined;
  }

  removeEventListener(): void {
    return undefined;
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function createFakeNode(): AudioNode {
  return {
    connect: vi.fn((destination) => destination),
    disconnect: vi.fn(),
  } as unknown as AudioNode;
}
