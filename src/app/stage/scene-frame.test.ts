import { describe, expect, it, vi } from "vitest";
import { createSceneFrame } from "./scene-frame";

function harness() {
  const frameCalls: number[][] = [];
  const setViewWindow = vi.fn();
  const paused: boolean[] = [];
  const frame = createSceneFrame(
    { setViewWindow } as never,
    {
      frame: {
        ready: Promise.resolve(),
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
