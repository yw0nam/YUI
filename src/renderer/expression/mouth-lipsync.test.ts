/**
 * mouth-lipsync.test.ts — stateful amplitude mouth driver.
 *
 * Pins clamping, smoothing, missing-expression handling, stopping, and the
 * observable applied weight against a fake expressionManager.
 */

import { describe, expect, it, vi } from "vitest";
import { createMouthLipsync } from "./mouth-lipsync";

function createExpressionManager(hasMouth = true) {
  return {
    setValue: vi.fn<(key: string, weight: number) => void>(),
    getExpression: (key: string) => (hasMouth && key === "aa" ? {} : null),
  };
}

describe("createMouthLipsync — target and smoothing", () => {
  it("clamps setOpen to the inclusive unit range", () => {
    const mouth = createMouthLipsync({ smoothing: 1 });
    const em = createExpressionManager();

    mouth.setOpen(2);
    mouth.step(0.016, em);
    expect(em.setValue).toHaveBeenLastCalledWith("aa", 1);

    mouth.setOpen(-1);
    mouth.step(0.016, em);
    expect(em.setValue).toHaveBeenLastCalledWith("aa", 0);
  });

  it("lerps toward the target with the default smoothing factor", () => {
    const mouth = createMouthLipsync();
    const em = createExpressionManager();
    mouth.setOpen(1);

    mouth.step(0.016, em);

    expect(em.setValue).toHaveBeenCalledTimes(1);
    expect(em.setValue).toHaveBeenCalledWith("aa", 0.4);
    expect(mouth.openValue()).toBe(0.4);
  });

  it("no-ops when the model lacks the aa expression", () => {
    const mouth = createMouthLipsync();
    const em = createExpressionManager(false);
    mouth.setOpen(1);

    mouth.step(0.016, em);

    expect(em.setValue).not.toHaveBeenCalled();
    expect(mouth.openValue()).toBe(0);
  });

  it("eases the applied weight closed after stop", () => {
    const mouth = createMouthLipsync();
    const em = createExpressionManager();
    mouth.setOpen(1);
    mouth.step(0.016, em);
    expect(mouth.openValue()).toBe(0.4);

    mouth.stop();
    mouth.step(0.016, em);

    expect(em.setValue).toHaveBeenLastCalledWith("aa", 0.24);
    expect(mouth.openValue()).toBe(0.24);
  });

  it("clamps smoothing above one to snap and below zero to no movement", () => {
    const snap = createMouthLipsync({ smoothing: 5 });
    const snapEm = createExpressionManager();
    snap.setOpen(1);
    snap.step(0.016, snapEm);
    expect(snapEm.setValue).toHaveBeenCalledTimes(1);
    expect(snapEm.setValue).toHaveBeenCalledWith("aa", 1);
    expect(snap.openValue()).toBe(1);

    const still = createMouthLipsync({ smoothing: -1 });
    const stillEm = createExpressionManager();
    still.setOpen(1);
    still.step(0.016, stillEm);
    expect(stillEm.setValue).toHaveBeenCalledTimes(1);
    expect(stillEm.setValue).toHaveBeenCalledWith("aa", 0);
    expect(still.openValue()).toBe(0);
  });
});
