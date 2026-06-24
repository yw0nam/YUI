/**
 * gaze-settings.test.ts — createGazeSettings reactive store.
 *
 * The persisted-store machinery is exhaustively covered by idle-throttle-settings.test.ts
 * (same core); this pins gaze-settings' own contract: default enabled=true, persist
 * round-trip + notify, same-value skip, and malformed-storage fallback.
 */

import { describe, expect, it, vi } from "vitest";
import { createGazeSettings, type GazeSettings, type GazeStorage } from "./gaze-settings";

function fakeStorage(
  initial?: GazeSettings | null,
): GazeStorage & { saved: GazeSettings[] } {
  const saved: GazeSettings[] = [];
  return {
    saved,
    load() {
      return initial ?? null;
    },
    save(s) {
      saved.push(s);
    },
  };
}

describe("createGazeSettings", () => {
  it("defaults to enabled=true", () => {
    expect(createGazeSettings().get().enabled).toBe(true);
  });

  it("hydrates a valid stored value", () => {
    const store = createGazeSettings({ storage: fakeStorage({ enabled: false }) });
    expect(store.get().enabled).toBe(false);
  });

  it("falls back to default on malformed stored value", () => {
    const malformed = { enabled: "nope" } as unknown as GazeSettings;
    expect(createGazeSettings({ storage: fakeStorage(malformed) }).get().enabled).toBe(true);
  });

  it("setEnabled persists and notifies on change", () => {
    const storage = fakeStorage(null);
    const store = createGazeSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(false);

    expect(store.get().enabled).toBe(false);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].enabled).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setEnabled with the same value does not persist or notify", () => {
    const storage = fakeStorage(null);
    const store = createGazeSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});
