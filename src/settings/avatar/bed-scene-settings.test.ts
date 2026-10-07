/**
 * bed-scene-settings.test.ts — launch bed scene reactive store.
 *
 * Pins the contract for src/settings/avatar/bed-scene-settings.ts:
 *   BED_SCENE_STORAGE_KEY and the wake-timeout constants
 *   createBedSceneSettings({ storage? }) store
 */

import { describe, expect, it, vi } from "vitest";
import { localStorageStore } from "../persisted-store";
import type { BedSceneSettings } from "./bed-scene-settings";
import {
  BED_SCENE_STORAGE_KEY,
  createBedSceneSettings,
  WAKE_TIMEOUT_DEFAULT_S,
  WAKE_TIMEOUT_MAX_S,
  WAKE_TIMEOUT_MIN_S,
} from "./bed-scene-settings";

// ─────────────────────────────────────────────────────────────────────────────
// createBedSceneSettings — defaults and setters
// ─────────────────────────────────────────────────────────────────────────────

describe("createBedSceneSettings", () => {
  it("defaults to enabled with the default wake timeout", () => {
    const store = createBedSceneSettings();
    expect(store.get()).toEqual({ enabled: true, wakeTimeoutS: WAKE_TIMEOUT_DEFAULT_S });
  });

  it("setEnabled round-trips", () => {
    const store = createBedSceneSettings();
    store.setEnabled(false);
    expect(store.get().enabled).toBe(false);
    store.setEnabled(true);
    expect(store.get().enabled).toBe(true);
  });

  it("setEnabled preserves the wake timeout", () => {
    const store = createBedSceneSettings();
    store.setWakeTimeoutS(300);
    store.setEnabled(false);
    expect(store.get()).toEqual({ enabled: false, wakeTimeoutS: 300 });
  });

  it("clamps above the max and below the min, and rounds", () => {
    const store = createBedSceneSettings();
    store.setWakeTimeoutS(WAKE_TIMEOUT_MAX_S + 1000);
    expect(store.get().wakeTimeoutS).toBe(WAKE_TIMEOUT_MAX_S);
    store.setWakeTimeoutS(1);
    expect(store.get().wakeTimeoutS).toBe(WAKE_TIMEOUT_MIN_S);
    store.setWakeTimeoutS(120.6);
    expect(store.get().wakeTimeoutS).toBe(121);
  });

  it("NaN and Infinity are ignored without notifying", () => {
    const store = createBedSceneSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setWakeTimeoutS(NaN);
    store.setWakeTimeoutS(Infinity);
    expect(store.get().wakeTimeoutS).toBe(WAKE_TIMEOUT_DEFAULT_S);
    expect(cb).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Stored-value sanitizing
  // ───────────────────────────────────────────────────────────────────────────

  it("a stored out-of-range timeout is clamped on load", () => {
    const stored = (wakeTimeoutS: number) => ({
      storage: {
        load: () => ({ enabled: true, wakeTimeoutS }) as BedSceneSettings,
        save: vi.fn(),
      },
    });
    expect(createBedSceneSettings(stored(99999)).get().wakeTimeoutS).toBe(WAKE_TIMEOUT_MAX_S);
    expect(createBedSceneSettings(stored(1)).get().wakeTimeoutS).toBe(WAKE_TIMEOUT_MIN_S);
    expect(createBedSceneSettings(stored(120.6)).get().wakeTimeoutS).toBe(121);
  });

  it("a stored blob with one wrong-typed field falls back to the defaults", () => {
    const stored = (s: unknown) => ({
      storage: {
        load: () => ({ enabled: true, wakeTimeoutS: s }) as unknown as BedSceneSettings,
        save: vi.fn(),
      },
    });
    const defaults = { enabled: true, wakeTimeoutS: WAKE_TIMEOUT_DEFAULT_S };
    // wakeTimeoutS wrong, enabled right — the whole blob is rejected.
    expect(createBedSceneSettings(stored("120")).get()).toEqual(defaults);
    expect(createBedSceneSettings(stored(NaN)).get()).toEqual(defaults);
  });

  it("a stored blob with a wrong-typed enabled falls back to the defaults", () => {
    const store = createBedSceneSettings({
      storage: {
        load: () => ({ enabled: "yes", wakeTimeoutS: 300 }) as unknown as BedSceneSettings,
        save: vi.fn(),
      },
    });
    expect(store.get()).toEqual({ enabled: true, wakeTimeoutS: WAKE_TIMEOUT_DEFAULT_S });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BED_SCENE_STORAGE_KEY — the default localStorage key
// ─────────────────────────────────────────────────────────────────────────────

describe("BED_SCENE_STORAGE_KEY", () => {
  it("writes the settings under yui.bed-scene", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    try {
      createBedSceneSettings({ storage: localStorageStore(BED_SCENE_STORAGE_KEY) }).setEnabled(
        false,
      );
      expect(written[0]?.[0]).toBe(BED_SCENE_STORAGE_KEY);
      expect(BED_SCENE_STORAGE_KEY).toBe("yui.bed-scene");
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
