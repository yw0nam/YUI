/**
 * window-resize-source — Ctrl+wheel window resize.
 *
 * Pure bounds math (step factor, aspect-preserving clamp, bottom-center
 * re-anchor) plus the wired wheel handler with injected Tauri window seams.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWindowResizeSource,
  MAX_LOGICAL,
  MIN_LOGICAL,
  nextBounds,
  RESIZE_STEP,
  stepFactor,
} from "./window-resize-source";

describe("stepFactor", () => {
  it("wheel up (negative deltaY) grows, wheel down shrinks", () => {
    expect(stepFactor(-100)).toBeCloseTo(RESIZE_STEP, 9);
    expect(stepFactor(100)).toBeCloseTo(1 / RESIZE_STEP, 9);
  });
});

describe("nextBounds", () => {
  it("scales both dimensions by the factor and anchors the bottom-center", () => {
    const next = nextBounds({ x: 100, y: 100 }, { width: 400, height: 600 }, 1.1);
    expect(next).not.toBeNull();
    expect(next?.size.width).toBeCloseTo(440, 6);
    expect(next?.size.height).toBeCloseTo(660, 6);
    // bottom-center fixed: x shifts left by half the width delta, y up by the full height delta.
    expect(next?.pos.x).toBeCloseTo(100 - 20, 6);
    expect(next?.pos.y).toBeCloseTo(100 - 60, 6);
  });

  it("clamps a large grow factor so both dimensions stay within MAX_LOGICAL", () => {
    const next = nextBounds({ x: 0, y: 0 }, { width: 400, height: 600 }, 1000);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.size.width).toBeLessThanOrEqual(MAX_LOGICAL.width + 1e-6);
    expect(next.size.height).toBeLessThanOrEqual(MAX_LOGICAL.height + 1e-6);
    // aspect preserved: 400:600 = 2:3.
    expect(next.size.width / next.size.height).toBeCloseTo(400 / 600, 6);
  });

  it("returns null (no-op) when already at max and asked to grow", () => {
    const atMax = nextBounds({ x: 0, y: 0 }, { width: 1200, height: 1800 }, 1.5);
    expect(atMax).toBeNull();
  });

  it("returns null (no-op) when already at min and asked to shrink", () => {
    const atMin = nextBounds(
      { x: 0, y: 0 },
      { width: MIN_LOGICAL.width, height: MIN_LOGICAL.height },
      0.5,
    );
    expect(atMin).toBeNull();
  });

  it("returns null for a ~1.0 factor", () => {
    expect(nextBounds({ x: 0, y: 0 }, { width: 400, height: 600 }, 1)).toBeNull();
  });
});

// ── Wired handler ────────────────────────────────────────────────────────────

/** Stateful fake Tauri window: physical bounds + scale, applies setBoundsLogical. */
function makeWindow(
  scale: number,
  posLogical: { x: number; y: number },
  sizeLogical: { width: number; height: number },
) {
  const state = {
    pos: { x: posLogical.x * scale, y: posLogical.y * scale },
    size: { width: sizeLogical.width * scale, height: sizeLogical.height * scale },
  };
  const setBoundsLogical = vi.fn(
    async (pos: { x: number; y: number }, size: { width: number; height: number }) => {
      state.pos = { x: pos.x * scale, y: pos.y * scale };
      state.size = { width: size.width * scale, height: size.height * scale };
    },
  );
  return {
    state,
    setBoundsLogical,
    win: {
      outerPosition: vi.fn(async () => ({ ...state.pos })),
      outerSize: vi.fn(async () => ({ ...state.size })),
      scaleFactor: vi.fn(async () => scale),
      setBoundsLogical,
    },
  };
}

/** Injectable event target capturing the wheel handler. */
function makeTarget() {
  let handler: ((e: WheelEvent) => void) | null = null;
  return {
    target: {
      addEventListener: vi.fn((_type: string, h: EventListener) => {
        handler = h as (e: WheelEvent) => void;
      }),
      removeEventListener: vi.fn(() => {
        handler = null;
      }),
    },
    fire(init: Partial<WheelEvent>): { defaultPrevented: boolean } {
      const e = {
        ctrlKey: false,
        deltaY: 0,
        defaultPrevented: false,
        preventDefault() {
          (this as { defaultPrevented: boolean }).defaultPrevented = true;
        },
        ...init,
      } as unknown as WheelEvent & { defaultPrevented: boolean };
      handler?.(e);
      return e;
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("window-resize-source — wheel handler", () => {
  let renderer: { isPerched: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    renderer = { isPerched: vi.fn(() => false) };
  });

  it("ignores wheel without ctrl (no preventDefault, no resize)", async () => {
    const { win, setBoundsLogical } = makeWindow(1, { x: 0, y: 0 }, { width: 400, height: 600 });
    const { target, fire } = makeTarget();
    const source = createWindowResizeSource({ renderer, getWindow: () => win, target });
    source.start();

    const e = fire({ ctrlKey: false, deltaY: -100 });
    await settle();

    expect(e.defaultPrevented).toBe(false);
    expect(setBoundsLogical).not.toHaveBeenCalled();
  });

  it("ctrl+wheel up grows the window by RESIZE_STEP (DPI-safe: logical bounds)", async () => {
    const { win, setBoundsLogical, state } = makeWindow(
      2,
      { x: 100, y: 100 },
      { width: 400, height: 600 },
    );
    const { target, fire } = makeTarget();
    const source = createWindowResizeSource({ renderer, getWindow: () => win, target });
    source.start();

    const e = fire({ ctrlKey: true, deltaY: -100 });
    await settle();

    expect(e.defaultPrevented).toBe(true);
    expect(setBoundsLogical).toHaveBeenCalledTimes(1);
    // logical size grew by one step; fake state stores physical (×2).
    expect(state.size.width / 2).toBeCloseTo(400 * RESIZE_STEP, 6);
    expect(state.size.height / 2).toBeCloseTo(600 * RESIZE_STEP, 6);
  });

  it("still preventDefaults but does not resize while perched", async () => {
    renderer.isPerched.mockReturnValue(true);
    const { win, setBoundsLogical } = makeWindow(1, { x: 0, y: 0 }, { width: 400, height: 600 });
    const { target, fire } = makeTarget();
    const source = createWindowResizeSource({ renderer, getWindow: () => win, target });
    source.start();

    const e = fire({ ctrlKey: true, deltaY: -100 });
    await settle();

    expect(e.defaultPrevented).toBe(true);
    expect(setBoundsLogical).not.toHaveBeenCalled();
  });

  it("coalesces rapid wheel events — both steps land on the final size", async () => {
    const { win, state } = makeWindow(1, { x: 0, y: 0 }, { width: 400, height: 600 });
    const { target, fire } = makeTarget();
    const source = createWindowResizeSource({ renderer, getWindow: () => win, target });
    source.start();

    fire({ ctrlKey: true, deltaY: -100 });
    fire({ ctrlKey: true, deltaY: -100 });
    await settle();

    expect(state.size.width).toBeCloseTo(400 * RESIZE_STEP * RESIZE_STEP, 4);
    expect(state.size.height).toBeCloseTo(600 * RESIZE_STEP * RESIZE_STEP, 4);
  });

  it("stop() removes the listener and further wheels are inert", async () => {
    const { win, setBoundsLogical } = makeWindow(1, { x: 0, y: 0 }, { width: 400, height: 600 });
    const { target, fire } = makeTarget();
    const source = createWindowResizeSource({ renderer, getWindow: () => win, target });
    source.start();
    source.stop();

    fire({ ctrlKey: true, deltaY: -100 });
    await settle();

    expect(target.removeEventListener).toHaveBeenCalled();
    expect(setBoundsLogical).not.toHaveBeenCalled();
  });

  it("does not throw to the caller when the window seam rejects", async () => {
    const win = {
      outerPosition: vi.fn(async () => {
        throw new Error("boom");
      }),
      outerSize: vi.fn(async () => ({ width: 400, height: 600 })),
      scaleFactor: vi.fn(async () => 1),
      setBoundsLogical: vi.fn(async () => {}),
    };
    const { target, fire } = makeTarget();
    const source = createWindowResizeSource({ renderer, getWindow: () => win, target });
    source.start();

    expect(() => fire({ ctrlKey: true, deltaY: -100 })).not.toThrow();
    await settle();
    expect(win.setBoundsLogical).not.toHaveBeenCalled();
  });
});
