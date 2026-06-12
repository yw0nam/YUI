/**
 * irodori-synth-factory.test.ts — memoized irodori synth + 422 self-heal (TDD red).
 *
 * createIrodoriSynthFactory({ ensureRegistered, buildSynth }) returns a synth(input, signal)
 * that:
 *   - builds + memoizes the createIrodoriSynth closure keyed by baseUrl::referenceId + tunables,
 *     reusing it across sentences while the active speaker/config is unchanged;
 *   - rebuilds when the speaker or a tuning param changes;
 *   - on a 422 from /synthesize, evicts the voice registration, re-registers ONCE, retries ONCE.
 *
 * All collaborators are injected — no network, no main.ts wiring.
 */

import { describe, expect, it, vi } from "vitest";
import { createIrodoriSynthFactory, type IrodoriSynthParams } from "./irodori-synth-factory";

const BASE = "http://localhost:8091";

function baseParams(over: Partial<IrodoriSynthParams> = {}): IrodoriSynthParams {
  return {
    baseUrl: BASE,
    referenceId: "ナツメ",
    refUrl: "/references/ナツメ/merged_audio.mp3",
    ...over,
  };
}

describe("createIrodoriSynthFactory", () => {
  it("builds the synth closure once across multiple sentences with the same speaker", async () => {
    const buildSynth = vi.fn(() => vi.fn(async () => new ArrayBuffer(4)));
    const ensureRegistered = vi.fn(async () => {});
    const evictRegistration = vi.fn();

    const factory = createIrodoriSynthFactory({
      getParams: () => baseParams(),
      ensureRegistered,
      evictRegistration,
      buildSynth,
      fetch: (async () => {}) as unknown as typeof fetch,
    });

    await factory("一。");
    await factory("二。");
    await factory("三。");

    expect(buildSynth).toHaveBeenCalledTimes(1);
    expect(ensureRegistered).toHaveBeenCalledTimes(3);
  });

  it("rebuilds the synth closure when the active speaker changes", async () => {
    const buildSynth = vi.fn(() => vi.fn(async () => new ArrayBuffer(4)));
    let id = "a";
    const factory = createIrodoriSynthFactory({
      getParams: () => baseParams({ referenceId: id, refUrl: `/r/${id}.mp3` }),
      ensureRegistered: async () => {},
      evictRegistration: () => {},
      buildSynth,
      fetch: (async () => {}) as unknown as typeof fetch,
    });

    await factory("x");
    id = "b";
    await factory("y");

    expect(buildSynth).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the synth closure when a tuning param changes", async () => {
    const buildSynth = vi.fn(() => vi.fn(async () => new ArrayBuffer(4)));
    let steps = 16;
    const factory = createIrodoriSynthFactory({
      getParams: () => baseParams({ numSteps: steps }),
      ensureRegistered: async () => {},
      evictRegistration: () => {},
      buildSynth,
      fetch: (async () => {}) as unknown as typeof fetch,
    });

    await factory("x");
    steps = 32;
    await factory("y");

    expect(buildSynth).toHaveBeenCalledTimes(2);
  });

  it("on 422 evicts registration, re-registers once, and retries the synth once", async () => {
    let synthCalls = 0;
    const inner = vi.fn(async () => {
      synthCalls += 1;
      if (synthCalls === 1) {
        const err = new Error(
          "irodori synthesize failed (HTTP 422): unknown reference_id",
        ) as Error & {
          status?: number;
        };
        err.status = 422;
        throw err;
      }
      return new ArrayBuffer(8);
    });
    const buildSynth = vi.fn(() => inner);
    const ensureRegistered = vi.fn(async () => {});
    const evictRegistration = vi.fn();

    const factory = createIrodoriSynthFactory({
      getParams: () => baseParams(),
      ensureRegistered,
      evictRegistration,
      buildSynth,
      fetch: (async () => {}) as unknown as typeof fetch,
    });

    const out = await factory("hi");
    expect(out).toBeInstanceOf(ArrayBuffer);
    expect(evictRegistration).toHaveBeenCalledTimes(1);
    expect(evictRegistration).toHaveBeenCalledWith(BASE, "ナツメ");
    // initial ensureRegistered + one re-register on self-heal.
    expect(ensureRegistered).toHaveBeenCalledTimes(2);
    expect(synthCalls).toBe(2);
  });

  it("does not self-heal more than once (a persistent 422 surfaces)", async () => {
    const inner = vi.fn(async () => {
      const err = new Error("HTTP 422") as Error & { status?: number };
      err.status = 422;
      throw err;
    });
    const buildSynth = vi.fn(() => inner);
    const evictRegistration = vi.fn();

    const factory = createIrodoriSynthFactory({
      getParams: () => baseParams(),
      ensureRegistered: async () => {},
      evictRegistration,
      buildSynth,
      fetch: (async () => {}) as unknown as typeof fetch,
    });

    await expect(factory("hi")).rejects.toThrow(/422/);
    // exactly one evict → one retry; inner called twice total, no infinite loop.
    expect(evictRegistration).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("does not self-heal on non-422 errors", async () => {
    const inner = vi.fn(async () => {
      const err = new Error("HTTP 500") as Error & { status?: number };
      err.status = 500;
      throw err;
    });
    const evictRegistration = vi.fn();

    const factory = createIrodoriSynthFactory({
      getParams: () => baseParams(),
      ensureRegistered: async () => {},
      evictRegistration,
      buildSynth: () => inner,
      fetch: (async () => {}) as unknown as typeof fetch,
    });

    await expect(factory("hi")).rejects.toThrow(/500/);
    expect(evictRegistration).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
