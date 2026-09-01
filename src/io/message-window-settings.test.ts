// @vitest-environment jsdom
/**
 * message-window-settings.test.ts — the persisted message-window store.
 *
 * Pins parse/defaults/equals and the typed setters of `yui.message-window`:
 * the mode the pet window reads, and the last outer position (physical px)
 * the message window writes back as it is dragged.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createMessageWindowSettings,
  type MessageWindowSettings,
  type MessageWindowStorage,
} from "./message-window-settings";

function inMemoryStorage(initial: unknown = null): MessageWindowStorage & { saved: unknown } {
  const box = {
    saved: initial,
    load: () => box.saved as MessageWindowSettings | null,
    save: (s: MessageWindowSettings) => {
      box.saved = { ...s };
    },
  };
  return box;
}

describe("createMessageWindowSettings — defaults and parse", () => {
  it("defaults to docked with no stored position", () => {
    expect(createMessageWindowSettings().get()).toEqual({ mode: "docked", x: null, y: null });
  });

  it("adopts a stored value", () => {
    const store = createMessageWindowSettings({
      storage: inMemoryStorage({ mode: "popped", x: 120, y: 40 }),
    });
    expect(store.get()).toEqual({ mode: "popped", x: 120, y: 40 });
  });

  it("rejects a blob whose mode is not one of the two modes", () => {
    for (const bad of [null, 42, [], { mode: "floating", x: 1, y: 2 }, { x: 1, y: 2 }]) {
      const store = createMessageWindowSettings({ storage: inMemoryStorage(bad) });
      expect(store.get()).toEqual({ mode: "docked", x: null, y: null });
    }
  });

  it("drops a non-finite stored coordinate back to null", () => {
    const store = createMessageWindowSettings({
      storage: inMemoryStorage({ mode: "popped", x: Number.NaN, y: "12" }),
    });
    expect(store.get()).toEqual({ mode: "popped", x: null, y: null });
  });
});

describe("createMessageWindowSettings — setters", () => {
  it("setMode persists and notifies", () => {
    const storage = inMemoryStorage();
    const store = createMessageWindowSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setMode("popped");

    expect(store.get().mode).toBe("popped");
    expect(storage.saved).toEqual({ mode: "popped", x: null, y: null });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setPosition keeps the mode and persists both coordinates", () => {
    const store = createMessageWindowSettings({ storage: inMemoryStorage() });
    store.setMode("popped");
    store.setPosition(300, 180);
    expect(store.get()).toEqual({ mode: "popped", x: 300, y: 180 });
  });

  it("ignores a non-finite position", () => {
    const store = createMessageWindowSettings({ storage: inMemoryStorage() });
    store.setPosition(Number.NaN, 10);
    expect(store.get()).toEqual({ mode: "docked", x: null, y: null });
  });

  it("equals suppresses a redundant write and notify", () => {
    const storage = inMemoryStorage();
    const store = createMessageWindowSettings({ storage });
    const save = vi.spyOn(storage, "save");
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPosition(10, 20);
    store.setPosition(10, 20);

    expect(save).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
