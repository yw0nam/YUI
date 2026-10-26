import { describe, expect, it } from "vitest";
import type { PersistedStorage } from "../persisted-store";
import { createUnifiedWindowSettings, type UnifiedWindowSettings } from "./unified-window-settings";

function inMemoryStorage(initial: unknown = null) {
  const box = {
    saved: initial,
    load: () => box.saved as UnifiedWindowSettings | null,
    save: (s: UnifiedWindowSettings) => {
      box.saved = { ...s };
    },
  } satisfies PersistedStorage<UnifiedWindowSettings> & { saved: unknown };
  return box;
}

describe("createUnifiedWindowSettings", () => {
  it.each([
    [null, { x: null, y: null }],
    [
      { x: 120, y: 40 },
      { x: 120, y: 40 },
    ],
    [
      { x: Number.NaN, y: "12" },
      { x: null, y: null },
    ],
    [[], { x: null, y: null }],
  ])("reads the stored %j as %j", (stored, expected) => {
    expect(createUnifiedWindowSettings({ storage: inMemoryStorage(stored) }).get()).toEqual(
      expected,
    );
  });

  it("persists a position and ignores a non-finite one", () => {
    const storage = inMemoryStorage();
    const store = createUnifiedWindowSettings({ storage });

    store.setPosition(300, 180);
    store.setPosition(Number.NaN, 10);

    expect(storage.saved).toEqual({ x: 300, y: 180 });
    expect(store.get()).toEqual({ x: 300, y: 180 });
  });
});
