/**
 * vrm-participant.test.ts
 *
 * Pins the orchestration animate()/loadVRM/disposeCurrent/the frame gate share: a
 * fixed-order array of VrmParticipant, notified/stepped via one loop per site. Pure
 * (no DOM/GL) so it's testable with stub participants standing in for
 * pins/gaze/emotion/mouth.
 */

import type { VRM } from "@pixiv/three-vrm";
import type { PerspectiveCamera } from "three";
import { describe, expect, it, vi } from "vitest";
import type { CursorGaze } from "./cursor-gaze";
import type { EmotionCrossfade } from "./emotion-crossfade";
import type { MouthLipsync } from "./mouth-lipsync";
import type { PinController } from "./pin-controller";
import {
  anyConverging,
  buildVrmParticipants,
  notifyVrmDisposed,
  notifyVrmLoaded,
  stepParticipants,
  type VrmParticipant,
} from "./vrm-participant";

const fakeVrm = {} as VRM;
const ctx = { vrm: fakeVrm, dt: 0.016, elapsed: 1.2 };

describe("stepParticipants", () => {
  it("steps every participant, in array order, with the same ctx", () => {
    const order: string[] = [];
    const a: VrmParticipant = {
      step: vi.fn((c) => {
        order.push("a");
        expect(c).toBe(ctx);
      }),
    };
    const b: VrmParticipant = {
      step: vi.fn((c) => {
        order.push("b");
        expect(c).toBe(ctx);
      }),
    };
    const c: VrmParticipant = {
      step: vi.fn((c2) => {
        order.push("c");
        expect(c2).toBe(ctx);
      }),
    };

    stepParticipants([a, b, c], ctx);

    expect(order).toEqual(["a", "b", "c"]);
    expect(a.step).toHaveBeenCalledTimes(1);
    expect(b.step).toHaveBeenCalledTimes(1);
    expect(c.step).toHaveBeenCalledTimes(1);
  });

  it("no-ops on an empty array", () => {
    expect(() => stepParticipants([], ctx)).not.toThrow();
  });
});

describe("notifyVrmLoaded", () => {
  it("calls onVrmLoaded on every participant that has it, in order, skipping those without", () => {
    const order: string[] = [];
    const withHook: VrmParticipant = {
      step: vi.fn(),
      onVrmLoaded: vi.fn((v) => {
        order.push("withHook");
        expect(v).toBe(fakeVrm);
      }),
    };
    const withoutHook: VrmParticipant = { step: vi.fn() };
    const secondWithHook: VrmParticipant = {
      step: vi.fn(),
      onVrmLoaded: vi.fn(() => order.push("secondWithHook")),
    };

    expect(() => notifyVrmLoaded([withHook, withoutHook, secondWithHook], fakeVrm)).not.toThrow();

    expect(order).toEqual(["withHook", "secondWithHook"]);
  });
});

describe("notifyVrmDisposed", () => {
  it("calls onVrmDisposed on every participant that has it, in order", () => {
    const order: string[] = [];
    const a: VrmParticipant = { step: vi.fn(), onVrmDisposed: () => order.push("a") };
    const b: VrmParticipant = { step: vi.fn() };
    const c: VrmParticipant = { step: vi.fn(), onVrmDisposed: () => order.push("c") };

    notifyVrmDisposed([a, b, c]);

    expect(order).toEqual(["a", "c"]);
  });
});

describe("anyConverging", () => {
  it("is false when no participant is converging", () => {
    const a: VrmParticipant = { step: vi.fn(), isConverging: () => false };
    const b: VrmParticipant = { step: vi.fn() }; // no isConverging at all
    expect(anyConverging([a, b])).toBe(false);
  });

  it("is true when any participant reports converging", () => {
    const a: VrmParticipant = { step: vi.fn(), isConverging: () => false };
    const b: VrmParticipant = { step: vi.fn(), isConverging: () => true };
    const c: VrmParticipant = { step: vi.fn(), isConverging: () => false };
    expect(anyConverging([a, b, c])).toBe(true);
  });

  it("is false on an empty array", () => {
    expect(anyConverging([])).toBe(false);
  });
});

describe("buildVrmParticipants", () => {
  function makeDeps() {
    const pins: PinController = {
      onVrmLoaded: vi.fn(),
      onVrmDisposed: vi.fn(),
      hipsBone: vi.fn(() => null),
      setPerchTarget: vi.fn(() => false),
      setPeekTarget: vi.fn(() => false),
      isPerched: vi.fn(() => false),
      isPeeking: vi.fn(() => false),
      isConverging: vi.fn(() => false),
      step: vi.fn(),
    };
    const gaze: CursorGaze = {
      step: vi.fn(),
      onVrmLoaded: vi.fn(),
      onVrmDisposed: vi.fn(),
      isConverging: vi.fn(() => false),
      setConfig: vi.fn(),
      setEnabled: vi.fn(),
      setCursorCss: vi.fn(),
    };
    const emotion: EmotionCrossfade = {
      step: vi.fn(),
      setEmotion: vi.fn(),
      easeToNeutral: vi.fn(),
      setRegistry: vi.fn(),
      onVrmLoaded: vi.fn(),
      reset: vi.fn(),
      isFading: vi.fn(() => false),
    };
    const mouth: MouthLipsync = {
      setOpen: vi.fn(),
      step: vi.fn(),
      stop: vi.fn(),
      openValue: vi.fn(() => 0),
    };
    const camera = {} as PerspectiveCamera;
    return { pins, gaze, emotion, mouth, camera };
  }

  it("orders participants pins, gaze, emotion, mouth — mutation: reversing the array must fail this", () => {
    const deps = makeDeps();
    const order: string[] = [];
    deps.pins.step = vi.fn(() => order.push("pins"));
    deps.gaze.step = vi.fn(() => order.push("gaze"));
    deps.emotion.step = vi.fn(() => order.push("emotion"));
    deps.mouth.step = vi.fn(() => order.push("mouth"));
    // mouth.step only runs when the VRM has an expressionManager — give it one so
    // it actually fires and can be seen in the order.
    const vrmWithExpr = { expressionManager: {} } as unknown as VRM;

    const participants = buildVrmParticipants(deps);
    stepParticipants(participants, { ...ctx, vrm: vrmWithExpr });

    expect(order).toEqual(["pins", "gaze", "emotion", "mouth"]);
  });

  describe("pins participant", () => {
    it("step forwards to pins.step(camera) — the exact camera reference, not ctx", () => {
      const deps = makeDeps();
      const [pinsParticipant] = buildVrmParticipants(deps);
      pinsParticipant.step(ctx);
      expect(deps.pins.step).toHaveBeenCalledTimes(1);
      expect(deps.pins.step).toHaveBeenCalledWith(deps.camera);
    });

    it("onVrmLoaded/onVrmDisposed forward to pins.onVrmLoaded/onVrmDisposed", () => {
      const deps = makeDeps();
      const [pinsParticipant] = buildVrmParticipants(deps);
      pinsParticipant.onVrmLoaded?.(fakeVrm);
      pinsParticipant.onVrmDisposed?.();
      expect(deps.pins.onVrmLoaded).toHaveBeenCalledExactlyOnceWith(fakeVrm);
      expect(deps.pins.onVrmDisposed).toHaveBeenCalledTimes(1);
    });

    it("isConverging forwards pins.isConverging's return value", () => {
      const deps = makeDeps();
      deps.pins.isConverging = vi.fn(() => true);
      const [pinsParticipant] = buildVrmParticipants(deps);
      expect(pinsParticipant.isConverging?.()).toBe(true);
    });
  });

  describe("gaze participant", () => {
    it("step forwards to gaze.step(ctx.dt)", () => {
      const deps = makeDeps();
      const [, gazeParticipant] = buildVrmParticipants(deps);
      gazeParticipant.step(ctx);
      expect(deps.gaze.step).toHaveBeenCalledExactlyOnceWith(ctx.dt);
    });

    it("onVrmLoaded/onVrmDisposed forward to gaze.onVrmLoaded/onVrmDisposed", () => {
      const deps = makeDeps();
      const [, gazeParticipant] = buildVrmParticipants(deps);
      gazeParticipant.onVrmLoaded?.(fakeVrm);
      gazeParticipant.onVrmDisposed?.();
      expect(deps.gaze.onVrmLoaded).toHaveBeenCalledExactlyOnceWith(fakeVrm);
      expect(deps.gaze.onVrmDisposed).toHaveBeenCalledTimes(1);
    });

    it("isConverging forwards gaze.isConverging's return value", () => {
      const deps = makeDeps();
      deps.gaze.isConverging = vi.fn(() => true);
      const [, gazeParticipant] = buildVrmParticipants(deps);
      expect(gazeParticipant.isConverging?.()).toBe(true);
    });
  });

  describe("emotion participant", () => {
    it("step forwards to emotion.step(ctx.dt)", () => {
      const deps = makeDeps();
      const [, , emotionParticipant] = buildVrmParticipants(deps);
      emotionParticipant.step(ctx);
      expect(deps.emotion.step).toHaveBeenCalledExactlyOnceWith(ctx.dt);
    });

    it("onVrmLoaded forwards to emotion.onVrmLoaded (no-arg)", () => {
      const deps = makeDeps();
      const [, , emotionParticipant] = buildVrmParticipants(deps);
      emotionParticipant.onVrmLoaded?.(fakeVrm);
      expect(deps.emotion.onVrmLoaded).toHaveBeenCalledTimes(1);
    });

    it("onVrmDisposed forwards to emotion.reset — not some other method", () => {
      const deps = makeDeps();
      const [, , emotionParticipant] = buildVrmParticipants(deps);
      emotionParticipant.onVrmDisposed?.();
      expect(deps.emotion.reset).toHaveBeenCalledTimes(1);
      expect(deps.emotion.step).not.toHaveBeenCalled();
      expect(deps.emotion.setEmotion).not.toHaveBeenCalled();
    });

    it("isConverging forwards emotion.isFading's return value — mutation: `() => false` must fail this", () => {
      const deps = makeDeps();
      deps.emotion.isFading = vi.fn(() => true);
      const [, , emotionParticipant] = buildVrmParticipants(deps);
      expect(emotionParticipant.isConverging?.()).toBe(true);

      deps.emotion.isFading = vi.fn(() => false);
      const [, , emotionParticipant2] = buildVrmParticipants(deps);
      expect(emotionParticipant2.isConverging?.()).toBe(false);
    });
  });

  describe("mouth participant", () => {
    it("step forwards to mouth.step(ctx.dt, expressionManager) when the VRM has one", () => {
      const deps = makeDeps();
      const expressionManager = {};
      const vrmWithExpr = { expressionManager } as unknown as VRM;
      const [, , , mouthParticipant] = buildVrmParticipants(deps);
      mouthParticipant.step({ vrm: vrmWithExpr, dt: 0.016, elapsed: 1 });
      expect(deps.mouth.step).toHaveBeenCalledExactlyOnceWith(0.016, expressionManager);
    });

    it("step no-ops when the VRM has no expressionManager", () => {
      const deps = makeDeps();
      const [, , , mouthParticipant] = buildVrmParticipants(deps);
      mouthParticipant.step({ vrm: {} as VRM, dt: 0.016, elapsed: 1 });
      expect(deps.mouth.step).not.toHaveBeenCalled();
    });

    it("isConverging is true only once mouth.openValue() clears the active epsilon", () => {
      const deps = makeDeps();
      deps.mouth.openValue = vi.fn(() => 0.3);
      const [, , , mouthParticipant] = buildVrmParticipants(deps);
      expect(mouthParticipant.isConverging?.()).toBe(true);

      deps.mouth.openValue = vi.fn(() => 0.0005);
      const [, , , mouthParticipant2] = buildVrmParticipants(deps);
      expect(mouthParticipant2.isConverging?.()).toBe(false);
    });

    it("has no onVrmLoaded/onVrmDisposed — mouth is untouched by VRM lifecycle", () => {
      const deps = makeDeps();
      const [, , , mouthParticipant] = buildVrmParticipants(deps);
      expect(mouthParticipant.onVrmLoaded).toBeUndefined();
      expect(mouthParticipant.onVrmDisposed).toBeUndefined();
    });
  });
});
