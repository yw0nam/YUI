/**
 * companion-position.test.ts — the placement rule on its own: keep a stored position, otherwise
 * sit to the right of the pet window's top edge, and in both cases stay inside the work area of
 * the monitor holding the pet window.
 */

import { describe, expect, it } from "vitest";
import { MESSAGE_WINDOW_HANDLE_HEIGHT, MESSAGE_WINDOW_WIDTH } from "../openers/message-window";
import { initialCompanionPosition } from "./companion-position";
import type { ScreenMonitor } from "./screen-geometry";

/** One 1440×900 logical monitor at scale 1, its work area 25px below the top. */
const MONITOR: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1440, height: 900 },
  workArea: { position: { x: 0, y: 25 }, size: { width: 1440, height: 875 } },
  scaleFactor: 1,
};

const SIZE = { width: MESSAGE_WINDOW_WIDTH, height: MESSAGE_WINDOW_HANDLE_HEIGHT };

function place(overrides: {
  stored?: { x: number | null; y: number | null };
  pet?: { position: { x: number; y: number }; size: { width: number; height: number } };
  monitors?: ScreenMonitor[];
  scale?: number;
}) {
  return initialCompanionPosition({
    stored: overrides.stored ?? { x: null, y: null },
    pet: overrides.pet ?? { position: { x: 400, y: 300 }, size: { width: 300, height: 460 } },
    monitors: overrides.monitors ?? [MONITOR],
    scale: overrides.scale ?? 1,
    size: SIZE,
  });
}

describe("initialCompanionPosition", () => {
  it("keeps a stored position that already sits inside the work area", () => {
    expect(place({ stored: { x: 900, y: 500 } })).toEqual({ x: 900, y: 500 });
  });

  it("clamps a stored position that fell outside the work area", () => {
    expect(place({ stored: { x: -200, y: 5 } })).toEqual({ x: 0, y: 25 });
    expect(place({ stored: { x: 5000, y: 5000 } })).toEqual({
      x: 1440 - MESSAGE_WINDOW_WIDTH,
      y: 900 - MESSAGE_WINDOW_HANDLE_HEIGHT,
    });
  });

  it("sits to the right of the pet window's top edge with no stored position", () => {
    expect(
      place({ pet: { position: { x: 400, y: 300 }, size: { width: 300, height: 460 } } }),
    ).toEqual({ x: 712, y: 300 });
  });

  it("clamps back to the right edge when the pet window sits near it", () => {
    expect(
      place({ pet: { position: { x: 1300, y: 300 }, size: { width: 120, height: 460 } } }),
    ).toEqual({ x: 1440 - MESSAGE_WINDOW_WIDTH, y: 300 });
  });

  it("works in physical pixels on a scaled monitor", () => {
    const retina: ScreenMonitor = {
      position: { x: 0, y: 0 },
      size: { width: 2880, height: 1800 },
      workArea: { position: { x: 0, y: 50 }, size: { width: 2880, height: 1750 } },
      scaleFactor: 2,
    };
    // Pet at physical (800, 600) is logical (400, 300); the gap and the window box are logical.
    expect(
      place({
        pet: { position: { x: 800, y: 600 }, size: { width: 600, height: 920 } },
        monitors: [retina],
        scale: 2,
      }),
    ).toEqual({ x: 1424, y: 600 });
  });

  // A window the user parked on a second display must be clamped there.
  it("clamps a stored position against the monitor it sits on", () => {
    const second: ScreenMonitor = {
      position: { x: 1440, y: 0 },
      size: { width: 1000, height: 800 },
      workArea: { position: { x: 1440, y: 0 }, size: { width: 1000, height: 800 } },
      scaleFactor: 1,
    };
    expect(place({ stored: { x: 2400, y: 780 }, monitors: [MONITOR, second] })).toEqual({
      x: 1440 + 1000 - MESSAGE_WINDOW_WIDTH,
      y: 800 - MESSAGE_WINDOW_HANDLE_HEIGHT,
    });
  });

  it("keeps the raw position when no monitor holds the pet window", () => {
    expect(place({ stored: { x: -900, y: -900 }, monitors: [] })).toEqual({ x: -900, y: -900 });
  });
});
