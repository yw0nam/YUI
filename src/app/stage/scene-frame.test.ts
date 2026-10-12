import { describe, expect, it, vi } from "vitest";
import { createSceneFrame } from "./scene-frame";

function harness(ready = Promise.resolve()) {
  const frameCalls: number[][] = [];
  const setViewWindow = vi.fn();
  const paused: boolean[] = [];
  const frame = createSceneFrame(
    { setViewWindow } as never,
    {
      frame: {
        ready,
        listMonitors: async () => [
          {
            position: { x: 0, y: 0 },
            size: { width: 2000, height: 1200 },
            workArea: { position: { x: 0, y: 0 }, size: { width: 2000, height: 1200 } },
            scaleFactor: 1,
          },
        ],
        frameWindow: () => ({
          outerPosition: async () => ({ x: 500, y: 300 }),
          outerSize: async () => ({ width: 400, height: 600 }),
          scaleFactor: async () => 1,
          setPositionLogical: async () => {},
          setFrameLogical: async (...args: number[]) => {
            frameCalls.push(args);
          },
        }),
      },
      setKeepOnScreenPaused: (p: boolean) => paused.push(p),
    } as never,
  );
  return { frame, frameCalls, setViewWindow, paused };
}

describe("createSceneFrame", () => {
  it("does not repark before the real window is ready", async () => {
    let ready!: () => void;
    const h = harness(
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    );
    const parking = h.frame.park({ leftPx: 250, rightPx: 100, anchorX: 200 });

    await h.frame.repark({ leftPx: 450, rightPx: 350, anchorX: 200 });
    expect(h.frameCalls).toEqual([]);
    expect(h.setViewWindow).not.toHaveBeenCalled();
    expect(h.paused).toEqual([]);
    ready();
    await parking;
    expect(h.frameCalls).toEqual([[450, 300, 450, 600]]);
  });

  it("parks and unparks the window once per scene, however many scenes run", async () => {
    const h = harness();
    const extents = { leftPx: 250, rightPx: 100, anchorX: 200 };

    await h.frame.park(extents);
    await h.frame.release();
    await h.frame.park(extents);
    await h.frame.release();
    // A scene that ended before it parked has nothing left to unpark.
    await h.frame.release();

    expect(h.frameCalls).toEqual([
      [450, 300, 450, 600],
      [550, 300, 400, 600],
      [450, 300, 450, 600],
      [550, 300, 400, 600],
    ]);
    expect(h.paused).toEqual([true, false, true, false]);
    expect(h.setViewWindow).toHaveBeenLastCalledWith(null);
  });
});
