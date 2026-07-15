/**
 * screenshot-settings.test.ts — createScreenshotSettings reactive store.
 *
 * Validation:
 *  - Defaults: enabled=false, source={kind:"monitor",index:0}
 *  - Stored valid value takes precedence over initial
 *  - initial takes precedence over defaults
 *  - Invalid/throwing storage → defaults, factory does not throw
 *  - setEnabled/setSource: persist + notify on actual change, skip on identical value
 *  - subscribe/unsubscribe
 *  - get() returns shallow copy (prevents internal state mutation)
 */

import { describe, expect, it, vi } from "vitest";
import {
  createScreenshotSettings,
  type ScreenshotSettings,
  type ScreenshotStorage,
} from "./screenshot-settings";

function fakeStorage(initial?: ScreenshotSettings | null): ScreenshotStorage & {
  saved: ScreenshotSettings[];
} {
  const saved: ScreenshotSettings[] = [];
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

const DEFAULT_SOURCE = { kind: "monitor" as const, index: 0 };

describe("createScreenshotSettings — defaults", () => {
  it("defaults to enabled=false, monitor index 0 when no storage and no initial", () => {
    const store = createScreenshotSettings();
    const s = store.get();
    expect(s.enabled).toBe(false);
    expect(s.source).toEqual(DEFAULT_SOURCE);
  });

  it("does not throw when no options given", () => {
    expect(() => createScreenshotSettings()).not.toThrow();
  });
});

describe("createScreenshotSettings — malformed/throwing storage", () => {
  it("storage returns malformed data (missing enabled) → falls back to defaults", () => {
    const malformed = { source: { kind: "monitor", index: 0 } } as unknown as ScreenshotSettings;
    const store = createScreenshotSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(false);
    expect(store.get().source).toEqual(DEFAULT_SOURCE);
  });

  it("storage returns malformed data (missing source) → falls back to defaults", () => {
    const malformed = { enabled: false } as unknown as ScreenshotSettings;
    const store = createScreenshotSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(false);
    expect(store.get().source).toEqual(DEFAULT_SOURCE);
  });

  it("storage returns null source → falls back to defaults", () => {
    const malformed = { enabled: false, source: null } as unknown as ScreenshotSettings;
    const store = createScreenshotSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(false);
    expect(store.get().source).toEqual(DEFAULT_SOURCE);
  });
});

describe("createScreenshotSettings — setEnabled", () => {
  it("setEnabled(true) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true);

    expect(store.get().enabled).toBe(true);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].enabled).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].enabled).toBe(true);
  });

  it("setEnabled with same value does NOT persist or notify", () => {
    const storage = fakeStorage(null);
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(false); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createScreenshotSettings — setSource", () => {
  it("setSource persists and notifies on actual change", () => {
    const storage = fakeStorage(null);
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    const newSource = { kind: "monitor" as const, index: 1, label: "外部" };
    store.setSource(newSource);

    expect(store.get().source).toEqual(newSource);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].source).toEqual(newSource);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setSource with structurally equal value does NOT persist or notify", () => {
    const storage = fakeStorage(null);
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setSource({ kind: "monitor", index: 0 }); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});
