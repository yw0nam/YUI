import { describe, expect, it, vi } from "vitest";
import type { ScreenConfig } from "../config/load";
import {
  createScreenKnobSettings,
  mergeScreen,
  SCREEN_MS_MAX,
  type ScreenKnobStorage,
  type ScreenOverrides,
  screenDefaultsFromConfig,
} from "./screen-settings";

function baseConfig(): ScreenConfig {
  return {
    prev_dwell_ms: 600_000,
    settle_ms: 90_000,
    long_session_ms: 2_700_000,
    min_gap_ms: 300_000,
    quiet_after_turn_ms: 180_000,
  };
}

const NONE: ScreenOverrides = {
  prev_dwell_ms: 0,
  settle_ms: 0,
  long_session_ms: 0,
  min_gap_ms: 0,
  quiet_after_turn_ms: 0,
};

function inMemoryStorage(initial: ScreenOverrides | null = null): ScreenKnobStorage {
  let value = initial;
  return {
    load: () => (value ? { ...value } : null),
    save: (s) => {
      value = { ...s };
    },
  };
}

describe("screen knob settings — store shape", () => {
  it("defaults to no override for every knob", () => {
    const store = createScreenKnobSettings({ storage: inMemoryStorage() });
    expect(store.get()).toEqual(NONE);
  });

  it("set() persists an edited knob and notifies subscribers", () => {
    const storage = inMemoryStorage();
    const store = createScreenKnobSettings({ storage });
    const seen = vi.fn();
    store.subscribe(seen);
    store.set({ min_gap_ms: 600_000 });
    expect(store.get().min_gap_ms).toBe(600_000);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(createScreenKnobSettings({ storage }).get().min_gap_ms).toBe(600_000);
  });

  it("keeps the other knobs untouched when one is edited", () => {
    const store = createScreenKnobSettings({ storage: inMemoryStorage() });
    store.set({ min_gap_ms: 600_000 });
    store.set({ settle_ms: 30_000 });
    expect(store.get()).toEqual({ ...NONE, min_gap_ms: 600_000, settle_ms: 30_000 });
  });

  it("clears the override when set to 0", () => {
    const store = createScreenKnobSettings({ storage: inMemoryStorage() });
    store.set({ settle_ms: 30_000 });
    store.set({ settle_ms: 0 });
    expect(store.get().settle_ms).toBe(0);
  });

  it("keeps the current knob when handed a negative, fractional, over-max, or NaN value", () => {
    const store = createScreenKnobSettings({ storage: inMemoryStorage() });
    store.set({ settle_ms: 30_000 });
    for (const bad of [-1, 4.5, SCREEN_MS_MAX + 1, Number.NaN]) {
      store.set({ settle_ms: bad });
      expect(store.get().settle_ms).toBe(30_000);
    }
    store.set({ settle_ms: SCREEN_MS_MAX });
    expect(store.get().settle_ms).toBe(SCREEN_MS_MAX);
  });

  it("sanitizes a garbage stored value into no override", () => {
    const store = createScreenKnobSettings({
      storage: inMemoryStorage({ ...NONE, prev_dwell_ms: -1, settle_ms: 30_000 }),
    });
    expect(store.get()).toEqual({ ...NONE, settle_ms: 30_000 });
  });

  it("reloadFromStorage adopts another window's edit", () => {
    const storage = inMemoryStorage();
    const store = createScreenKnobSettings({ storage });
    storage.save({ ...NONE, long_session_ms: 1_800_000 });
    store.reloadFromStorage();
    expect(store.get().long_session_ms).toBe(1_800_000);
  });
});

describe("screen knob settings — store over config", () => {
  it("keeps the config default for every knob left unset", () => {
    const base = baseConfig();
    expect(mergeScreen(base, NONE)).toEqual(base);
  });

  it("overrides only the knobs that carry a value", () => {
    const merged = mergeScreen(baseConfig(), { ...NONE, min_gap_ms: 60_000, settle_ms: 30_000 });
    expect(merged.min_gap_ms).toBe(60_000);
    expect(merged.settle_ms).toBe(30_000);
    expect(merged.prev_dwell_ms).toBe(600_000);
    expect(merged.long_session_ms).toBe(2_700_000);
    expect(merged.quiet_after_turn_ms).toBe(180_000);
  });

  it("projects the config thresholds onto the overrides shape", () => {
    expect(screenDefaultsFromConfig(baseConfig())).toEqual({
      prev_dwell_ms: 600_000,
      settle_ms: 90_000,
      long_session_ms: 2_700_000,
      min_gap_ms: 300_000,
      quiet_after_turn_ms: 180_000,
    });
  });

  it("never mutates the config it layers onto", () => {
    const base = baseConfig();
    mergeScreen(base, { ...NONE, min_gap_ms: 60_000 });
    expect(base.min_gap_ms).toBe(300_000);
  });
});
