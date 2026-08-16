import { describe, expect, it, vi } from "vitest";
import type { GuardrailsConfig } from "../config/load";
import {
  createGuardrailsSettings,
  type GuardrailsStorage,
  mergeGuardrails,
  RATE_LIMIT_MAX,
  type RateLimitOverrides,
  rateLimitDefaultsFromConfig,
} from "./guardrails-settings";

function baseConfig(): GuardrailsConfig {
  return {
    debounce_ms: {
      idle_watcher: 30_000,
      os_event_watcher: 5_000,
      backend_push_source: 10_000,
      user_input_source: 0,
      screen_watcher: 5_000,
    },
    rate_limit: {
      window_ms: 3_600_000,
      tier2_max: 24,
      tier3_max: 2,
      overall_max: 40,
      cooldown_ms: 300_000,
    },
    attachments: { max_count: 6, max_image_bytes: 5_242_880 },
  };
}

function inMemoryStorage(initial: RateLimitOverrides | null = null): GuardrailsStorage {
  let value = initial;
  return {
    load: () => (value ? { ...value } : null),
    save: (s) => {
      value = { ...s };
    },
  };
}

describe("guardrails settings — store shape", () => {
  it("defaults to no override for every cap", () => {
    const store = createGuardrailsSettings({ storage: inMemoryStorage() });
    expect(store.get()).toEqual({ tier2_max: 0, tier3_max: 0, overall_max: 0 });
  });

  it("set() persists an edited cap and notifies subscribers", () => {
    const storage = inMemoryStorage();
    const store = createGuardrailsSettings({ storage });
    const seen = vi.fn();
    store.subscribe(seen);
    store.set({ tier2_max: 30 });
    expect(store.get().tier2_max).toBe(30);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(createGuardrailsSettings({ storage }).get().tier2_max).toBe(30);
  });

  it("keeps the other caps untouched when one is edited", () => {
    const store = createGuardrailsSettings({ storage: inMemoryStorage() });
    store.set({ tier2_max: 30 });
    store.set({ overall_max: 50 });
    expect(store.get()).toEqual({ tier2_max: 30, tier3_max: 0, overall_max: 50 });
  });

  it("clears the override when set to 0", () => {
    const store = createGuardrailsSettings({ storage: inMemoryStorage() });
    store.set({ tier2_max: 30 });
    store.set({ tier2_max: 0 });
    expect(store.get().tier2_max).toBe(0);
  });

  it("keeps the current cap when handed a negative, fractional, over-max, or NaN value", () => {
    const store = createGuardrailsSettings({ storage: inMemoryStorage() });
    store.set({ tier2_max: 30 });
    for (const bad of [-5, 4.5, RATE_LIMIT_MAX + 1, Number.NaN]) {
      store.set({ tier2_max: bad });
      expect(store.get().tier2_max).toBe(30);
    }
    store.set({ tier2_max: RATE_LIMIT_MAX });
    expect(store.get().tier2_max).toBe(RATE_LIMIT_MAX);
  });

  it("sanitizes a garbage stored value into no override", () => {
    const store = createGuardrailsSettings({
      storage: inMemoryStorage({
        tier2_max: -1,
        tier3_max: 3,
        overall_max: 0,
      } as RateLimitOverrides),
    });
    expect(store.get()).toEqual({ tier2_max: 0, tier3_max: 3, overall_max: 0 });
  });

  it("reloadFromStorage adopts another window's edit", () => {
    const storage = inMemoryStorage();
    const store = createGuardrailsSettings({ storage });
    storage.save({ tier2_max: 18, tier3_max: 0, overall_max: 0 });
    store.reloadFromStorage();
    expect(store.get().tier2_max).toBe(18);
  });
});

describe("guardrails settings — store over config", () => {
  it("keeps the config default for every cap left unset", () => {
    const base = baseConfig();
    const merged = mergeGuardrails(base, { tier2_max: 0, tier3_max: 0, overall_max: 0 });
    expect(merged.rate_limit).toEqual(base.rate_limit);
  });

  it("overrides the config default with the stored cap", () => {
    const merged = mergeGuardrails(baseConfig(), {
      tier2_max: 30,
      tier3_max: 5,
      overall_max: 60,
    });
    expect(merged.rate_limit.tier2_max).toBe(30);
    expect(merged.rate_limit.tier3_max).toBe(5);
    expect(merged.rate_limit.overall_max).toBe(60);
  });

  it("leaves window_ms / cooldown_ms / debounce_ms / attachments untouched", () => {
    const base = baseConfig();
    const merged = mergeGuardrails(base, { tier2_max: 30, tier3_max: 0, overall_max: 0 });
    expect(merged.rate_limit.window_ms).toBe(base.rate_limit.window_ms);
    expect(merged.rate_limit.cooldown_ms).toBe(base.rate_limit.cooldown_ms);
    expect(merged.debounce_ms).toEqual(base.debounce_ms);
    expect(merged.attachments).toEqual(base.attachments);
  });

  it("projects the config caps onto the overrides shape, dropping the non-editable values", () => {
    expect(rateLimitDefaultsFromConfig(baseConfig())).toEqual({
      tier2_max: 24,
      tier3_max: 2,
      overall_max: 40,
    });
  });

  it("never mutates the config it layers onto", () => {
    const base = baseConfig();
    mergeGuardrails(base, { tier2_max: 30, tier3_max: 5, overall_max: 60 });
    expect(base.rate_limit.tier2_max).toBe(24);
    expect(base.rate_limit.overall_max).toBe(40);
  });
});
