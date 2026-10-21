// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenMonitor } from "../../io/window/geometry/screen-geometry";
import type { FrameWindow } from "../../io/window/geometry/travel-frame";
import {
  createWindowGeometrySettings,
  type StoredWindowGeometry,
} from "../../settings/panels/window-geometry-settings";
import { createWindowGeometry } from "./wire-window-geometry";

function memoryStorage() {
  let saved: StoredWindowGeometry | null = null;
  return {
    load: (): StoredWindowGeometry | null => saved,
    save: (s: StoredWindowGeometry): void => {
      saved = s;
    },
  };
}

function fakeFrame() {
  const state = { x: 10, y: 20, width: 300, height: 400 };
  const frame = {
    outerPosition: vi.fn(async () => ({ x: state.x, y: state.y })),
    outerSize: vi.fn(async () => ({ width: state.width, height: state.height })),
    scaleFactor: vi.fn(async () => 1),
    setPositionLogical: vi.fn(async (x: number, y: number) => {
      state.x = x;
      state.y = y;
    }),
    setFrameLogical: vi.fn(async (x: number, y: number, width: number, height: number) => {
      state.x = x;
      state.y = y;
      state.width = width;
      state.height = height;
    }),
  };
  return { state, frame: frame as unknown as FrameWindow };
}

describe("createWindowGeometry", () => {
  /** One wide monitor at scale 2 — logical bounds 2000×2000, work area included. */
  const bigMonitor: ScreenMonitor = {
    position: { x: 0, y: 0 },
    size: { width: 4000, height: 4000 },
    workArea: { position: { x: 0, y: 0 }, size: { width: 4000, height: 4000 } },
    scaleFactor: 2,
  };

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  it("boot applies a stored rect through setFrameLogical", async () => {
    const storage = memoryStorage();
    storage.save({ x: 11, y: 22, width: 500, height: 700 });
    const { frame } = fakeFrame();
    const wiring = createWindowGeometry({
      store: createWindowGeometrySettings({ storage }),
      frame,
      listMonitors: async () => [bigMonitor],
    });
    await wiring.apply();
    expect(frame.setFrameLogical).toHaveBeenCalledExactlyOnceWith(11, 22, 500, 700);
  });

  it("a drag release saves the live position", async () => {
    const storage = memoryStorage();
    const { frame } = fakeFrame();
    const wiring = createWindowGeometry({
      store: createWindowGeometrySettings({ storage }),
      frame,
    });
    await wiring.onDragReleased();
    expect(storage.load()).toEqual({ x: 10, y: 20 });
  });

  it("a resize saves the applied bounds", () => {
    const storage = memoryStorage();
    const { frame } = fakeFrame();
    const wiring = createWindowGeometry({
      store: createWindowGeometrySettings({ storage }),
      frame,
    });
    wiring.onResizeApplied({ x: 50, y: 60, width: 424, height: 636 });
    expect(storage.load()).toEqual({ x: 50, y: 60, width: 424, height: 636 });
  });

  it("apply waits until the page has the applied size before resolving", async () => {
    // jsdom's viewport starts at 1024×768; the page catches up on the third frame.
    let raf = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      raf += 1;
      if (raf === 3) {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
      }
      cb(0);
      return raf;
    });
    const storage = memoryStorage();
    storage.save({ x: 11, y: 22, width: 500, height: 700 });
    const { frame } = fakeFrame();
    const wiring = createWindowGeometry({
      store: createWindowGeometrySettings({ storage }),
      frame,
    });
    let pageSizeAtResolve = "";
    const done = wiring.apply().then(() => {
      pageSizeAtResolve = `${window.innerWidth}x${window.innerHeight}`;
    });
    await done;
    expect(pageSizeAtResolve).toBe("500x700");
  });

  it("a stored position outside every monitor is clamped into the monitor work area before applying", async () => {
    const storage = memoryStorage();
    storage.save({ x: 880, y: 400, width: 200, height: 90 });
    const { frame } = fakeFrame();
    const wiring = createWindowGeometry({
      store: createWindowGeometrySettings({ storage }),
      frame,
      listMonitors: async () => [
        {
          position: { x: 0, y: 0 },
          size: { width: 2000, height: 1000 },
          workArea: { position: { x: 0, y: 0 }, size: { width: 2000, height: 950 } },
          scaleFactor: 2,
        },
      ],
    });
    await wiring.apply();
    expect(frame.setFrameLogical).toHaveBeenCalledExactlyOnceWith(800, 385, 200, 90);
  });
});
