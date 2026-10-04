/**
 * Tests for src/io/window/pet/gesture/orbit-gesture.ts — the Shift + left-drag
 * orbit detector, driven directly.
 *
 * Environment: node (vitest default — no jsdom dependency). Uses a plain
 * EventTarget (Node 18+) to test the listener contract without a DOM.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { OrbitDelta } from "../../../../settings/avatar/camera-gestures";
import { attachOrbitGesture } from "./orbit-gesture";

// ─── orbit gesture (Shift + left-drag) ────────────────────────────────────────
// Shift + left-drag rotates the camera (azimuth/polar deltas) instead of
// moving the OS window. The modifier branch fully consumes the gesture: it
// preventDefaults + captures the pointer. It works WITHOUT the Tauri runtime
// (pure JS callback) so the browser screenshot-verification surface can drive it
// too. Plain left-drag is unchanged.

describe("attachOrbitGesture — orbit gesture (Shift + left-drag)", () => {
  let el: EventTarget;
  let cleanup: () => void;
  let onOrbit: Mock<(delta: OrbitDelta) => void>;

  function down(clientX = 0, clientY = 0, buttons = 1, shiftKey = false): Event {
    const ev = new Event("pointerdown", { cancelable: true }) as Event & {
      buttons: number;
      clientX: number;
      clientY: number;
      pointerId: number;
      shiftKey: boolean;
    };
    Object.assign(ev, { buttons, clientX, clientY, pointerId: 1, shiftKey });
    el.dispatchEvent(ev);
    return ev;
  }

  function move(clientX: number, clientY: number, shiftKey = false): void {
    const ev = new Event("pointermove", { cancelable: true }) as Event & {
      clientX: number;
      clientY: number;
      pointerId: number;
      shiftKey: boolean;
    };
    Object.assign(ev, { clientX, clientY, pointerId: 1, shiftKey });
    el.dispatchEvent(ev);
  }

  function up(): void {
    const ev = new Event("pointerup") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  beforeEach(() => {
    el = new EventTarget();
    onOrbit = vi.fn();
    cleanup = attachOrbitGesture(el, onOrbit);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("accumulates deltas relative to the previous move (not the start point)", () => {
    down(0, 0, 1, true);
    move(10, 0, true);
    move(25, 0, true); // dx from previous = 15
    expect(onOrbit).toHaveBeenNthCalledWith(1, { dx: 10, dy: 0 });
    expect(onOrbit).toHaveBeenNthCalledWith(2, { dx: 15, dy: 0 });
  });

  it("consumes the gesture: preventDefault on the modifier pointerdown", () => {
    const ev = down(0, 0, 1, true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("ends on pointerup: a later move fires no further onOrbit", () => {
    down(0, 0, 1, true);
    move(20, 0, true);
    expect(onOrbit).toHaveBeenCalledTimes(1);
    up();
    move(80, 0, true);
    expect(onOrbit).toHaveBeenCalledTimes(1);
  });

  it("Shift + non-primary button does not orbit", () => {
    down(0, 0, 2, true); // right button + Shift
    move(50, 0, true);
    expect(onOrbit).not.toHaveBeenCalled();
  });

  it("after cleanup() an Shift+left drag no longer orbits", () => {
    cleanup();
    down(0, 0, 1, true);
    move(50, 0, true);
    expect(onOrbit).not.toHaveBeenCalled();
  });
});

// ─── onOrbitStart / onOrbitEnd lifecycle ───────────────────────────────────────
// onOrbitStart fires once when a Shift+left orbit gesture commits (pointerdown with
// shiftKey + buttons=1). onOrbitEnd fires once on pointerup and also once on
// pointercancel. Neither fires for a plain (non-Shift) left-drag.

describe("attachOrbitGesture — onOrbitStart / onOrbitEnd", () => {
  let el: EventTarget;
  let cleanup: () => void;
  let onOrbitStart: Mock<() => void>;
  let onOrbitEnd: Mock<() => void>;

  function down(clientX = 0, clientY = 0, buttons = 1, shiftKey = false): void {
    const ev = new Event("pointerdown", { cancelable: true }) as Event & {
      buttons: number;
      clientX: number;
      clientY: number;
      pointerId: number;
      shiftKey: boolean;
    };
    Object.assign(ev, { buttons, clientX, clientY, pointerId: 1, shiftKey });
    el.dispatchEvent(ev);
  }

  function up(): void {
    const ev = new Event("pointerup") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function cancel(): void {
    const ev = new Event("pointercancel") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  beforeEach(() => {
    el = new EventTarget();
    onOrbitStart = vi.fn();
    onOrbitEnd = vi.fn();
    cleanup = attachOrbitGesture(el, undefined, onOrbitStart, onOrbitEnd);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("Shift+left pointerdown fires onOrbitStart exactly once", () => {
    down(0, 0, 1, true);
    expect(onOrbitStart).toHaveBeenCalledTimes(1);
  });

  it("pointerup after Shift+left pointerdown fires onOrbitEnd exactly once", () => {
    down(0, 0, 1, true);
    up();
    expect(onOrbitEnd).toHaveBeenCalledTimes(1);
  });

  it("pointercancel after Shift+left pointerdown fires onOrbitEnd exactly once", () => {
    down(0, 0, 1, true);
    cancel();
    expect(onOrbitEnd).toHaveBeenCalledTimes(1);
  });

  it("plain left-drag (no shiftKey) fires neither onOrbitStart nor onOrbitEnd", () => {
    down(0, 0, 1, false);
    up();
    expect(onOrbitStart).not.toHaveBeenCalled();
    expect(onOrbitEnd).not.toHaveBeenCalled();
  });

  it("cleanup() during an active orbit fires onOrbitEnd exactly once", () => {
    down(0, 0, 1, true); // orbit starts
    cleanup();
    expect(onOrbitEnd).toHaveBeenCalledTimes(1);
  });
});
