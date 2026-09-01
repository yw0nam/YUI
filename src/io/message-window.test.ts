// @vitest-environment jsdom
/**
 * message-window.test.ts — where the message window opens, and on which runtime.
 *
 * initialMessageWindowPosition is the placement rule on its own: keep a stored
 * position, otherwise sit to the right of the pet window's top edge, and in both
 * cases stay inside the work area of the monitor holding the pet window.
 */

import { describe, expect, it, vi } from "vitest";
import {
  initialMessageWindowPosition,
  MESSAGE_WINDOW_HANDLE_HEIGHT,
  MESSAGE_WINDOW_WIDTH,
  openMessageWindow,
} from "./message-window";
import type { ScreenMonitor } from "./screen-geometry";

/** One 1440×900 logical monitor at scale 1, its work area 25px below the top. */
const MONITOR: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1440, height: 900 },
  workArea: { position: { x: 0, y: 25 }, size: { width: 1440, height: 875 } },
};

const SIZE = { width: MESSAGE_WINDOW_WIDTH, height: MESSAGE_WINDOW_HANDLE_HEIGHT };

function place(overrides: {
  stored?: { x: number | null; y: number | null };
  pet?: { position: { x: number; y: number }; size: { width: number; height: number } };
  monitors?: ScreenMonitor[];
  scale?: number;
}) {
  return initialMessageWindowPosition({
    stored: overrides.stored ?? { x: null, y: null },
    pet: overrides.pet ?? { position: { x: 400, y: 300 }, size: { width: 300, height: 460 } },
    monitors: overrides.monitors ?? [MONITOR],
    scale: overrides.scale ?? 1,
    size: SIZE,
  });
}

describe("initialMessageWindowPosition", () => {
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

  it("keeps the raw position when no monitor holds the pet window", () => {
    expect(place({ stored: { x: -900, y: -900 }, monitors: [] })).toEqual({ x: -900, y: -900 });
  });
});

describe("openMessageWindow", () => {
  function env(overrides: Partial<Parameters<typeof openMessageWindow>[0]> = {}) {
    return {
      isTauri: true,
      getExisting: vi.fn(async () => null),
      create: vi.fn(async () => {}),
      resolvePosition: vi.fn(async () => ({ x: 10, y: 20 })),
      ...overrides,
    };
  }

  it("creates the window at the resolved position when none exists", async () => {
    const e = env();
    await openMessageWindow(e);
    expect(e.create).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("shows the existing window instead of creating a second one", async () => {
    const show = vi.fn(async () => {});
    const e = env({ getExisting: vi.fn(async () => ({ show })) });
    await openMessageWindow(e);
    expect(show).toHaveBeenCalledTimes(1);
    expect(e.create).not.toHaveBeenCalled();
  });

  it("does nothing outside Tauri", async () => {
    const e = env({ isTauri: false });
    await openMessageWindow(e);
    expect(e.getExisting).not.toHaveBeenCalled();
    expect(e.create).not.toHaveBeenCalled();
  });
});
