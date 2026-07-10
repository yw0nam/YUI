/**
 * recent-apps-settings.test.ts — createRecentAppsSettings reactive store.
 *
 * Checks:
 *  - default: { recent_apps_max: 10 }
 *  - setRecentAppsMax: persists and round-trips; invalid values are no-ops
 *  - rejects values below RECENT_APPS_FLOOR (1)
 *  - rejects NaN
 *  - malformed/throwing storage → defaults
 *  - reloadFromStorage, subscribe/unsubscribe, dispose
 */

import { describe, expect, it, vi } from "vitest";
import {
  createRecentAppsSettings,
  type RecentAppsSettings,
  type RecentAppsStorage,
} from "./recent-apps-settings";

function fakeStorage(
  initial?: RecentAppsSettings | null,
  opts?: { throwOnLoad?: boolean },
): RecentAppsStorage & { saved: RecentAppsSettings[] } {
  const saved: RecentAppsSettings[] = [];
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

function memStorage(): RecentAppsStorage & { _data: RecentAppsSettings | null } {
  let data: RecentAppsSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: RecentAppsSettings | null) {
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

describe("createRecentAppsSettings — defaults", () => {
  it("defaults to { recent_apps_max: 10 } when no options given", () => {
    const store = createRecentAppsSettings();
    expect(store.get()).toEqual({ recent_apps_max: 10 });
  });

  it("does not throw when no options given", () => {
    expect(() => createRecentAppsSettings()).not.toThrow();
  });
});

describe("createRecentAppsSettings — setRecentAppsMax", () => {
  it("setRecentAppsMax(20) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createRecentAppsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setRecentAppsMax(20);

    expect(store.get().recent_apps_max).toBe(20);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].recent_apps_max).toBe(20);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].recent_apps_max).toBe(20);
  });

  it("setRecentAppsMax(20) round-trips via a fresh store on the same storage", () => {
    const storage = memStorage();
    const store1 = createRecentAppsSettings({ storage });
    store1.setRecentAppsMax(20);

    const store2 = createRecentAppsSettings({ storage });
    expect(store2.get().recent_apps_max).toBe(20);
  });

  it("setRecentAppsMax with same value is a no-op (no persist, no notify)", () => {
    const storage = fakeStorage(null);
    const store = createRecentAppsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setRecentAppsMax(10); // same as default
    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it("rejects 0 (below RECENT_APPS_FLOOR of 1)", () => {
    const store = createRecentAppsSettings();
    store.setRecentAppsMax(0);
    expect(store.get().recent_apps_max).toBe(10);
  });

  it("accepts exactly 1 (at floor)", () => {
    const store = createRecentAppsSettings();
    store.setRecentAppsMax(1);
    expect(store.get().recent_apps_max).toBe(1);
  });

  it("rejects non-integer values", () => {
    const store = createRecentAppsSettings();
    store.setRecentAppsMax(2.5);
    expect(store.get().recent_apps_max).toBe(10);
  });

  it("rejects NaN", () => {
    const store = createRecentAppsSettings();
    store.setRecentAppsMax(NaN);
    expect(store.get().recent_apps_max).toBe(10);
  });

  it("rejects Infinity", () => {
    const store = createRecentAppsSettings();
    store.setRecentAppsMax(Infinity);
    expect(store.get().recent_apps_max).toBe(10);
  });
});

describe("createRecentAppsSettings — hydration precedence", () => {
  it("valid stored value wins over initial", () => {
    const stored: RecentAppsSettings = { recent_apps_max: 5 };
    const initial: RecentAppsSettings = { recent_apps_max: 15 };
    const store = createRecentAppsSettings({ storage: fakeStorage(stored), initial });
    expect(store.get()).toEqual(stored);
  });

  it("initial wins over defaults when no stored value", () => {
    const initial: RecentAppsSettings = { recent_apps_max: 25 };
    const store = createRecentAppsSettings({ storage: fakeStorage(null), initial });
    expect(store.get()).toEqual(initial);
  });
});

describe("createRecentAppsSettings — malformed/throwing storage", () => {
  it("storage.load() throws → defaults, factory does not throw", () => {
    const store = createRecentAppsSettings({ storage: fakeStorage(null, { throwOnLoad: true }) });
    expect(store.get()).toEqual({ recent_apps_max: 10 });
  });

  it("stored blob with missing recent_apps_max → defaults", () => {
    const malformed = {} as unknown as RecentAppsSettings;
    const store = createRecentAppsSettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ recent_apps_max: 10 });
  });

  it("stored blob with below-floor value → defaults", () => {
    const malformed = { recent_apps_max: 0 } as unknown as RecentAppsSettings;
    const store = createRecentAppsSettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ recent_apps_max: 10 });
  });

  it("stored blob with NaN → defaults", () => {
    const malformed = { recent_apps_max: NaN } as unknown as RecentAppsSettings;
    const store = createRecentAppsSettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ recent_apps_max: 10 });
  });
});

describe("createRecentAppsSettings — reloadFromStorage (cross-window sync)", () => {
  it("applies an externally-changed value and notifies", () => {
    const storage = memStorage();
    const store = createRecentAppsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { recent_apps_max: 30 };
    store.reloadFromStorage();

    expect(store.get()).toEqual({ recent_apps_max: 30 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = memStorage();
    const store = createRecentAppsSettings({ storage });
    store.setRecentAppsMax(30);
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage(); // same value → no notify
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createRecentAppsSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createRecentAppsSettings — subscribe/unsubscribe", () => {
  it("subscribe returns unsubscribe fn that stops notifications", () => {
    const store = createRecentAppsSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);

    store.setRecentAppsMax(20);
    expect(cb).toHaveBeenCalledOnce();

    unsub();
    store.setRecentAppsMax(10);
    expect(cb).toHaveBeenCalledOnce(); // no more
  });

  it("multiple subscribers are each notified independently", () => {
    const store = createRecentAppsSettings();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe(cb1);
    store.subscribe(cb2);

    store.setRecentAppsMax(20);
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });
});

describe("createRecentAppsSettings — dispose", () => {
  it("dispose clears all subscribers; subsequent mutations do not call them", () => {
    const store = createRecentAppsSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.dispose();
    store.setRecentAppsMax(20);
    expect(cb).not.toHaveBeenCalled();
  });
});
