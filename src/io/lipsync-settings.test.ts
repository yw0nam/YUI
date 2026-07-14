/**
 * lipsync-settings.test.ts — lipsync gain reactive store.
 *
 * Pins the contract for src/io/lipsync-settings.ts:
 *   LIPSYNC_GAIN_MIN / MAX / DEFAULT constants
 *   createLipsyncSettings({ storage?, initial? }) store
 *   localStorageLipsyncStorage(key?) localStorage adapter
 */

import { describe, expect, it, vi } from "vitest";
import type { LipsyncSettings, LipsyncStorage } from "./lipsync-settings";
import {
  createLipsyncSettings,
  LIPSYNC_GAIN_DEFAULT,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
  localStorageLipsyncStorage,
} from "./lipsync-settings";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe("lipsync-settings constants", () => {
  it("MIN is 0.5", () => {
    expect(LIPSYNC_GAIN_MIN).toBe(0.5);
  });

  it("MAX is 6.0", () => {
    expect(LIPSYNC_GAIN_MAX).toBe(6.0);
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

  it("clamps above MAX: setGain(10) → 6.0", () => {
    const store = createLipsyncSettings();
    store.setGain(10);
    expect(store.get().gain).toBe(6.0);
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

  it("dedup: two clamped setGain(10) calls both resolve to 6.0, second does NOT notify", () => {
    const store = createLipsyncSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setGain(10);
    store.setGain(10);
    expect(store.get().gain).toBe(6.0);
    expect(cb).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createLipsyncSettings — subscribe / unsubscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// createLipsyncSettings — storage persistence
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): LipsyncStorage & { _data: LipsyncSettings | null } {
  let data: LipsyncSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: LipsyncSettings | null) {
      data = v;
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

  it("stored value out of range is clamped on load: {gain:99} → 6.0", () => {
    const storage: LipsyncStorage = {
      load: () => ({ gain: 99 }),
      save: vi.fn(),
    };
    const store = createLipsyncSettings({ storage });
    expect(store.get().gain).toBe(6.0);
  });

  it("stored invalid type {gain:'x'} falls back to DEFAULT", () => {
    const storage: LipsyncStorage = {
      load: () => ({ gain: "x" }) as unknown as LipsyncSettings,
      save: vi.fn(),
    };
    const store = createLipsyncSettings({ storage });
    expect(store.get().gain).toBe(LIPSYNC_GAIN_DEFAULT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createLipsyncSettings — reloadFromStorage (cross-window sync)
// ─────────────────────────────────────────────────────────────────────────────

describe("createLipsyncSettings — reloadFromStorage", () => {
  it("clamps an out-of-range stored value on reload", () => {
    const storage = makeMemStorage();
    const store = createLipsyncSettings({ storage });
    storage._data = { gain: 99 };
    store.reloadFromStorage();
    expect(store.get().gain).toBe(LIPSYNC_GAIN_MAX);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createLipsyncSettings — initial option
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// localStorageLipsyncStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageLipsyncStorage", () => {
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
});
