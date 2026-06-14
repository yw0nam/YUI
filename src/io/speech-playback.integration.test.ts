/**
 * speech-playback integration — REAL tts-pipeline + REAL web-audio sink (fake
 * AudioContext), the exact chain main.ts wires. Proves amplitude reaches the
 * renderer mouth and the bubble is released only when the real pipeline drains.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpeechPlayback } from "./speech-playback";

class FakeAnalyser {
  fftSize = 256;
  connect = vi.fn();
  getByteTimeDomainData(arr: Uint8Array): void {
    for (let i = 0; i < arr.length; i++) arr[i] = i % 2 === 0 ? 192 : 64;
  }
}
class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn(() => setTimeout(() => this.onended?.(), 0));
  stop = vi.fn(() => this.onended?.());
}
class FakeAudioContext {
  destination = {};
  createBufferSource() {
    return new FakeBufferSource();
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  async decodeAudioData() {
    return { duration: 0.1 } as unknown;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("speech-playback integration (real pipeline + real sink)", () => {
  let rafCbs: FrameRequestCallback[];

  beforeEach(() => {
    rafCbs = [];
    (globalThis as any).AudioContext = FakeAudioContext;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return rafCbs.length;
    };
    (globalThis as any).cancelAnimationFrame = vi.fn();
  });
  afterEach(() => {
    delete (globalThis as any).AudioContext;
    delete (globalThis as any).requestAnimationFrame;
    delete (globalThis as any).cancelAnimationFrame;
  });

  function flushFrames(n: number): void {
    for (let f = 0; f < n; f++) {
      const batch = rafCbs;
      rafCbs = [];
      for (const cb of batch) cb(0);
    }
  }

  it("drives the mouth from TTS amplitude and releases the bubble on completion", async () => {
    const renderer = {
      setMouthOpen: vi.fn(),
      stopMouth: vi.fn(),
      easeEmotionToNeutral: vi.fn(),
      applyDirective: vi.fn(),
      playMotion: vi.fn(),
    };
    const surfaces = {
      beginSpeech: vi.fn(),
      pushSpeech: vi.fn(),
      endSpeech: vi.fn(),
      finishSpeech: vi.fn(),
    };
    // Real pipeline: a synth that returns a buffer; the real web-audio sink plays it.
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: { synth: async () => new Uint8Array([1, 2, 3, 4]).buffer },
    });

    sp.onSpeech("Hello.");
    expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
    expect(surfaces.finishSpeech).not.toHaveBeenCalled();

    // Drain microtasks (synth resolve → pump → decodeAudioData → source.start)
    // WITHOUT letting the onended macrotask fire, then sample amplitude synchronously.
    for (let i = 0; i < 6; i++) await Promise.resolve();
    flushFrames(4);

    // amplitude reached the mouth with finite 0..1 values, opening it at least once
    expect(renderer.setMouthOpen).toHaveBeenCalled();
    const vals = renderer.setMouthOpen.mock.calls.map((c) => c[0] as number);
    for (const v of vals) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...vals)).toBeGreaterThan(0);

    // clip ends → pipeline drains → onPlaybackEnd → stopMouth + finishSpeech
    await tick();
    await tick();
    expect(renderer.stopMouth).toHaveBeenCalled();
    expect(surfaces.finishSpeech).toHaveBeenCalledTimes(1);

    sp.dispose();
  });
});
