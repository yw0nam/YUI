import { describe, expect, it, vi } from "vitest";
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
  it("boot applies a stored rect through setFrameLogical", async () => {
    const storage = memoryStorage();
    storage.save({ x: 11, y: 22, width: 500, height: 700 });
    const { frame } = fakeFrame();
    const wiring = createWindowGeometry({
      store: createWindowGeometrySettings({ storage }),
      frame,
    });
    await wiring.apply();
    expect(frame.setFrameLogical).toHaveBeenCalledExactlyOnceWith(11, 22, 500, 700);
  });

  it("a resize write lands in the store as size", () => {
    const storage = memoryStorage();
    const { frame } = fakeFrame();
    const wiring = createWindowGeometry({
      store: createWindowGeometrySettings({ storage }),
      frame,
    });
    wiring.onResizeApplied({ width: 424, height: 636 });
    expect(storage.load()).toEqual({ width: 424, height: 636 });
  });

  it("a drag landed writes the live position", async () => {
    const storage = memoryStorage();
    const { frame } = fakeFrame();
    const wiring = createWindowGeometry({
      store: createWindowGeometrySettings({ storage }),
      frame,
    });
    await wiring.onLand();
    expect(storage.load()).toEqual({ x: 10, y: 20 });
  });
});
