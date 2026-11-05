/**
 * perch-follow.test.ts — a seated character follows her host window, driven through
 * createPerchFollow with a fake bounds read, window and timers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowRect } from "../../../../contract";
import type { ScreenMonitor } from "../../../../io/window/geometry/screen-geometry";
import { createPerchFollow } from "./perch-follow";
import { makePerchSource, makeWindow, win } from "./test-helpers";

/** One 3840x2160 monitor at scale 2: 1920x1080 logical points. */
const MONITOR: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 3840, height: 2160 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 3840, height: 2160 } },
  scaleFactor: 2,
};

/** One 16 ms follow step. */
const step = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(16);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * The host starts at (300, 400, 520 wide), window number 7. The pet window sits at physical
 * (520, 740) at scale 2 with seat offset (40, 30), so the seat is (300, 400): the host's top-left corner.
 */
function follow() {
  const host = { rect: win({ windowNumber: 7 }) as WindowRect | null };
  const windowBounds = vi.fn(async () => host.rect);
  const petWindow = {
    ...makeWindow({ x: 520, y: 740 }, 2),
    setPositionPhysical: vi.fn(async (_x: number, _y: number) => {}),
  };
  const perch = makePerchSource();
  const onLost = vi.fn();
  const setGuardPaused = vi.fn();
  const subject = createPerchFollow({
    windowBounds,
    getWindow: () => petWindow,
    renderer: perch.renderer,
    listMonitors: async () => [MONITOR],
    setGuardPaused,
    setInterval,
    clearInterval,
  });
  return { subject, host, windowBounds, petWindow, perch, onLost, setGuardPaused };
}

describe("perch-follow", () => {
  it("moves nothing on the first step, which only reads the baseline", async () => {
    const { subject, windowBounds, petWindow, onLost } = follow();
    subject.start(7, onLost);
    await step();

    expect(windowBounds).toHaveBeenCalledTimes(1);
    expect(windowBounds).toHaveBeenCalledWith(7);
    expect(petWindow.setPositionPhysical).not.toHaveBeenCalled();
  });

  it.each([
    { dx: 100, dy: 50, to: [720, 840] },
    { dx: -30, dy: 0, to: [460, 740] },
    { dx: 0, dy: -20, to: [520, 700] },
  ])("moves the pet window by the host's ($dx, $dy) at scale 2", async ({ dx, dy, to }) => {
    const { subject, host, petWindow, onLost } = follow();
    subject.start(7, onLost);
    await step();

    host.rect = win({ windowNumber: 7, x: 300 + dx, y: 400 + dy });
    await step();

    expect(petWindow.setPositionPhysical).toHaveBeenCalledTimes(1);
    expect(petWindow.setPositionPhysical).toHaveBeenCalledWith(to[0], to[1]);
  });

  it("follows only y when the width changes", async () => {
    const { subject, host, petWindow, onLost } = follow();
    subject.start(7, onLost);
    await step();

    // The left edge grows out by 50 and the top edge moves down 50: x changes with the width.
    host.rect = win({ windowNumber: 7, x: 250, y: 450, width: 570 });
    await step();

    expect(petWindow.setPositionPhysical).toHaveBeenCalledWith(520, 840);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("loses the seat once, as off_width, when the host shrinks past it, and stops", async () => {
    const info = vi.spyOn(console, "info");
    const { subject, host, windowBounds, onLost, setGuardPaused } = follow();
    subject.start(7, onLost);
    await step();

    host.rect = win({ windowNumber: 7, x: 500, width: 320 });
    await step();
    await step();
    await step();

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[YUI][perch-follow] perch.follow_lost", {
      reason: "off_width",
      windowNumber: 7,
    });
    expect(windowBounds).toHaveBeenCalledTimes(2);
    expect(setGuardPaused).toHaveBeenLastCalledWith(false);
  });

  it("loses the seat once, as off_screen, when the move puts it off every monitor", async () => {
    const info = vi.spyOn(console, "info");
    const { subject, host, petWindow, onLost } = follow();
    subject.start(7, onLost);
    await step();

    // The seat lands at (300, 1200) on a 1080-high screen.
    host.rect = win({ windowNumber: 7, y: 1200 });
    await step();
    await step();

    expect(petWindow.setPositionPhysical).toHaveBeenCalledWith(520, 2340);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[YUI][perch-follow] perch.follow_lost", {
      reason: "off_screen",
      windowNumber: 7,
    });
  });

  it("moves nothing while the renderer is not perched", async () => {
    const { subject, host, perch, petWindow, onLost } = follow();
    subject.start(7, onLost);
    await step();

    perch.state.perched = false;
    host.rect = win({ windowNumber: 7, x: 400, y: 450 });
    await step();
    await step();

    expect(petWindow.setPositionPhysical).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
  });

  it("pauses the keep-on-screen guard from start to stop and ignores a step left over from before a restart", async () => {
    const { subject, host, windowBounds, petWindow, setGuardPaused, onLost } = follow();
    subject.start(7, onLost);
    expect(setGuardPaused).toHaveBeenLastCalledWith(true);
    await step();

    // A step whose bounds read is still in flight when stop() runs.
    let resolveBounds!: (rect: WindowRect) => void;
    windowBounds.mockImplementationOnce(
      () =>
        new Promise<WindowRect>((resolve) => {
          resolveBounds = resolve;
        }),
    );
    await step();
    subject.stop();
    expect(setGuardPaused).toHaveBeenLastCalledWith(false);
    host.rect = win({ windowNumber: 7, x: 500, y: 500 });
    await step();
    await step();
    expect(windowBounds).toHaveBeenCalledTimes(2);

    // The left-over step resolves after a restart: it neither moves her nor sets the baseline.
    host.rect = win({ windowNumber: 7 });
    subject.start(7, onLost);
    resolveBounds(win({ windowNumber: 7, x: 400, y: 450 }));
    await step();
    await step();

    expect(petWindow.setPositionPhysical).not.toHaveBeenCalled();
  });

  it("keeps the next follow's baseline when a step blocked on the window move straddles stop and start", async () => {
    const { subject, host, petWindow, onLost } = follow();
    subject.start(7, onLost);
    await step();

    // The step's window move is still in flight when she is re-seated on window 8.
    let finishMove!: () => void;
    petWindow.setPositionPhysical.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishMove = resolve;
        }),
    );
    host.rect = win({ windowNumber: 7, x: 400, y: 450 });
    await step();
    subject.stop();
    host.rect = win({ windowNumber: 8, x: 900, y: 900 });
    subject.start(8, onLost);
    finishMove();
    await step();
    await step();

    expect(petWindow.setPositionPhysical).toHaveBeenCalledTimes(1);
  });
});
