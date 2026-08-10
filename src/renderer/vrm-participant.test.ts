/**
 * vrm-participant.test.ts
 *
 * Pins the orchestration animate()/loadVRM/disposeCurrent/the frame gate share: a
 * fixed-order array of VrmParticipant, notified/stepped via one loop per site. Pure
 * (no DOM/GL) so it's testable with stub participants standing in for
 * pins/gaze/emotion/mouth.
 */

import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import {
  anyConverging,
  disposeParticipants,
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
    const a: VrmParticipant = { step: vi.fn((c) => { order.push("a"); expect(c).toBe(ctx); }) };
    const b: VrmParticipant = { step: vi.fn((c) => { order.push("b"); expect(c).toBe(ctx); }) };
    const c: VrmParticipant = { step: vi.fn((c2) => { order.push("c"); expect(c2).toBe(ctx); }) };

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

describe("disposeParticipants", () => {
  it("calls dispose on every participant that has it, in order", () => {
    const order: string[] = [];
    const a: VrmParticipant = { step: vi.fn(), dispose: () => order.push("a") };
    const b: VrmParticipant = { step: vi.fn() };
    const c: VrmParticipant = { step: vi.fn(), dispose: () => order.push("c") };

    disposeParticipants([a, b, c]);

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
