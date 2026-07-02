/**
 * presence-settings.test.ts — createPresenceSettings reactive store.
 *
 * Checks:
 *  - default: { present_max_idle_ms: 180000 }
 *  - setPresentMaxIdleMs: persists and round-trips; invalid values are no-ops
 *  - rejects values below PRESENCE_FLOOR_MS (10000)
 *  - rejects NaN
 *  - malformed/throwing storage → defaults
 *  - reloadFromStorage, subscribe/unsubscribe, dispose
 */

import { describe, expect, it, vi } from "vitest";
import {
  createPresenceSettings,
  type PresenceSettings,
  type PresenceStorage,
} from "./presence-settings";

function fakeStorage(
  initial?: PresenceSettings | null,
  opts?: { throwOnLoad?: boolean },
): PresenceStorage & { saved: PresenceSettings[] } {
  const saved: PresenceSettings[] = [];
  return {
    saved,
    load() {
      if (opts?.throwOnLoad) throw new Error("storage exploded");
      return initial ?? null;
    },
    save(s) {
      saved.push(s);
    },
  };
}

function memStorage(): PresenceStorage & { _data: PresenceSettings | null } {
  let data: PresenceSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: PresenceSettings | null) {
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

describe("createPresenceSettings — defaults", () => {
  it("defaults to { present_max_idle_ms: 180000 } when no options given", () => {
    const store = createPresenceSettings();
    expect(store.get()).toEqual({ present_max_idle_ms: 180000 });
  });

  it("does not throw when no options given", () => {
    expect(() => createPresenceSettings()).not.toThrow();
  });
});

describe("createPresenceSettings — setPresentMaxIdleMs", () => {
  it("setPresentMaxIdleMs(300000) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createPresenceSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPresentMaxIdleMs(300000);

    expect(store.get().present_max_idle_ms).toBe(300000);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].present_max_idle_ms).toBe(300000);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].present_max_idle_ms).toBe(300000);
  });

  it("setPresentMaxIdleMs(300000) round-trips via a fresh store on the same storage", () => {
    const storage = memStorage();
    const store1 = createPresenceSettings({ storage });
    store1.setPresentMaxIdleMs(300000);

    const store2 = createPresenceSettings({ storage });
    expect(store2.get().present_max_idle_ms).toBe(300000);
  });

  it("setPresentMaxIdleMs with same value is a no-op (no persist, no notify)", () => {
    const storage = fakeStorage(null);
    const store = createPresenceSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPresentMaxIdleMs(180000); // same as default
    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it("rejects 5000 (below PRESENCE_FLOOR_MS of 10000)", () => {
    const store = createPresenceSettings();
    store.setPresentMaxIdleMs(5000);
    expect(store.get().present_max_idle_ms).toBe(180000);
  });

  it("rejects exactly 9999 (one below floor)", () => {
    const store = createPresenceSettings();
    store.setPresentMaxIdleMs(9999);
    expect(store.get().present_max_idle_ms).toBe(180000);
  });

  it("accepts exactly 10000 (at floor)", () => {
    const store = createPresenceSettings();
    store.setPresentMaxIdleMs(10000);
    expect(store.get().present_max_idle_ms).toBe(10000);
  });

  it("rejects NaN", () => {
    const store = createPresenceSettings();
    store.setPresentMaxIdleMs(NaN);
    expect(store.get().present_max_idle_ms).toBe(180000);
  });

  it("rejects Infinity", () => {
    const store = createPresenceSettings();
    store.setPresentMaxIdleMs(Infinity);
    expect(store.get().present_max_idle_ms).toBe(180000);
  });
});

describe("createPresenceSettings — hydration precedence", () => {
  it("valid stored value wins over initial", () => {
    const stored: PresenceSettings = { present_max_idle_ms: 60000 };
    const initial: PresenceSettings = { present_max_idle_ms: 120000 };
    const store = createPresenceSettings({ storage: fakeStorage(stored), initial });
    expect(store.get()).toEqual(stored);
  });

  it("initial wins over defaults when no stored value", () => {
    const initial: PresenceSettings = { present_max_idle_ms: 240000 };
    const store = createPresenceSettings({ storage: fakeStorage(null), initial });
    expect(store.get()).toEqual(initial);
  });
});

describe("createPresenceSettings — malformed/throwing storage", () => {
  it("storage.load() throws → defaults, factory does not throw", () => {
    const store = createPresenceSettings({ storage: fakeStorage(null, { throwOnLoad: true }) });
    expect(store.get()).toEqual({ present_max_idle_ms: 180000 });
  });

  it("stored blob with missing present_max_idle_ms → defaults", () => {
    const malformed = {} as unknown as PresenceSettings;
    const store = createPresenceSettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ present_max_idle_ms: 180000 });
  });

  it("stored blob with below-floor value → defaults", () => {
    const malformed = { present_max_idle_ms: 5000 } as unknown as PresenceSettings;
    const store = createPresenceSettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ present_max_idle_ms: 180000 });
  });

  it("stored blob with NaN → defaults", () => {
    const malformed = { present_max_idle_ms: NaN } as unknown as PresenceSettings;
    const store = createPresenceSettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ present_max_idle_ms: 180000 });
  });
});

describe("createPresenceSettings — reloadFromStorage (cross-window sync)", () => {
  it("applies an externally-changed value and notifies", () => {
    const storage = memStorage();
    const store = createPresenceSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { present_max_idle_ms: 300000 };
    store.reloadFromStorage();

    expect(store.get()).toEqual({ present_max_idle_ms: 300000 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = memStorage();
    const store = createPresenceSettings({ storage });
    store.setPresentMaxIdleMs(300000);
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage(); // same value → no notify
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createPresenceSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createPresenceSettings — subscribe/unsubscribe", () => {
  it("subscribe returns unsubscribe fn that stops notifications", () => {
    const store = createPresenceSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);

    store.setPresentMaxIdleMs(300000);
    expect(cb).toHaveBeenCalledOnce();

    unsub();
    store.setPresentMaxIdleMs(180000);
    expect(cb).toHaveBeenCalledOnce(); // no more
  });

  it("multiple subscribers are each notified independently", () => {
    const store = createPresenceSettings();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe(cb1);
    store.subscribe(cb2);

    store.setPresentMaxIdleMs(300000);
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });
});

describe("createPresenceSettings — dispose", () => {
  it("dispose clears all subscribers; subsequent mutations do not call them", () => {
    const store = createPresenceSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.dispose();
    store.setPresentMaxIdleMs(300000);
    expect(cb).not.toHaveBeenCalled();
  });
});
