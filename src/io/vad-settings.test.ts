/**
 * vad-settings.test.ts — VAD silence-window reactive store.
 *
 * Pins the contract for src/io/vad-settings.ts:
 *   VAD_SILENCE_MIN / MAX / DEFAULT constants
 *   createVadSettings({ storage?, initial? }) store
 *   localStorageVadStorage(key?) localStorage adapter
 */

import { describe, expect, it, vi } from "vitest";
import type { VadSettings, VadStorage } from "./vad-settings";
import {
  createVadSettings,
  localStorageVadStorage,
  VAD_SILENCE_DEFAULT,
  VAD_SILENCE_MAX,
  VAD_SILENCE_MIN,
} from "./vad-settings";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe("vad-settings constants", () => {
  it("MIN is 500", () => {
    expect(VAD_SILENCE_MIN).toBe(500);
  });

  it("MAX is 3000", () => {
    expect(VAD_SILENCE_MAX).toBe(3000);
  });

  it("DEFAULT is 1500", () => {
    expect(VAD_SILENCE_DEFAULT).toBe(1500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createVadSettings — defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createVadSettings — defaults", () => {
  it("returns DEFAULT silenceMs when no storage or initial given", () => {
    const store = createVadSettings();
    expect(store.get().silenceMs).toBe(VAD_SILENCE_DEFAULT);
  });

  it("get() returns a copy, not the internal reference", () => {
    const store = createVadSettings();
    const a = store.get();
    const b = store.get();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createVadSettings — setSilenceMs + subscribers
// ─────────────────────────────────────────────────────────────────────────────

describe("createVadSettings — setSilenceMs", () => {
  it("setSilenceMs(2000) updates get().silenceMs to 2000", () => {
    const store = createVadSettings();
    store.setSilenceMs(2000);
    expect(store.get().silenceMs).toBe(2000);
  });

  it("setSilenceMs notifies subscribers with a fresh copy { silenceMs: 2000 }", () => {
    const store = createVadSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setSilenceMs(2000);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ silenceMs: 2000 });
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("clamps above MAX: setSilenceMs(9000) → 3000", () => {
    const store = createVadSettings();
    store.setSilenceMs(9000);
    expect(store.get().silenceMs).toBe(3000);
  });

  it("clamps below MIN: setSilenceMs(100) → 500", () => {
    const store = createVadSettings();
    store.setSilenceMs(100);
    expect(store.get().silenceMs).toBe(500);
  });

  it("clamps negative: setSilenceMs(-5) → 500", () => {
    const store = createVadSettings();
    store.setSilenceMs(-5);
    expect(store.get().silenceMs).toBe(500);
  });

  it("NaN is ignored — silenceMs stays at DEFAULT and no notification", () => {
    const store = createVadSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setSilenceMs(NaN);
    expect(store.get().silenceMs).toBe(VAD_SILENCE_DEFAULT);
    expect(cb).not.toHaveBeenCalled();
  });

  it("Infinity is ignored — silenceMs stays at DEFAULT and no notification", () => {
    const store = createVadSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setSilenceMs(Infinity);
    expect(store.get().silenceMs).toBe(VAD_SILENCE_DEFAULT);
    expect(cb).not.toHaveBeenCalled();
  });

  it("dedup: second setSilenceMs(2000) after first does NOT notify again", () => {
    const store = createVadSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setSilenceMs(2000);
    store.setSilenceMs(2000);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dedup: two clamped setSilenceMs(9000) calls both resolve to 3000, second does NOT notify", () => {
    const store = createVadSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setSilenceMs(9000);
    store.setSilenceMs(9000);
    expect(store.get().silenceMs).toBe(3000);
    expect(cb).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createVadSettings — subscribe / unsubscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createVadSettings — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createVadSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.setSilenceMs(2000);
    unsub();
    store.setSilenceMs(1000);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createVadSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.setSilenceMs(2000);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createVadSettings — storage persistence
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): VadStorage & { _data: VadSettings | null } {
  let data: VadSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: VadSettings | null) {
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

describe("createVadSettings — persistence", () => {
  it("setSilenceMs calls storage.save with the new settings", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createVadSettings({ storage });
    store.setSilenceMs(2500);
    expect(saveSpy).toHaveBeenCalledWith({ silenceMs: 2500 });
  });

  it("a new store created with same storage loads the persisted silenceMs", () => {
    const storage = makeMemStorage();
    const store1 = createVadSettings({ storage });
    store1.setSilenceMs(2500);

    const store2 = createVadSettings({ storage });
    expect(store2.get().silenceMs).toBe(2500);
  });

  it("stored value out of range is clamped on load: {silenceMs:99000} → 3000", () => {
    const storage: VadStorage = {
      load: () => ({ silenceMs: 99000 }),
      save: vi.fn(),
    };
    const store = createVadSettings({ storage });
    expect(store.get().silenceMs).toBe(3000);
  });

  it("stored invalid type {silenceMs:'x'} falls back to DEFAULT", () => {
    const storage: VadStorage = {
      load: () => ({ silenceMs: "x" }) as unknown as VadSettings,
      save: vi.fn(),
    };
    const store = createVadSettings({ storage });
    expect(store.get().silenceMs).toBe(VAD_SILENCE_DEFAULT);
  });

  it("storage.load() returning null falls back to DEFAULT", () => {
    const storage: VadStorage = {
      load: () => null,
      save: vi.fn(),
    };
    const store = createVadSettings({ storage });
    expect(store.get().silenceMs).toBe(VAD_SILENCE_DEFAULT);
  });

  it("stored > initial: storage value takes priority over initial option", () => {
    const storage: VadStorage = {
      load: () => ({ silenceMs: 2500 }),
      save: vi.fn(),
    };
    const store = createVadSettings({ storage, initial: { silenceMs: 800 } });
    expect(store.get().silenceMs).toBe(2500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createVadSettings — reloadFromStorage (cross-window sync)
// ─────────────────────────────────────────────────────────────────────────────

describe("createVadSettings — reloadFromStorage", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = makeMemStorage();
    const store = createVadSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { silenceMs: 2500 };
    store.reloadFromStorage();

    expect(store.get().silenceMs).toBe(2500);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ silenceMs: 2500 });
  });

  it("clamps an out-of-range stored value on reload", () => {
    const storage = makeMemStorage();
    const store = createVadSettings({ storage });
    storage._data = { silenceMs: 99000 };
    store.reloadFromStorage();
    expect(store.get().silenceMs).toBe(VAD_SILENCE_MAX);
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createVadSettings({ storage });
    store.setSilenceMs(2000);
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores invalid stored value on reload (no notify)", () => {
    const storage = makeMemStorage();
    const store = createVadSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = { silenceMs: "x" } as unknown as VadSettings;
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageVadStorage — adapter
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageVadStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };

    const adapter = localStorageVadStorage();
    adapter.save({ silenceMs: 2200 });
    expect(adapter.load()).toEqual({ silenceMs: 2200 });

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("default key is 'yui.vad'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageVadStorage();
    adapter.save({ silenceMs: 1500 });
    expect(written[0][0]).toBe("yui.vad");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
