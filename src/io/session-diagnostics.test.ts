/**
 * session-diagnostics.test.ts — TDD red for the cross-window diagnostics store.
 *
 * Pins the contract for src/io/session-diagnostics.ts:
 *   createSessionDiagnosticsStore(storage?)
 *     → { get, setUsage, setLastCompression, clear, subscribe, reloadFromStorage, dispose }
 *   localStorageSessionDiagnosticsStorage(key?) localStorage adapter
 *
 * Mirrors endpoints-settings idioms: notify only on actual change, coerce junk
 * to defaults, the `at` timestamp is passed in (store never calls new Date()).
 */

import { describe, it, expect, vi } from "vitest";
import {
  createSessionDiagnosticsStore,
  localStorageSessionDiagnosticsStorage,
} from "./session-diagnostics";
import type {
  SessionDiagnostics,
  SessionDiagnosticsStorage,
} from "./session-diagnostics";

const DEFAULTS: SessionDiagnostics = {
  usedTokens: null,
  contextWindow: null,
  lastCompression: null,
};

function makeMemStorage(): SessionDiagnosticsStorage & {
  _data: SessionDiagnostics | null;
} {
  let data: SessionDiagnostics | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: SessionDiagnostics | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(s) {
      data = JSON.parse(JSON.stringify(s)) as SessionDiagnostics;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// defaults + load coercion
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionDiagnosticsStore — defaults", () => {
  it("returns defaults when no storage is given", () => {
    const store = createSessionDiagnosticsStore();
    expect(store.get()).toEqual(DEFAULTS);
  });

  it("get() returns a copy, not the internal reference", () => {
    const store = createSessionDiagnosticsStore();
    expect(store.get()).not.toBe(store.get());
    expect(store.get()).toEqual(store.get());
  });

  it("loads valid stored diagnostics", () => {
    const storage = makeMemStorage();
    storage._data = {
      usedTokens: 1234,
      contextWindow: 200_000,
      lastCompression: { beforeTokens: 1000, afterTokens: 400, removed: 600, at: "2026-06-09T00:00:00Z" },
    };
    const store = createSessionDiagnosticsStore(storage);
    expect(store.get()).toEqual(storage._data);
  });

  it("coerces junk shape in storage to defaults", () => {
    const storage: SessionDiagnosticsStorage = {
      load: () => ({ usedTokens: "nope", contextWindow: {}, lastCompression: 7 } as unknown as SessionDiagnostics),
      save: vi.fn(),
    };
    const store = createSessionDiagnosticsStore(storage);
    expect(store.get()).toEqual(DEFAULTS);
  });

  it("coerces a partial/garbage lastCompression to null", () => {
    const storage: SessionDiagnosticsStorage = {
      load: () =>
        ({
          usedTokens: 10,
          contextWindow: 100,
          lastCompression: { beforeTokens: 5 }, // missing fields
        }) as unknown as SessionDiagnostics,
      save: vi.fn(),
    };
    const store = createSessionDiagnosticsStore(storage);
    expect(store.get()).toEqual({ usedTokens: 10, contextWindow: 100, lastCompression: null });
  });

  it("storage.load() returning null falls back to defaults", () => {
    const storage: SessionDiagnosticsStorage = { load: () => null, save: vi.fn() };
    const store = createSessionDiagnosticsStore(storage);
    expect(store.get()).toEqual(DEFAULTS);
  });

  it("storage.load() throwing falls back to defaults", () => {
    const storage: SessionDiagnosticsStorage = {
      load: () => {
        throw new Error("boom");
      },
      save: vi.fn(),
    };
    const store = createSessionDiagnosticsStore(storage);
    expect(store.get()).toEqual(DEFAULTS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setUsage
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionDiagnosticsStore — setUsage", () => {
  it("updates usedTokens + contextWindow and notifies with a fresh copy", () => {
    const store = createSessionDiagnosticsStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setUsage(1500, 200_000);
    expect(store.get()).toEqual({ usedTokens: 1500, contextWindow: 200_000, lastCompression: null });
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0]).toEqual(store.get());
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("accepts null contextWindow (unknown max)", () => {
    const store = createSessionDiagnosticsStore();
    store.setUsage(900, null);
    expect(store.get()).toEqual({ usedTokens: 900, contextWindow: null, lastCompression: null });
  });

  it("persists via storage.save", () => {
    const storage = makeMemStorage();
    const store = createSessionDiagnosticsStore(storage);
    store.setUsage(42, 200_000);
    expect(storage._data).toEqual({ usedTokens: 42, contextWindow: 200_000, lastCompression: null });
  });

  it("does not clobber lastCompression", () => {
    const store = createSessionDiagnosticsStore();
    store.setLastCompression({ beforeTokens: 100, afterTokens: 40, removed: 60, at: "t" });
    store.setUsage(7, 200_000);
    expect(store.get().lastCompression).toEqual({ beforeTokens: 100, afterTokens: 40, removed: 60, at: "t" });
  });

  it("identical values are a no-op (no save, no notify)", () => {
    const storage = makeMemStorage();
    const store = createSessionDiagnosticsStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    store.setUsage(100, 200_000);
    store.setUsage(100, 200_000);
    expect(cb).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setLastCompression
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionDiagnosticsStore — setLastCompression", () => {
  it("stores the entry, persists, and notifies", () => {
    const storage = makeMemStorage();
    const store = createSessionDiagnosticsStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    const entry = { beforeTokens: 1000, afterTokens: 400, removed: 600, at: "2026-06-09T12:00:00Z" };
    store.setLastCompression(entry);
    expect(store.get().lastCompression).toEqual(entry);
    expect(storage._data?.lastCompression).toEqual(entry);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("uses the caller-supplied `at` timestamp verbatim", () => {
    const store = createSessionDiagnosticsStore();
    store.setLastCompression({ beforeTokens: 1, afterTokens: 1, removed: 0, at: "FIXED-ISO" });
    expect(store.get().lastCompression?.at).toBe("FIXED-ISO");
  });

  it("identical entry is a no-op (no notify)", () => {
    const store = createSessionDiagnosticsStore();
    const cb = vi.fn();
    store.subscribe(cb);
    const entry = { beforeTokens: 1, afterTokens: 1, removed: 0, at: "x" };
    store.setLastCompression(entry);
    store.setLastCompression({ ...entry });
    expect(cb).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clear
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionDiagnosticsStore — clear", () => {
  it("resets to defaults, persists, and notifies", () => {
    const storage = makeMemStorage();
    const store = createSessionDiagnosticsStore(storage);
    store.setUsage(500, 200_000);
    const cb = vi.fn();
    store.subscribe(cb);
    store.clear();
    expect(store.get()).toEqual(DEFAULTS);
    expect(storage._data).toEqual(DEFAULTS);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("is a no-op when already at defaults", () => {
    const storage = makeMemStorage();
    const store = createSessionDiagnosticsStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    store.clear();
    expect(cb).not.toHaveBeenCalled();
    expect(storage._data).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionDiagnosticsStore — reloadFromStorage", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = makeMemStorage();
    const store = createSessionDiagnosticsStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = { usedTokens: 999, contextWindow: 200_000, lastCompression: null };
    store.reloadFromStorage();
    expect(store.get().usedTokens).toBe(999);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("coerces invalid externally-changed values on reload", () => {
    const storage = makeMemStorage();
    const store = createSessionDiagnosticsStore(storage);
    storage._data = { usedTokens: "bad" } as unknown as SessionDiagnostics;
    store.reloadFromStorage();
    expect(store.get()).toEqual(DEFAULTS);
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createSessionDiagnosticsStore(storage);
    store.setUsage(10, 200_000);
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createSessionDiagnosticsStore();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load() returns null", () => {
    const storage = makeMemStorage();
    const store = createSessionDiagnosticsStore(storage);
    store.setUsage(10, 200_000);
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = null;
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionDiagnosticsStore — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createSessionDiagnosticsStore();
    const cb = vi.fn();
    const off = store.subscribe(cb);
    off();
    store.setUsage(1, 2);
    expect(cb).not.toHaveBeenCalled();
  });

  it("dispose stops all notifications", () => {
    const store = createSessionDiagnosticsStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.setUsage(1, 2);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageSessionDiagnosticsStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageSessionDiagnosticsStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };
    const adapter = localStorageSessionDiagnosticsStorage();
    const value: SessionDiagnostics = {
      usedTokens: 7,
      contextWindow: 200_000,
      lastCompression: { beforeTokens: 9, afterTokens: 3, removed: 6, at: "iso" },
    };
    adapter.save(value);
    expect(adapter.load()).toEqual(value);
    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.session_diagnostics'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };
    const adapter = localStorageSessionDiagnosticsStorage();
    adapter.save(DEFAULTS);
    expect(written[0][0]).toBe("yui.session_diagnostics");
    delete (globalThis as any).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };
    const adapter = localStorageSessionDiagnosticsStorage("my.diag");
    adapter.save(DEFAULTS);
    expect(written[0][0]).toBe("my.diag");
    delete (globalThis as any).localStorage;
  });

  it("JSON parse failure returns null", () => {
    (globalThis as any).localStorage = {
      getItem: () => "{not json",
      setItem: () => {},
    };
    const adapter = localStorageSessionDiagnosticsStorage();
    expect(adapter.load()).toBeNull();
    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;
    const adapter = localStorageSessionDiagnosticsStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save(DEFAULTS)).not.toThrow();
    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});
