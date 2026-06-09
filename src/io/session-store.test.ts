/**
 * session-store.test.ts — TDD red for the single-scalar Hermes session-id reactive store.
 *
 * Pins the contract for src/io/session-store.ts:
 *   createSessionStore(storage?) store (get/set/clear/reloadFromStorage/subscribe/dispose)
 *   localStorageSessionStorage(key?) localStorage adapter
 *   get() mints + persists a UUID on first access; never returns empty.
 */

import { describe, it, expect, vi } from "vitest";
import { createSessionStore, localStorageSessionStorage } from "./session-store";
import type { SessionStorage } from "./session-store";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
// get — mint on first access
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — get mints on first access", () => {
  it("mints a v4-shaped UUID when nothing is stored", () => {
    const store = createSessionStore(makeMemStorage());
    expect(store.get()).toMatch(UUID_V4);
  });

  it("persists the freshly minted id to storage", () => {
    const storage = makeMemStorage();
    const store = createSessionStore(storage);
    const id = store.get();
    expect(storage._data).toBe(id);
  });

  it("subsequent get() returns the same id without re-minting", () => {
    const storage = makeMemStorage();
    const store = createSessionStore(storage);
    const first = store.get();
    const second = store.get();
    expect(second).toBe(first);
  });

  it("returns a stored id without minting a new one", () => {
    const store = createSessionStore(makeMemStorage("11111111-1111-4111-8111-111111111111"));
    expect(store.get()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("never returns empty even with no storage at all", () => {
    const store = createSessionStore();
    expect(store.get()).toMatch(UUID_V4);
    expect(store.get()).toBe(store.get());
  });

  it("treats non-string stored junk as absent and mints", () => {
    const storage = makeMemStorage(42 as unknown as string);
    const store = createSessionStore(storage);
    expect(store.get()).toMatch(UUID_V4);
  });

  it("treats empty/whitespace stored value as absent and mints", () => {
    const store = createSessionStore(makeMemStorage("   "));
    expect(store.get()).toMatch(UUID_V4);
  });

  it("notifies subscribers when get() mints a new id", () => {
    const store = createSessionStore(makeMemStorage());
    const cb = vi.fn();
    store.subscribe(cb);
    const id = store.get();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// set — persist + notify only on change
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — set", () => {
  it("persists the new id and notifies", () => {
    const storage = makeMemStorage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const store = createSessionStore(storage);
    const cb = vi.fn();
    store.subscribe(cb);
    store.set("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(store.get()).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(storage._data).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("is a no-op when setting the same value (no save, no notify)", () => {
    const storage = makeMemStorage("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const saveSpy = vi.spyOn(storage, "save");
    const store = createSessionStore(storage);
    store.get();
    const cb = vi.fn();
    store.subscribe(cb);
    store.set("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(cb).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("changes state for a subscriber added after the first get()", () => {
    const store = createSessionStore(makeMemStorage());
    const minted = store.get();
    const cb = vi.fn();
    store.subscribe(cb);
    store.set("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(cb).toHaveBeenCalledOnce();
    expect(minted).not.toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clear — drop + re-mint
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — clear", () => {
  it("drops the stored id", () => {
    const storage = makeMemStorage();
    const store = createSessionStore(storage);
    store.get();
    expect(storage._data).not.toBeNull();
    store.clear();
    expect(storage._data).toBeNull();
  });

  it("the next get() mints a NEW different id", () => {
    const store = createSessionStore(makeMemStorage());
    const first = store.get();
    store.clear();
    const second = store.get();
    expect(second).toMatch(UUID_V4);
    expect(second).not.toBe(first);
  });

  it("notifies subscribers on clear (with null)", () => {
    const store = createSessionStore(makeMemStorage());
    store.get();
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
    const storage = makeMemStorage();
    const store = createSessionStore(storage);
    store.get();
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    store.reloadFromStorage();

    expect(store.get()).toBe("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  });

  it("identical stored value is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createSessionStore(storage);
    const id = store.get();
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = id;
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("an external clear is picked up and notifies with null", () => {
    const storage = makeMemStorage();
    const store = createSessionStore(storage);
    store.get();
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
// subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createSessionStore — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createSessionStore(makeMemStorage());
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.set("11111111-1111-4111-8111-111111111111");
    unsub();
    store.set("22222222-2222-4222-8222-222222222222");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createSessionStore(makeMemStorage());
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.set("33333333-3333-4333-8333-333333333333");
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
    adapter.save("44444444-4444-4444-8444-444444444444");
    expect(adapter.load()).toBe("44444444-4444-4444-8444-444444444444");
    adapter.clear();
    expect(adapter.load()).toBeNull();

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.session_id'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => {},
    };

    const adapter = localStorageSessionStorage();
    adapter.save("x");
    expect(written[0][0]).toBe("yui.session_id");

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
