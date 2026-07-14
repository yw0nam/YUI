/**
 * emotion-crossfade.test.ts — stateful VRM emotion application.
 *
 * Pins crossfade timing, retargeting, held weights, and lifecycle behavior
 * against a fake expressionManager and controllable clock.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VRM } from "@pixiv/three-vrm";
import { describe, expect, it, vi } from "vitest";
import type { EmotionRegistry } from "../contract";
import { createEmotionCrossfade } from "./emotion-crossfade";

const realRegistry: EmotionRegistry = JSON.parse(
  readFileSync(resolve(process.cwd(), "configs/emotion_registry.json"), "utf-8"),
);

function createFixture(registry: EmotionRegistry | null = realRegistry) {
  let elapsedMs = 0;
  const setValue = vi.fn<(key: string, weight: number) => void>();
  const expressionManager = {
    setValue,
    getExpression: (_key: string) => ({}),
  };
  const vrm = { expressionManager } as unknown as VRM;
  const log = { warn: vi.fn(), error: vi.fn() };
  const crossfade = createEmotionCrossfade({
    getVrm: () => vrm,
    getElapsedMs: () => elapsedMs,
    registry: registry ?? undefined,
    log,
  });
  crossfade.onVrmLoaded();

  return {
    crossfade,
    log,
    setTime(value: number) {
      elapsedMs = value;
    },
    setValue,
  };
}

function lastWeight(setValue: ReturnType<typeof vi.fn>, key: string): number | undefined {
  const calls = setValue.mock.calls.filter(([calledKey]) => calledKey === key);
  return calls.at(-1)?.[1] as number | undefined;
}

describe("createEmotionCrossfade — setup and lifecycle", () => {
  it("treats null emotion as a no-op", () => {
    const { crossfade, setValue } = createFixture();

    crossfade.setEmotion(null);
    crossfade.step(0.016);

    expect(setValue).not.toHaveBeenCalled();
    expect(crossfade.isFading()).toBe(false);
  });

  it("warns and does nothing when no registry is available", () => {
    const { crossfade, log, setValue } = createFixture(null);

    crossfade.setEmotion({ id: "happy" });
    crossfade.step(0.016);

    expect(log.warn).toHaveBeenCalledWith("set_emotion_no_registry");
    expect(setValue).not.toHaveBeenCalled();
    expect(crossfade.isFading()).toBe(false);
  });

  it("reset clears an in-flight fade and makes step a no-op", () => {
    const { crossfade, setValue } = createFixture();
    crossfade.setEmotion({ id: "happy" });
    expect(crossfade.isFading()).toBe(true);

    crossfade.reset();
    crossfade.step(0.016);

    expect(crossfade.isFading()).toBe(false);
    expect(setValue).not.toHaveBeenCalled();
  });
});

describe("createEmotionCrossfade — timing and held target", () => {
  it("lerps from zero to the resolved intensity over the transition", () => {
    const { crossfade, setTime, setValue } = createFixture();
    crossfade.setEmotion({ id: "happy", intensity: 0.8, transition_ms: 200 });

    crossfade.step(0.016);
    expect(lastWeight(setValue, "happy")).toBeCloseTo(0);
    expect(crossfade.isFading()).toBe(true);

    setTime(100);
    crossfade.step(0.016);
    expect(lastWeight(setValue, "happy")).toBeCloseTo(0.4);

    setTime(200);
    crossfade.step(0.016);
    expect(lastWeight(setValue, "happy")).toBeCloseTo(0.8);
  });

  it("keeps reapplying the completed target and stops writing the previous key", () => {
    const { crossfade, setTime, setValue } = createFixture();
    crossfade.setEmotion({ id: "happy", transition_ms: 100 });
    setTime(100);
    crossfade.step(0.016);

    crossfade.setEmotion({ id: "sad", transition_ms: 100 });
    setTime(200);
    crossfade.step(0.016);
    const previousZeroCalls = setValue.mock.calls.filter(
      ([key, weight]) => key === "happy" && weight === 0,
    );
    expect(previousZeroCalls).toHaveLength(2);

    setValue.mockClear();
    setTime(300);
    crossfade.step(0.016);

    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue).toHaveBeenCalledWith("sad", 1);
    expect(crossfade.isFading()).toBe(true);
  });
});

describe("createEmotionCrossfade — retargeting", () => {
  it("uses the current blended target as the previous weight for a different key", () => {
    const { crossfade, setTime, setValue } = createFixture();
    crossfade.setEmotion({ id: "happy", transition_ms: 100 });
    setTime(40);
    crossfade.step(0.016);
    expect(lastWeight(setValue, "happy")).toBeCloseTo(0.4);

    crossfade.setEmotion({ id: "sad", transition_ms: 100 });
    crossfade.step(0.016);
    expect(lastWeight(setValue, "sad")).toBeCloseTo(0);
    expect(lastWeight(setValue, "happy")).toBeCloseTo(0.4);

    setTime(90);
    crossfade.step(0.016);
    expect(lastWeight(setValue, "sad")).toBeCloseTo(0.5);
    expect(lastWeight(setValue, "happy")).toBeCloseTo(0.2);
  });

  it("continues the previous fade when retargeting the same key", () => {
    const { crossfade, setTime, setValue } = createFixture();
    crossfade.setEmotion({ id: "happy", transition_ms: 100 });
    setTime(40);
    crossfade.step(0.016);
    crossfade.setEmotion({ id: "sad", transition_ms: 100 });
    setTime(60);
    crossfade.step(0.016);
    expect(lastWeight(setValue, "sad")).toBeCloseTo(0.2);
    expect(lastWeight(setValue, "happy")).toBeCloseTo(0.32);

    crossfade.setEmotion({ id: "sad", intensity: 0.6, transition_ms: 100 });
    crossfade.step(0.016);
    expect(lastWeight(setValue, "sad")).toBeCloseTo(0.2);
    expect(lastWeight(setValue, "happy")).toBeCloseTo(0.32);

    setTime(110);
    crossfade.step(0.016);
    expect(lastWeight(setValue, "sad")).toBeCloseTo(0.4);
    expect(lastWeight(setValue, "happy")).toBeCloseTo(0.16);
  });
});
