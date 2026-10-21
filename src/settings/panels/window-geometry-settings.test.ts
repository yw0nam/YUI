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
  it("setBounds then setPosition merge into one record", () => {
    const store = createWindowGeometrySettings({ storage: memoryStorage() });
    store.setBounds({ x: 0, y: 0, width: 400, height: 600 });
    store.setPosition({ x: 30, y: 50 });
    expect(store.get()).toEqual({ x: 30, y: 50, width: 400, height: 600 });
  });
});
