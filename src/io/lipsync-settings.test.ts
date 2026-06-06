/**
 * lipsync-settings.test.ts — TDD red for the lipsync gain reactive store.
 *
 * Pins the contract for src/io/lipsync-settings.ts:
 *   LIPSYNC_GAIN_MIN / MAX / DEFAULT constants
 *   createLipsyncSettings({ storage?, initial? }) store
 *   localStorageLipsyncStorage(key?) localStorage adapter
 */

import { describe, it, expect, vi } from "vitest";
import {
  LIPSYNC_GAIN_MIN,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_DEFAULT,
  createLipsyncSettings,
  localStorageLipsyncStorage,
} from "./lipsync-settings";
import type { LipsyncStorage, LipsyncSettings } from "./lipsync-settings";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe("lipsync-settings constants", () => {
  it("MIN is 0.5", () => {
    expect(LIPSYNC_GAIN_MIN).toBe(0.5);
  });

  it("MAX is 4.0", () => {
    expect(LIPSYNC_GAIN_MAX).toBe(4.0);
  });

  it("DEFAULT is 2.0", () => {
    expect(LIPSYNC_GAIN_DEFAULT).toBe(2.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createLipsyncSettings — defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createLipsyncSettings — defaults", () => {
  it("returns DEFAULT gain when no storage or initial given", () => {
    const store = createLipsyncSettings();
    expect(store.get().gain).toBe(LIPSYNC_GAIN_DEFAULT);
  });

  it("get() returns a copy, not the internal reference", () => {
    const store = createLipsyncSettings();
    const a = store.get();
    const b = store.get();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createLipsyncSettings — setGain + subscribers
// ─────────────────────────────────────────────────────────────────────────────

describe("createLipsyncSettings — setGain", () => {
  it("setGain(3) updates get().gain to 3", () => {
    const store = createLipsyncSettings();
    store.setGain(3);
    expect(store.get().gain).toBe(3);
  });

  it("setGain notifies subscribers with a fresh copy { gain: 3 }", () => {
    const store = createLipsyncSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setGain(3);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ gain: 3 });
    // must be a copy, not the internal state reference
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("clamps above MAX: setGain(10) → 4.0", () => {
    const store = createLipsyncSettings();
    store.setGain(10);
    expect(store.get().gain).toBe(4.0);
  });

  it("clamps below MIN: setGain(0.1) → 0.5", () => {
    const store = createLipsyncSettings();
    store.setGain(0.1);
    expect(store.get().gain).toBe(0.5);
  });

  it("clamps negative: setGain(-5) → 0.5", () => {
    const store = createLipsyncSettings();
    store.setGain(-5);
    expect(store.get().gain).toBe(0.5);
  });

  it("NaN is ignored — gain stays at DEFAULT and no notification", () => {
    const store = createLipsyncSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setGain(NaN);
    expect(store.get().gain).toBe(LIPSYNC_GAIN_DEFAULT);
    expect(cb).not.toHaveBeenCalled();
  });

  it("Infinity is ignored — gain stays at DEFAULT and no notification", () => {
    const store = createLipsyncSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setGain(Infinity);
    expect(store.get().gain).toBe(LIPSYNC_GAIN_DEFAULT);
    expect(cb).not.toHaveBeenCalled();
  });

  it("dedup: second setGain(3) after first does NOT notify again", () => {
    const store = createLipsyncSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setGain(3);
    store.setGain(3);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dedup: two clamped setGain(10) calls both resolve to 4.0, second does NOT notify", () => {
    const store = createLipsyncSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setGain(10);
    store.setGain(10);
    expect(store.get().gain).toBe(4.0);
    expect(cb).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createLipsyncSettings — subscribe / unsubscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createLipsyncSettings — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createLipsyncSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.setGain(3);
    unsub();
    store.setGain(1.5);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createLipsyncSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.setGain(3);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createLipsyncSettings — storage persistence
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): LipsyncStorage & { _data: LipsyncSettings | null } {
  let data: LipsyncSettings | null = null;
  return {
    get _data() {
      return data;
    },
    load() {
      return data;
    },
    save(s) {
      data = { ...s };
    },
  };
}

describe("createLipsyncSettings — persistence", () => {
  it("setGain calls storage.save with the new settings", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createLipsyncSettings({ storage });
    store.setGain(3.5);
    expect(saveSpy).toHaveBeenCalledWith({ gain: 3.5 });
  });

  it("a new store created with same storage loads the persisted gain", () => {
    const storage = makeMemStorage();
    const store1 = createLipsyncSettings({ storage });
    store1.setGain(3.5);

    const store2 = createLipsyncSettings({ storage });
    expect(store2.get().gain).toBe(3.5);
  });

  it("stored value out of range is clamped on load: {gain:99} → 4.0", () => {
    const storage: LipsyncStorage = {
      load: () => ({ gain: 99 }),
      save: vi.fn(),
    };
    const store = createLipsyncSettings({ storage });
    expect(store.get().gain).toBe(4.0);
  });

  it("stored invalid type {gain:'x'} falls back to DEFAULT", () => {
    const storage: LipsyncStorage = {
      load: () => ({ gain: "x" } as unknown as LipsyncSettings),
      save: vi.fn(),
    };
    const store = createLipsyncSettings({ storage });
    expect(store.get().gain).toBe(LIPSYNC_GAIN_DEFAULT);
  });

  it("storage.load() returning null falls back to DEFAULT", () => {
    const storage: LipsyncStorage = {
      load: () => null,
      save: vi.fn(),
    };
    const store = createLipsyncSettings({ storage });
    expect(store.get().gain).toBe(LIPSYNC_GAIN_DEFAULT);
  });

  it("stored > initial: storage value takes priority over initial option", () => {
    const storage: LipsyncStorage = {
      load: () => ({ gain: 3.5 }),
      save: vi.fn(),
    };
    const store = createLipsyncSettings({ storage, initial: { gain: 1.0 } });
    expect(store.get().gain).toBe(3.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createLipsyncSettings — initial option
// ─────────────────────────────────────────────────────────────────────────────

describe("createLipsyncSettings — initial option", () => {
  it("uses initial.gain when no storage is provided", () => {
    const store = createLipsyncSettings({ initial: { gain: 1.0 } });
    expect(store.get().gain).toBe(1.0);
  });

  it("uses initial.gain when storage returns null", () => {
    const storage: LipsyncStorage = { load: () => null, save: vi.fn() };
    const store = createLipsyncSettings({ storage, initial: { gain: 1.0 } });
    expect(store.get().gain).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageLipsyncStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageLipsyncStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };

    const adapter = localStorageLipsyncStorage();
    adapter.save({ gain: 2.5 });
    const loaded = adapter.load();
    expect(loaded).toEqual({ gain: 2.5 });

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.lipsync'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageLipsyncStorage();
    adapter.save({ gain: 1.0 });
    expect(written[0][0]).toBe("yui.lipsync");

    delete (globalThis as any).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageLipsyncStorage("my.key");
    adapter.save({ gain: 1.0 });
    expect(written[0][0]).toBe("my.key");

    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;

    const adapter = localStorageLipsyncStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save({ gain: 2.0 })).not.toThrow();

    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});
