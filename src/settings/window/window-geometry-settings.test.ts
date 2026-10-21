/**
 * window-geometry-settings — the per-window-label size and position store.
 *
 * One Partial<WindowGeometry> record per window label; a size saved before any
 * drop (or the reverse) still applies alone.
 */

import { describe, expect, it } from "vitest";
import {
  createWindowGeometrySettings,
  type StoredWindowGeometry,
} from "./window-geometry-settings";

function memoryStorage() {
  let saved: StoredWindowGeometry | null = null;
  return {
    load: (): StoredWindowGeometry | null => saved,
    save: (s: StoredWindowGeometry): void => {
      saved = s;
    },
  };
}

describe("createWindowGeometrySettings", () => {
  it.each([
    [
      "setSize then setPosition merge into one record",
      () => {
        const store = createWindowGeometrySettings({ storage: memoryStorage() });
        store.setSize({ width: 400, height: 600 });
        store.setPosition({ x: 30, y: 50 });
        return store.get();
      },
      { x: 30, y: 50, width: 400, height: 600 },
    ],
    [
      "a get() on an empty store is {}",
      () => createWindowGeometrySettings({ storage: memoryStorage() }).get(),
      {},
    ],
  ] as const)("%s", (_name, run, expected) => {
    expect(run()).toEqual(expected);
  });
});
