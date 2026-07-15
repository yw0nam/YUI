/**
 * rail-collapsed-settings.test.ts — quick-controls rail collapse persistence.
 *
 * Pins the bare-boolean default, bootstrap, restart, and localStorage format.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRailCollapsedSettings,
  localStorageRailCollapsedStorage,
  type RailCollapsedStorage,
} from "./rail-collapsed-settings";

function memoryStorage(initial: boolean | null = null): RailCollapsedStorage {
  let value = initial;
  return {
    load() {
      return value;
    },
    save(next) {
      value = next;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRailCollapsedSettings", () => {
  it("defaults to false with no storage", () => {
    expect(createRailCollapsedSettings().get()).toBe(false);
  });

  it("persists the collapsed state across store restarts", () => {
    const storage = memoryStorage();
    createRailCollapsedSettings({ storage }).setCollapsed(true);

    expect(createRailCollapsedSettings({ storage }).get()).toBe(true);
  });

  it("bootstraps from a pre-seeded storage value", () => {
    const store = createRailCollapsedSettings({ storage: memoryStorage(true) });

    expect(store.get()).toBe(true);
  });

  it("keeps the localStorage format as a bare boolean", () => {
    const key = "yui.quickControls.railCollapsed";
    const values = new Map([[key, "true"]]);
    vi.stubGlobal("localStorage", {
      getItem: (storageKey: string) => values.get(storageKey) ?? null,
      setItem: (storageKey: string, value: string) => values.set(storageKey, value),
    });

    const store = createRailCollapsedSettings({
      storage: localStorageRailCollapsedStorage(),
    });
    expect(store.get()).toBe(true);

    store.setCollapsed(false);
    expect(values.get(key)).toBe("false");
  });
});
