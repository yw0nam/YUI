/**
 * audio-player.test.ts — TDD red for amplitude → mouth-open envelope (#15, PRD D1).
 *
 * Two things are pinned here:
 *
 * 1. createAmplitudeEnvelope — the pure normalize/scale/smooth stage that turns a
 *    raw per-frame RMS (≈0..1, but quiet speech sits well below 1) into a 0..1
 *    mouth-open value with light smoothing. This is what feeds the renderer's
 *    setMouthOpen; it must clamp, scale quiet audio up sensibly, and ease.
 *
 * 2. createWebAudioSink().play(wav, onAmplitude) — the amplitude callback fires
 *    with finite 0..1 values DURING playback, and the sink stops cleanly. Driven
 *    with a fake AudioContext/AnalyserNode (no real audio device).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAmplitudeEnvelope, createWebAudioSink } from "./audio-player";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pure envelope: raw RMS → 0..1 mouth value
// ─────────────────────────────────────────────────────────────────────────────

describe("createAmplitudeEnvelope — normalize + clamp", () => {
  it("silence (rms 0) yields 0", () => {
    const env = createAmplitudeEnvelope({ smoothing: 1 });
    expect(env.push(0)).toBe(0);
  });

  it("output is always within [0,1] even for an over-driven rms", () => {
    const env = createAmplitudeEnvelope({ smoothing: 1 });
    for (const rms of [0, 0.01, 0.2, 0.5, 1, 2, 50]) {
      const v = env.push(rms);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("loud audio maps near the top of the range", () => {
    const env = createAmplitudeEnvelope({ smoothing: 1 });
    expect(env.push(1)).toBeGreaterThan(0.8);
  });

  it("is monotonic in the raw rms (louder in → not quieter out)", () => {
    const env = createAmplitudeEnvelope({ smoothing: 1 });
    const a = env.push(0.1);
    const b = env.push(0.3);
    const c = env.push(0.6);
    expect(b).toBeGreaterThanOrEqual(a);
    expect(c).toBeGreaterThanOrEqual(b);
  });
});

describe("createAmplitudeEnvelope — smoothing", () => {
  it("does not jump straight to the mapped value when smoothing < 1", () => {
    const env = createAmplitudeEnvelope({ smoothing: 0.3 });
    const first = env.push(1); // from rest (0) toward a high target
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.9); // eased, not snapped
  });

  it("converges toward the mapped value over repeated identical input", () => {
    const env = createAmplitudeEnvelope({ smoothing: 0.3 });
    let v = 0;
    for (let i = 0; i < 40; i++) v = env.push(1);
    expect(v).toBeGreaterThan(0.9);
  });

  it("reset() returns the smoothed value to 0", () => {
    const env = createAmplitudeEnvelope({ smoothing: 0.3 });
    for (let i = 0; i < 40; i++) env.push(1);
    env.reset();
    // after reset, a single quiet sample stays near 0 (no residual energy)
    const v = env.push(0);
    expect(v).toBeLessThan(0.1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Sink: amplitude callback fires during playback (fake Web Audio)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal AnalyserNode fake: getByteTimeDomainData fills a loud-ish waveform. */
class FakeAnalyser {
  fftSize = 256;
  connect = vi.fn();
  getByteTimeDomainData(arr: Uint8Array): void {
    // a ±64 square around the 128 midpoint → non-zero RMS
    for (let i = 0; i < arr.length; i++) arr[i] = i % 2 === 0 ? 192 : 64;
  }
}

class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn(() => {
    // emulate a clip that ends on the next macrotask
    setTimeout(() => this.onended?.(), 0);
  });
  stop = vi.fn(() => {
    this.onended?.();
  });
}

class FakeAudioContext {
  destination = {};
  createBufferSource() {
    return new FakeBufferSource();
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  async decodeAudioData(_buf: ArrayBuffer) {
    return { duration: 0.1 } as unknown;
  }
}

describe("createWebAudioSink — amplitude callback during playback", () => {
  let rafCbs: FrameRequestCallback[];

  beforeEach(() => {
    rafCbs = [];
    (globalThis as any).AudioContext = FakeAudioContext;
    // deterministic rAF: queue callbacks, drive them manually via flushFrames()
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

  /** Run all currently-queued rAF callbacks once (one synthetic frame). */
  function flushFrames(n: number): void {
    for (let f = 0; f < n; f++) {
      const batch = rafCbs;
      rafCbs = [];
      for (const cb of batch) cb(performance.now?.() ?? 0);
    }
  }

  it("invokes onAmplitude with finite 0..1 values while a clip plays", async () => {
    const sink = createWebAudioSink();
    const samples: number[] = [];
    const wav = new Uint8Array([1, 2, 3, 4]).buffer;

    const playing = sink.play(wav, (v) => samples.push(v));

    // let decodeAudioData resolve + the first frames run
    await Promise.resolve();
    await Promise.resolve();
    flushFrames(5);

    await playing; // clip ends (onended via start's setTimeout) — but we already sampled

    expect(samples.length).toBeGreaterThan(0);
    for (const v of samples) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // a loud waveform should drive the mouth open at least once
    expect(Math.max(...samples)).toBeGreaterThan(0);
  });

  it("stop() halts playback without throwing", async () => {
    const sink = createWebAudioSink();
    const wav = new Uint8Array([1, 2, 3, 4]).buffer;
    const playing = sink.play(wav);
    await Promise.resolve();
    await Promise.resolve();
    expect(() => sink.stop()).not.toThrow();
    await playing;
  });

  it("returns a no-throw no-op sink when AudioContext is unavailable", async () => {
    delete (globalThis as any).AudioContext;
    const sink = createWebAudioSink();
    await expect(sink.play(new Uint8Array([0]).buffer)).resolves.toBeUndefined();
    expect(() => sink.stop()).not.toThrow();
  });
});
