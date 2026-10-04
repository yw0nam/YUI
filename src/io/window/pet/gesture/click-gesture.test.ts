/**
 * Tests for src/io/window/pet/gesture/click-gesture.ts — the sub-threshold click
 * and press-and-hold pat detector, driven directly.
 *
 * Environment: node (vitest default — no jsdom dependency). Uses a plain
 * EventTarget (Node 18+) to test the listener contract without a DOM.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { attachClickGesture } from "./click-gesture";

describe.each([
  ["Tauri", true],
  ["browser", false],
] as const)("attachClickGesture — onClick (%s)", (_runtime, tauri) => {
  let el: EventTarget;
  let cleanup: () => void;
  let onClick: Mock<(pos: { x: number; y: number }) => void>;

  function pointer(
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    {
      clientX = 0,
      clientY = 0,
      pointerId = 1,
      buttons = type === "pointerdown" ? 1 : 0,
      button = type === "pointerup" ? 0 : -1,
      shiftKey = false,
    }: Partial<PointerEvent> = {},
  ): void {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX, clientY, pointerId, buttons, button, shiftKey });
    el.dispatchEvent(event);
  }

  beforeEach(() => {
    el = new EventTarget();
    onClick = vi.fn();
    if (tauri) {
      (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    } else {
      delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
    cleanup = attachClickGesture(el, onClick).dispose;
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it("fires once for a sub-threshold primary press-release using pointerup viewport coordinates", () => {
    pointer("pointerdown", { clientX: 10, clientY: 20 });
    pointer("pointermove", { clientX: 12, clientY: 21 });
    pointer("pointerup", { clientX: 13, clientY: 22 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith({ x: 13, y: 22 });
  });

  it("does not fire after crossing the drag threshold", () => {
    pointer("pointerdown");
    pointer("pointermove", { clientX: 10 });
    pointer("pointerup", { clientX: 10 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not arm for a non-primary press", () => {
    pointer("pointerdown", { buttons: 2, button: 2 });
    pointer("pointerup", { button: 2 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("pointercancel aborts without firing", () => {
    pointer("pointerdown");
    pointer("pointercancel");
    pointer("pointerup");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("an unrelated pointerup neither fires nor terminates the armed gesture", () => {
    pointer("pointerdown", { clientX: 1, clientY: 2, pointerId: 7 });
    pointer("pointerup", { clientX: 30, clientY: 40, pointerId: 8 });
    expect(onClick).not.toHaveBeenCalled();
    pointer("pointerup", { clientX: 3, clientY: 4, pointerId: 7 });
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith({ x: 3, y: 4 });
  });

  it("a non-primary pointerup neither fires nor terminates the armed gesture", () => {
    pointer("pointerdown", { pointerId: 7 });
    pointer("pointerup", { pointerId: 7, button: 2 });
    expect(onClick).not.toHaveBeenCalled();
    pointer("pointerup", { clientX: 5, clientY: 6, pointerId: 7, button: 0 });
    expect(onClick).toHaveBeenCalledWith({ x: 5, y: 6 });
  });
});

// ─── pat gesture (press and hold on the head) ──────────────────────────────────
// A primary press that lands on the head region and is held past holdMs becomes a
// pat: the press no longer converts to a window drag, and its release ends the pat
// instead of firing a click. A release or a threshold-crossing move before holdMs
// leaves the click / drag gestures untouched.

const PAT_HOLD_MS = 300;

describe.each([
  ["Tauri", true],
  ["browser", false],
] as const)("attachClickGesture — pat gesture (%s)", (_runtime, tauri) => {
  let el: EventTarget;
  let cleanup: () => void;
  let onClick: Mock<(pos: { x: number; y: number }) => void>;
  let isPatPoint: Mock<(pos: { x: number; y: number }) => boolean>;
  let onStart: Mock<() => void>;
  let onEnd: Mock<() => void>;
  let onAbort: Mock<() => void>;

  function pointer(
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "lostpointercapture",
    {
      clientX = 0,
      clientY = 0,
      pointerId = 1,
      buttons = type === "pointerdown" ? 1 : 0,
      button = type === "pointerup" ? 0 : -1,
      shiftKey = false,
    }: Partial<PointerEvent> = {},
  ): void {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX, clientY, pointerId, buttons, button, shiftKey });
    el.dispatchEvent(event);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    el = new EventTarget();
    onClick = vi.fn();
    isPatPoint = vi.fn(() => true);
    onStart = vi.fn();
    onEnd = vi.fn();
    onAbort = vi.fn();
    if (tauri) {
      (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    } else {
      delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
    cleanup = attachClickGesture(el, onClick, {
      isPatPoint,
      holdMs: () => PAT_HOLD_MS,
      onStart,
      onEnd,
      onAbort,
    }).dispose;
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("starts the pat once the press is held past holdMs", () => {
    pointer("pointerdown", { clientX: 10, clientY: 20 });
    expect(isPatPoint).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(onStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PAT_HOLD_MS);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("ends the pat on release and fires no click", () => {
    pointer("pointerdown");
    vi.advanceTimersByTime(PAT_HOLD_MS);
    pointer("pointerup");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps a short head press a plain click", () => {
    pointer("pointerdown", { clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(PAT_HOLD_MS - 1);
    pointer("pointerup", { clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(PAT_HOLD_MS);
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("never arms the pat for a press away from the head", () => {
    isPatPoint.mockReturnValue(false);
    pointer("pointerdown", { clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(PAT_HOLD_MS);
    expect(onStart).not.toHaveBeenCalled();
    pointer("pointerup", { clientX: 10, clientY: 20 });
    expect(onClick).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("ends the pat on pointercancel", () => {
    pointer("pointerdown");
    vi.advanceTimersByTime(PAT_HOLD_MS);
    pointer("pointercancel");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ends an in-progress pat on cleanup without offering the release cue", () => {
    pointer("pointerdown");
    vi.advanceTimersByTime(PAT_HOLD_MS);
    cleanup();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("releases a pat stranded by a lost pointer capture", () => {
    pointer("pointerdown");
    vi.advanceTimersByTime(PAT_HOLD_MS);
    pointer("lostpointercapture");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    // The gesture is disarmed, so the stale pointerup neither re-ends it nor fires a click.
    pointer("pointerup");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("leaves a pat untouched when another pointer loses capture", () => {
    pointer("pointerdown", { pointerId: 1 });
    vi.advanceTimersByTime(PAT_HOLD_MS);
    pointer("lostpointercapture", { pointerId: 2 });
    expect(onEnd).not.toHaveBeenCalled();
    pointer("pointerup", { pointerId: 1 });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("arms the gesture even when the hold length cannot be read", () => {
    cleanup();
    const holdMs = vi.fn(() => {
      throw new Error("config unavailable");
    });
    el = new EventTarget();
    cleanup = attachClickGesture(el, onClick, {
      isPatPoint,
      holdMs,
      onStart,
      onEnd,
      onAbort,
    }).dispose;
    expect(() => pointer("pointerdown", { clientX: 10, clientY: 20 })).not.toThrow();
    pointer("pointerup", { clientX: 10, clientY: 20 });
    expect(onStart).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith({ x: 10, y: 20 });
  });
});
