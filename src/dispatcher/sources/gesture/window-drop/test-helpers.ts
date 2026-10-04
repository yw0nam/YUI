/** Shared fixtures for the window-drop tests. */

import { vi } from "vitest";
import type { WindowRect } from "../../../../contract";
import type { BusEnvelope, EventBus } from "../../../core/event-bus";

/** Minimal in-memory bus capturing pushes. */
export function makeBus(): { bus: EventBus; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  const bus: EventBus = {
    push(env) {
      pushed.push(env);
      return true;
    },
    pop() {
      return null;
    },
    snapshot() {
      return [...pushed];
    },
  };
  return { bus, pushed };
}

/** A fake Tauri window with controllable outer position + scale factor. */
export function makeWindow(pos: { x: number; y: number }, scale: number) {
  return {
    outerPosition: vi.fn(async () => ({ x: pos.x, y: pos.y })),
    scaleFactor: vi.fn(async () => scale),
  };
}

export const win = (over: Partial<WindowRect> = {}): WindowRect => ({
  x: 300,
  y: 400,
  width: 520,
  height: 320,
  name: "Other",
  ownerName: "Visual Studio Code",
  pid: 999,
  windowNumber: 7,
  ...over,
});

/** A perch probe source whose isPerched() is controllable per tick. */
export function makePerchSource(perched = true) {
  const state = { perched };
  return {
    state,
    renderer: {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => state.perched),
      setPerchTarget: vi.fn(),
    },
  };
}

/** Default poll cadence in ms (≈1.4 Hz). */
export const DEFAULT_POLL_MS = 700;

/** Advance one poll tick and let all queued microtasks (the await chain) settle. */
export async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
}
