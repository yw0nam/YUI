/**
 * persisted-store.test.ts — shared reactive settings-store core.
 *
 * Pins the contract for src/io/persisted-store.ts:
 *   localStorageStore<T>(key)  — generic localStorage adapter
 *   createPersistedStore<T>(cfg) — shared state/notify/reload/subscribe/dispose core
 *
 * The per-store files (vad/lipsync/camera/…) are built on top of this; their own
 * tests pin the typed setters. This file pins the shared machinery directly.
 */

import { describe, expect, it, vi } from "vitest";
import type { PersistedStorage } from "./persisted-store";
import { createPersistedStore, localStorageStore } from "./persisted-store";

interface Box {
  n: number;
}

const boxConfig = (storage?: PersistedStorage<Box>, initial?: Box) =>
  createPersistedStore<Box>({
    storage,
    initial,
    defaults: { n: 0 },
    parse: (v) =>
      v !== null && typeof v === "object" && typeof (v as Box).n === "number"
        ? { n: Math.min(100, Math.max(0, (v as Box).n)) } // clamp 0..100
        : null,
    equals: (a, b) => a.n === b.n,
  });

// ─────────────────────────────────────────────────────────────────────────────
// localStorageStore<T>
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageStore", () => {
  it("save writes JSON and load reads it back", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
    });
    const s = localStorageStore<Box>("k");
    s.save({ n: 7 });
    expect(JSON.parse(map.get("k")!)).toEqual({ n: 7 });
    expect(s.load()).toEqual({ n: 7 });
    vi.unstubAllGlobals();
  });

  it("load returns null when key absent", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    expect(localStorageStore<Box>("missing").load()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("load returns null on malformed JSON", () => {
    vi.stubGlobal("localStorage", { getItem: () => "{not json", setItem: () => {} });
    expect(localStorageStore<Box>("k").load()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("load swallows getItem throwing → null", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {},
    });
    expect(localStorageStore<Box>("k").load()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("save swallows setItem throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("boom");
      },
    });
    expect(() => localStorageStore<Box>("k").save({ n: 1 })).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("no-op gracefully when localStorage is undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    const s = localStorageStore<Box>("k");
    expect(s.load()).toBeNull();
    expect(() => s.save({ n: 1 })).not.toThrow();
    vi.unstubAllGlobals();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createPersistedStore<T> — bootstrap priority
// ─────────────────────────────────────────────────────────────────────────────

describe("createPersistedStore bootstrap", () => {
  it("stored > initial > defaults: stored wins", () => {
    const storage: PersistedStorage<Box> = { load: () => ({ n: 5 }), save: vi.fn() };
    const store = boxConfig(storage, { n: 9 });
    expect(store.get()).toEqual({ n: 5 });
  });

  it("initial wins when no stored value", () => {
    const storage: PersistedStorage<Box> = { load: () => null, save: vi.fn() };
    expect(boxConfig(storage, { n: 9 }).get()).toEqual({ n: 9 });
  });

  it("defaults when no storage and no initial", () => {
    expect(boxConfig().get()).toEqual({ n: 0 });
  });

  it("clamp/sanitize is applied to the stored value on load", () => {
    const storage: PersistedStorage<Box> = { load: () => ({ n: 999 }), save: vi.fn() };
    expect(boxConfig(storage).get()).toEqual({ n: 100 });
  });

  it("garbage stored value is rejected → falls back to defaults", () => {
    const storage: PersistedStorage<Box> = {
      load: () => ({ nope: true }) as unknown as Box,
      save: vi.fn(),
    };
    expect(boxConfig(storage).get()).toEqual({ n: 0 });
  });

  it("storage.load() throwing falls back to defaults", () => {
    const storage: PersistedStorage<Box> = {
      load: () => {
        throw new Error("boom");
      },
      save: vi.fn(),
    };
    expect(boxConfig(storage).get()).toEqual({ n: 0 });
  });

  it("migrate() supplies a value when parse rejects the stored shape", () => {
    const storage: PersistedStorage<Box> = {
      load: () => ({ legacy: 3 }) as unknown as Box,
      save: vi.fn(),
    };
    const store = createPersistedStore<Box>({
      storage,
      defaults: { n: 0 },
      parse: (v) =>
        v !== null && typeof v === "object" && typeof (v as Box).n === "number"
          ? { n: (v as Box).n }
          : null,
      migrate: (v) => {
        const legacy = (v as { legacy?: number } | null)?.legacy;
        return typeof legacy === "number" ? { n: legacy } : null;
      },
      equals: (a, b) => a.n === b.n,
    });
    expect(store.get()).toEqual({ n: 3 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// get() isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("createPersistedStore get()", () => {
  it("returns a copy — mutating it does not change the store", () => {
    const store = boxConfig();
    const a = store.get();
    a.n = 42;
    expect(store.get()).toEqual({ n: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// commit()
// ─────────────────────────────────────────────────────────────────────────────

describe("createPersistedStore commit()", () => {
  it("updates state, persists, and notifies on change", () => {
    const save = vi.fn();
    const store = boxConfig({ load: () => null, save });
    const cb = vi.fn();
    store.subscribe(cb);
    store.commit({ n: 3 });
    expect(store.get()).toEqual({ n: 3 });
    expect(save).toHaveBeenCalledWith({ n: 3 });
    expect(cb).toHaveBeenCalledWith({ n: 3 });
  });

  it("does not notify or persist when the value is unchanged (equals)", () => {
    const save = vi.fn();
    const store = boxConfig({ load: () => ({ n: 3 }), save });
    const cb = vi.fn();
    store.subscribe(cb);
    store.commit({ n: 3 });
    expect(save).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it("never throws when storage.save() throws; in-memory state is retained", () => {
    const store = boxConfig({
      load: () => null,
      save: () => {
        throw new Error("boom");
      },
    });
    expect(() => store.commit({ n: 5 })).not.toThrow();
    expect(store.get()).toEqual({ n: 5 });
  });

  it("delivers the same copy instance to every subscriber", () => {
    const store = boxConfig();
    let a: Box | undefined;
    let b: Box | undefined;
    store.subscribe((s) => (a = s));
    store.subscribe((s) => (b = s));
    store.commit({ n: 1 });
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage()
// ─────────────────────────────────────────────────────────────────────────────

describe("createPersistedStore reloadFromStorage()", () => {
  it("adopts a changed external value and notifies, without re-persisting", () => {
    let value: Box | null = { n: 1 };
    const save = vi.fn();
    const store = boxConfig({ load: () => value, save });
    const cb = vi.fn();
    store.subscribe(cb);
    value = { n: 8 };
    store.reloadFromStorage();
    expect(store.get()).toEqual({ n: 8 });
    expect(cb).toHaveBeenCalledWith({ n: 8 });
    expect(save).not.toHaveBeenCalled();
  });

  it("no-op when the reloaded value is unchanged", () => {
    const store = boxConfig({ load: () => ({ n: 2 }), save: vi.fn() });
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores garbage on reload", () => {
    let value: unknown = { n: 2 };
    const store = boxConfig({ load: () => value as Box, save: vi.fn() });
    const cb = vi.fn();
    store.subscribe(cb);
    value = { junk: 1 };
    store.reloadFromStorage();
    expect(store.get()).toEqual({ n: 2 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws on reload", () => {
    let throws = false;
    const store = boxConfig({
      load: () => {
        if (throws) throw new Error("boom");
        return { n: 2 };
      },
      save: vi.fn(),
    });
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(store.get()).toEqual({ n: 2 });
  });

  it("no-op without storage", () => {
    const store = boxConfig();
    expect(() => store.reloadFromStorage()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribe() / dispose()
// ─────────────────────────────────────────────────────────────────────────────

describe("createPersistedStore subscribe/dispose", () => {
  it("unsubscribe stops further notifications", () => {
    const store = boxConfig();
    const cb = vi.fn();
    const off = store.subscribe(cb);
    off();
    store.commit({ n: 1 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("dispose clears all subscribers", () => {
    const store = boxConfig();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.commit({ n: 1 });
    expect(cb).not.toHaveBeenCalled();
  });
});
