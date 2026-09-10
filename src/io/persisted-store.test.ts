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
import {
  applyPositiveOverrides,
  createClampedIntSettings,
  createFlagSettings,
  createOverrideRecordSettings,
  createPersistedStore,
  localStorageStore,
  projectOverrides,
} from "./persisted-store";

interface Box {
  n: number;
}

const boxConfig = (storage?: PersistedStorage<Box>) =>
  createPersistedStore<Box>({
    storage,
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
  it("stored > defaults: stored wins", () => {
    const storage: PersistedStorage<Box> = { load: () => ({ n: 5 }), save: vi.fn() };
    expect(boxConfig(storage).get()).toEqual({ n: 5 });
  });

  it("defaults when no storage", () => {
    expect(boxConfig().get()).toEqual({ n: 0 });
  });

  it("defaults when storage holds no value", () => {
    const storage: PersistedStorage<Box> = { load: () => null, save: vi.fn() };
    expect(boxConfig(storage).get()).toEqual({ n: 0 });
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

describe("createFlagSettings", () => {
  it("uses the configured default", () => {
    expect(createFlagSettings(true).get()).toEqual({ enabled: true });
  });

  it("rejects malformed stored values and falls back to the default", () => {
    const storage: PersistedStorage<{ enabled: boolean }> = {
      load: () => ({ enabled: "yes" }) as unknown as { enabled: boolean },
      save: vi.fn(),
    };
    expect(createFlagSettings(false, { storage }).get()).toEqual({ enabled: false });
  });

  it("persists and notifies when setEnabled changes the value", () => {
    const save = vi.fn();
    const store = createFlagSettings(false, { storage: { load: () => null, save } });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true);

    expect(store.get()).toEqual({ enabled: true });
    expect(save).toHaveBeenCalledWith({ enabled: true });
    expect(cb).toHaveBeenCalledWith({ enabled: true });
  });

  it("does not persist or notify when setEnabled receives the current value", () => {
    const save = vi.fn();
    const store = createFlagSettings(true, { storage: { load: () => null, save } });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true);

    expect(save).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it("uses stored over default", () => {
    const storage: PersistedStorage<{ enabled: boolean }> = {
      load: () => ({ enabled: true }),
      save: vi.fn(),
    };
    expect(createFlagSettings(false, { storage }).get()).toEqual({ enabled: true });
  });

  it("uses the default when a stored value is malformed", () => {
    const load = vi.fn(() => ({ enabled: 1 }) as unknown as { enabled: boolean });
    const storage: PersistedStorage<{ enabled: boolean }> = { load, save: vi.fn() };
    expect(createFlagSettings(false, { storage }).get()).toEqual({ enabled: false });
    expect(load).toHaveBeenCalled();
  });
});

describe("createClampedIntSettings", () => {
  const cfg = { default: 10, floor: 1, ceil: 50 };

  it("uses the configured default", () => {
    expect(createClampedIntSettings(cfg).get()).toEqual({ value: 10 });
  });

  it("rejects malformed stored values and falls back to the default", () => {
    const storage: PersistedStorage<{ value: number }> = {
      load: () => ({ value: 1.5 }),
      save: vi.fn(),
    };
    expect(createClampedIntSettings(cfg, { storage }).get()).toEqual({ value: 10 });
  });

  it("persists and notifies when set changes the value", () => {
    const save = vi.fn();
    const store = createClampedIntSettings(cfg, { storage: { load: () => null, save } });
    const cb = vi.fn();
    store.subscribe(cb);

    store.set(20);

    expect(store.get()).toEqual({ value: 20 });
    expect(save).toHaveBeenCalledWith({ value: 20 });
    expect(cb).toHaveBeenCalledWith({ value: 20 });
  });

  it("does not persist or notify when set receives the current value", () => {
    const save = vi.fn();
    const store = createClampedIntSettings(cfg, { storage: { load: () => null, save } });
    const cb = vi.fn();
    store.subscribe(cb);

    store.set(10);

    expect(save).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it.each([
    1.5,
    0,
    51,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("ignores invalid setter input %s", (value) => {
    const save = vi.fn();
    const store = createClampedIntSettings(cfg, { storage: { load: () => null, save } });
    const cb = vi.fn();
    store.subscribe(cb);

    store.set(value);

    expect(store.get()).toEqual({ value: 10 });
    expect(save).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it("uses stored over default", () => {
    const storage: PersistedStorage<{ value: number }> = {
      load: () => ({ value: 30 }),
      save: vi.fn(),
    };
    expect(createClampedIntSettings(cfg, { storage }).get()).toEqual({ value: 30 });
  });

  it("uses the default when a stored value is above the ceiling", () => {
    const load = vi.fn(() => ({ value: 60 }));
    const storage: PersistedStorage<{ value: number }> = { load, save: vi.fn() };
    expect(createClampedIntSettings(cfg, { storage }).get()).toEqual({ value: 10 });
    expect(load).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createOverrideRecordSettings — flat record of per-key overrides
// ─────────────────────────────────────────────────────────────────────────────

interface Caps {
  small: number;
  big: number;
}

const CAPS_EMPTY: Caps = { small: 0, big: 0 };
const CEILING: Record<keyof Caps, number> = { small: 10, big: 1000 };

/** Validating accept: an out-of-range value is rejected, so the current one stays. */
function acceptCap<K extends keyof Caps>(key: K, v: unknown): Caps[K] | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= CEILING[key]
    ? (v as Caps[K])
    : undefined;
}

function capsStore(storage?: PersistedStorage<Caps>) {
  return createOverrideRecordSettings<Caps>({ storage, empty: CAPS_EMPTY, accept: acceptCap });
}

function memStorage<T>(initial: T | null = null): PersistedStorage<T> & { value: T | null } {
  return {
    value: initial,
    load() {
      return this.value;
    },
    save(s) {
      this.value = s;
    },
  };
}

describe("createOverrideRecordSettings", () => {
  it("defaults to the empty value for every key", () => {
    expect(capsStore().get()).toEqual(CAPS_EMPTY);
  });

  it("set() persists one key, notifies once, and leaves the others alone", () => {
    const storage = memStorage<Caps>();
    const store = capsStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);

    store.set({ small: 4 });

    expect(store.get()).toEqual({ small: 4, big: 0 });
    expect(storage.value).toEqual({ small: 4, big: 0 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setting the empty value clears an override", () => {
    const store = capsStore(memStorage<Caps>());
    store.set({ small: 4 });
    store.set({ small: 0 });
    expect(store.get().small).toBe(0);
  });

  it("a value the accept fn rejects keeps the current one, without persisting or notifying", () => {
    const storage = memStorage<Caps>();
    const store = capsStore(storage);
    store.set({ small: 4 });
    const cb = vi.fn();
    store.subscribe(cb);

    for (const bad of [-1, 2.5, 11, Number.NaN, "3"]) {
      store.set({ small: bad as number });
      expect(store.get().small).toBe(4);
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it("applies each key's own ceiling", () => {
    const store = capsStore();
    store.set({ small: 11, big: 11 });
    expect(store.get()).toEqual({ small: 0, big: 11 });
  });

  it("a key absent from the partial is left untouched", () => {
    const store = capsStore();
    store.set({ small: 4 });
    store.set({ big: 900 });
    expect(store.get()).toEqual({ small: 4, big: 900 });
  });

  it("sanitizes a stored value the accept fn rejects into the empty value", () => {
    const storage = memStorage<Caps>({ small: 999, big: 500 });
    expect(capsStore(storage).get()).toEqual({ small: 0, big: 500 });
  });

  it("rejects a non-object stored value wholesale", () => {
    const storage = memStorage<Caps>("garbage" as unknown as Caps);
    expect(capsStore(storage).get()).toEqual(CAPS_EMPTY);
  });

  it("reloadFromStorage adopts another window's edit", () => {
    const storage = memStorage<Caps>();
    const store = capsStore(storage);
    storage.value = { small: 7, big: 0 };
    store.reloadFromStorage();
    expect(store.get().small).toBe(7);
  });

  it("reloadFromStorage ignores a corrupted stored value and keeps the in-memory one", () => {
    const storage = memStorage<Caps>();
    const store = capsStore(storage);
    store.set({ small: 4 });
    storage.value = "garbage" as unknown as Caps;
    store.reloadFromStorage();
    expect(store.get().small).toBe(4);
  });

  it("a coercing accept fn rewrites an invalid value instead of keeping the current one", () => {
    const store = createOverrideRecordSettings<{ name: string }>({
      empty: { name: "" },
      accept: (_key, v) => (typeof v === "string" ? v.slice(0, 3) : ""),
    });
    store.set({ name: "abcdef" });
    expect(store.get().name).toBe("abc");
    store.set({ name: 7 as unknown as string });
    expect(store.get().name).toBe("");
  });

  it("the unsubscribe fn stops notifications and dispose stops every subscriber", () => {
    const store = capsStore();
    const cb = vi.fn();
    const off = store.subscribe(cb);
    store.set({ small: 1 });
    off();
    store.set({ small: 2 });
    expect(cb).toHaveBeenCalledTimes(1);

    const other = vi.fn();
    store.subscribe(other);
    store.dispose();
    store.set({ small: 3 });
    expect(other).not.toHaveBeenCalled();
  });

  it("get() returns a copy, not the internal state", () => {
    const store = capsStore();
    const a = store.get();
    a.small = 9;
    expect(store.get().small).toBe(0);
  });
});

describe("applyPositiveOverrides", () => {
  it("layers positive values onto a copy, leaving the base untouched", () => {
    const base = { small: 3, big: 30, other: 7 };
    const merged = applyPositiveOverrides(base, { small: 5, big: 0 }, ["small", "big"]);
    expect(merged).toEqual({ small: 5, big: 30, other: 7 });
    expect(base.small).toBe(3);
  });

  it("a zero override keeps the base value", () => {
    expect(applyPositiveOverrides({ a: 4 }, { a: 0 }, ["a"])).toEqual({ a: 4 });
  });

  it("a key outside the list is never read, so it cannot reach the merged config", () => {
    const merged = applyPositiveOverrides({ a: 1, b: 2 }, { a: 5, b: 9 }, ["a"]);
    expect(merged).toEqual({ a: 5, b: 2 });
  });
});

describe("projectOverrides", () => {
  it("reads every key of the empty shape through the reader", () => {
    const source = { small: 3, big: 30, extra: 99 };
    expect(projectOverrides(CAPS_EMPTY, (key) => source[key])).toEqual({ small: 3, big: 30 });
  });
});
