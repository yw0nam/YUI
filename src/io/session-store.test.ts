/**
 * session-store.test.ts — single-scalar last-response-id reactive store.
 *
 * Pins the contract for src/io/session-store.ts:
 *   createSessionStore(storage?) store (get/set/clear/reloadFromStorage/subscribe/dispose)
 *   localStorageSessionStorage(key?) localStorage adapter
 *   get() returns the stored response id or null (no minting, no side effects).
 */

import { describe, expect, it, vi } from "vitest";
import type { SessionStorage } from "./session-store";
import { createSessionStore, localStorageSessionStorage } from "./session-store";

function makeMemStorage(initial: string | null = null): SessionStorage & {
  _data: string | null;
} {
  let data: string | null = initial;
  return {
    get _data() {
      return data;
    },
    set _data(v: string | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(id: string) {
      data = id;
    },
    clear() {
      data = null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// get — read-only, null when empty
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — get", () => {
  it("returns null when nothing is stored", () => {
    const store = createSessionStore(makeMemStorage());
    expect(store.get()).toBeNull();
  });

  it("has no save/notify side effect on an empty store", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createSessionStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    expect(store.get()).toBeNull();
    expect(storage._data).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it("returns a stored response id", () => {
    const store = createSessionStore(makeMemStorage("resp_seed"));
    expect(store.get()).toBe("resp_seed");
  });

  it("returns null when no storage at all", () => {
    const store = createSessionStore();
    expect(store.get()).toBeNull();
  });

  it("treats non-string stored junk as absent (null)", () => {
    const storage = makeMemStorage(42 as unknown as string);
    const store = createSessionStore(storage);
    expect(store.get()).toBeNull();
  });

  it("treats empty/whitespace stored value as absent (null)", () => {
    const store = createSessionStore(makeMemStorage("   "));
    expect(store.get()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// set — persist + notify only on change
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — set", () => {
  it("set then get returns the value", () => {
    const store = createSessionStore(makeMemStorage());
    store.set("resp_x");
    expect(store.get()).toBe("resp_x");
  });

  it("persists the new id and notifies", () => {
    const storage = makeMemStorage("resp_a");
    const store = createSessionStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    store.set("resp_b");
    expect(store.get()).toBe("resp_b");
    expect(storage._data).toBe("resp_b");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith("resp_b");
  });

  it("ignores empty / whitespace / non-string values", () => {
    const store = createSessionStore(makeMemStorage("resp_keep"));
    store.set("");
    store.set("   ");
    store.set(123 as unknown as string);
    expect(store.get()).toBe("resp_keep");
  });

  it("is a no-op when setting the same value (no save, no notify)", () => {
    const storage = makeMemStorage("resp_same");
    const saveSpy = vi.spyOn(storage, "save");
    const store = createSessionStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    store.set("resp_same");
    expect(cb).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clear — drop to null
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — clear", () => {
  it("drops the stored id and get() returns null", () => {
    const storage = makeMemStorage("resp_drop");
    const store = createSessionStore(storage);
    store.clear();
    expect(store.get()).toBeNull();
    expect(storage._data).toBeNull();
  });

  it("notifies subscribers on clear (with null)", () => {
    const store = createSessionStore(makeMemStorage("resp_drop"));
    const cb = vi.fn();
    store.subscribe(cb);
    store.clear();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(null);
  });

  it("is a no-op when already empty (no notify)", () => {
    const store = createSessionStore(makeMemStorage());
    const cb = vi.fn();
    store.subscribe(cb);
    store.clear();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage — pick up external changes
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — reloadFromStorage", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = makeMemStorage("resp_old");
    const store = createSessionStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = "resp_new";
    store.reloadFromStorage();

    expect(store.get()).toBe("resp_new");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith("resp_new");
  });

  it("identical stored value is a no-op (no notify)", () => {
    const storage = makeMemStorage("resp_keep");
    const store = createSessionStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = "resp_keep";
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("an external clear is picked up and notifies with null", () => {
    const storage = makeMemStorage("resp_keep");
    const store = createSessionStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = null;
    store.reloadFromStorage();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(null);
  });

  it("no-op when storage is absent", () => {
    const store = createSessionStore();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: SessionStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
      clear: vi.fn(),
    };
    const store = createSessionStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// persistence
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — persistence", () => {
  it("a store over storage already holding a seed returns it", () => {
    const store = createSessionStore(makeMemStorage("resp_seed"));
    expect(store.get()).toBe("resp_seed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createSessionStore(makeMemStorage());
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.set("resp_1");
    unsub();
    store.set("resp_2");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createSessionStore(makeMemStorage());
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.set("resp_3");
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageSessionStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageSessionStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
      removeItem: (k: string) => {
        delete fakeStore[k];
      },
    };

    const adapter = localStorageSessionStorage();
    adapter.save("resp_roundtrip");
    expect(adapter.load()).toBe("resp_roundtrip");
    adapter.clear();
    expect(adapter.load()).toBeNull();

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.previous_response_id'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => {},
    };

    const adapter = localStorageSessionStorage();
    adapter.save("x");
    expect(written[0][0]).toBe("yui.previous_response_id");

    delete (globalThis as any).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => {},
    };

    const adapter = localStorageSessionStorage("my.key");
    adapter.save("x");
    expect(written[0][0]).toBe("my.key");

    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null / no-ops when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;

    const adapter = localStorageSessionStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save("x")).not.toThrow();
    expect(() => adapter.clear()).not.toThrow();

    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});
