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
    const store = createBedSceneSettings({
      storage: {
        load: () => ({ enabled: true, wakeTimeoutS: 99999 }) as BedSceneSettings,
        save: vi.fn(),
      },
    });
    expect(store.get().wakeTimeoutS).toBe(WAKE_TIMEOUT_MAX_S);
  });

  it("a stored wrong-typed blob falls back to the defaults", () => {
    const store = createBedSceneSettings({
      storage: {
        load: () => ({ enabled: "yes", wakeTimeoutS: "120" }) as unknown as BedSceneSettings,
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

    createBedSceneSettings({ storage: localStorageStore(BED_SCENE_STORAGE_KEY) }).setEnabled(false);
    expect(written[0]?.[0]).toBe(BED_SCENE_STORAGE_KEY);
    expect(BED_SCENE_STORAGE_KEY).toBe("yui.bed-scene");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
