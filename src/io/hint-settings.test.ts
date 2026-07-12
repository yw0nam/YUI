/**
 * hint-settings.test.ts — createHintSettings reactive store.
 *
 * Pins hint-settings' contract: default seen=false, persist round-trip + notify,
 * same-value skip, and malformed-storage fallback.
 */

import { describe, expect, it, vi } from "vitest";
import { createHintSettings, type HintSettings, type HintStorage } from "./hint-settings";

function fakeStorage(initial?: HintSettings | null): HintStorage & { saved: HintSettings[] } {
  const saved: HintSettings[] = [];
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

describe("createHintSettings", () => {
  it("defaults to seen=false", () => {
    expect(createHintSettings().get().seen).toBe(false);
  });

  it("hydrates a valid stored value", () => {
    const store = createHintSettings({ storage: fakeStorage({ seen: true }) });
    expect(store.get().seen).toBe(true);
  });

  it("falls back to default on malformed stored value", () => {
    const malformed = { seen: "nope" } as unknown as HintSettings;
    expect(createHintSettings({ storage: fakeStorage(malformed) }).get().seen).toBe(false);
  });

  it("setSeen persists and notifies on change", () => {
    const storage = fakeStorage(null);
    const store = createHintSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setSeen(true);

    expect(store.get().seen).toBe(true);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].seen).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setSeen with the same value does not persist or notify", () => {
    const storage = fakeStorage(null);
    const store = createHintSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setSeen(false); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});
