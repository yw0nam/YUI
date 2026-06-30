/**
 * github-settings.test.ts — GitHub PR watcher reactive settings store.
 *
 * 검증:
 *  - 기본값(defaults): enabled=false, poll_interval_ms=60000
 *  - validator: enabled 비불리언·sub-floor poll_interval_ms 거부
 *  - setEnabled / setPollInterval: persist + notify, 동일값 skip, 하한 미만 no-op
 *  - persistence round-trip via in-memory storage
 *  - reloadFromStorage: cross-window sync, invalid/identical → no-op
 *  - subscribe/unsubscribe/dispose
 *  - localStorageGithubStorage adapter
 */

import { describe, expect, it, vi } from "vitest";
import {
  createGithubSettings,
  type GithubSettings,
  type GithubStorage,
  localStorageGithubStorage,
} from "./github-settings";

function fakeStorage(
  initial?: GithubSettings | null,
  opts?: { throwOnLoad?: boolean },
): GithubStorage & { saved: GithubSettings[] } {
  const saved: GithubSettings[] = [];
  return {
    saved,
    load() {
      if (opts?.throwOnLoad) throw new Error("storage exploded");
      return initial ?? null;
    },
    save(s) {
      saved.push({ ...s });
    },
  };
}

function memStorage(): GithubStorage & { _data: GithubSettings | null } {
  let data: GithubSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: GithubSettings | null) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createGithubSettings — defaults", () => {
  it("defaults to enabled=false, poll_interval_ms=60000 when no storage", () => {
    const store = createGithubSettings();
    expect(store.get().enabled).toBe(false);
    expect(store.get().poll_interval_ms).toBe(60000);
  });

  it("does not throw when no options given", () => {
    expect(() => createGithubSettings()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validator
// ─────────────────────────────────────────────────────────────────────────────

describe("createGithubSettings — validator", () => {
  it("accepts a valid shape: enabled=true, poll_interval_ms=30000", () => {
    const store = createGithubSettings({
      storage: fakeStorage({ enabled: true, poll_interval_ms: 30000 }),
    });
    expect(store.get().enabled).toBe(true);
    expect(store.get().poll_interval_ms).toBe(30000);
  });

  it("accepts poll_interval_ms exactly at floor (10000)", () => {
    const store = createGithubSettings({
      storage: fakeStorage({ enabled: false, poll_interval_ms: 10000 }),
    });
    expect(store.get().poll_interval_ms).toBe(10000);
  });

  it("rejects non-boolean enabled → falls back to defaults", () => {
    const store = createGithubSettings({
      storage: fakeStorage({ enabled: "yes" as unknown as boolean, poll_interval_ms: 60000 }),
    });
    expect(store.get().enabled).toBe(false);
    expect(store.get().poll_interval_ms).toBe(60000);
  });

  it("rejects sub-floor poll_interval_ms (< 10000) → falls back to defaults", () => {
    const store = createGithubSettings({
      storage: fakeStorage({ enabled: false, poll_interval_ms: 5000 }),
    });
    expect(store.get().poll_interval_ms).toBe(60000);
  });

  it("rejects non-finite poll_interval_ms → falls back to defaults", () => {
    const store = createGithubSettings({
      storage: fakeStorage({ enabled: false, poll_interval_ms: Infinity }),
    });
    expect(store.get().poll_interval_ms).toBe(60000);
  });

  it("rejects non-number poll_interval_ms → falls back to defaults", () => {
    const store = createGithubSettings({
      storage: fakeStorage({ enabled: false, poll_interval_ms: "60000" as unknown as number }),
    });
    expect(store.get().poll_interval_ms).toBe(60000);
  });

  it("storage.load() throws → falls back to defaults, factory does not throw", () => {
    const store = createGithubSettings({
      storage: fakeStorage(null, { throwOnLoad: true }),
    });
    expect(store.get().enabled).toBe(false);
    expect(store.get().poll_interval_ms).toBe(60000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hydration precedence
// ─────────────────────────────────────────────────────────────────────────────

describe("createGithubSettings — hydration precedence", () => {
  it("valid stored value wins over initial", () => {
    const stored: GithubSettings = { enabled: true, poll_interval_ms: 30000 };
    const initial: GithubSettings = { enabled: false, poll_interval_ms: 60000 };
    const store = createGithubSettings({ storage: fakeStorage(stored), initial });
    expect(store.get().enabled).toBe(true);
    expect(store.get().poll_interval_ms).toBe(30000);
  });

  it("initial wins over defaults when no stored value", () => {
    const initial: GithubSettings = { enabled: true, poll_interval_ms: 15000 };
    const store = createGithubSettings({ storage: fakeStorage(null), initial });
    expect(store.get().enabled).toBe(true);
    expect(store.get().poll_interval_ms).toBe(15000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setEnabled
// ─────────────────────────────────────────────────────────────────────────────

describe("createGithubSettings — setEnabled", () => {
  it("setEnabled(true) persists and notifies", () => {
    const storage = fakeStorage(null);
    const store = createGithubSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true);

    expect(store.get().enabled).toBe(true);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].enabled).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].enabled).toBe(true);
  });

  it("setEnabled(false) when already false is a no-op (same as default)", () => {
    const storage = fakeStorage(null);
    const store = createGithubSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(false);

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setPollInterval
// ─────────────────────────────────────────────────────────────────────────────

describe("createGithubSettings — setPollInterval", () => {
  it("setPollInterval(30000) persists and notifies", () => {
    const storage = fakeStorage(null);
    const store = createGithubSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPollInterval(30000);

    expect(store.get().poll_interval_ms).toBe(30000);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].poll_interval_ms).toBe(30000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].poll_interval_ms).toBe(30000);
  });

  it("setPollInterval with same value is a no-op", () => {
    const storage = fakeStorage(null);
    const store = createGithubSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPollInterval(60000);

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it("setPollInterval below floor (< 10000) is rejected (no-op)", () => {
    const store = createGithubSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPollInterval(5000);

    expect(store.get().poll_interval_ms).toBe(60000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("setPollInterval(Infinity) is rejected (no-op)", () => {
    const store = createGithubSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPollInterval(Infinity);

    expect(store.get().poll_interval_ms).toBe(60000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("setPollInterval(NaN) is rejected (no-op)", () => {
    const store = createGithubSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPollInterval(NaN);

    expect(store.get().poll_interval_ms).toBe(60000);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage (cross-window sync)
// ─────────────────────────────────────────────────────────────────────────────

describe("createGithubSettings — reloadFromStorage", () => {
  it("applies externally-changed stored value and notifies", () => {
    const storage = memStorage();
    const store = createGithubSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { enabled: true, poll_interval_ms: 30000 };
    store.reloadFromStorage();

    expect(store.get().enabled).toBe(true);
    expect(store.get().poll_interval_ms).toBe(30000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual({ enabled: true, poll_interval_ms: 30000 });
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = memStorage();
    const store = createGithubSettings({ storage });
    store.setEnabled(true);
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { enabled: true, poll_interval_ms: 60000 };
    store.reloadFromStorage();

    expect(cb).not.toHaveBeenCalled();
  });

  it("malformed stored value on reload is ignored (no notify)", () => {
    const storage = memStorage();
    const store = createGithubSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { enabled: "nope" as unknown as boolean, poll_interval_ms: 60000 };
    store.reloadFromStorage();

    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when no storage configured", () => {
    const store = createGithubSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribe / unsubscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createGithubSettings — subscribe/unsubscribe", () => {
  it("unsubscribe stops notifications", () => {
    const store = createGithubSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);

    store.setEnabled(true);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    store.setEnabled(false);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("multiple subscribers are each notified independently", () => {
    const store = createGithubSettings();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe(cb1);
    store.subscribe(cb2);

    store.setEnabled(true);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

describe("createGithubSettings — get() returns a copy", () => {
  it("mutating the returned object does not affect store state", () => {
    const store = createGithubSettings();
    const s = store.get();
    (s as unknown as Record<string, unknown>).enabled = true;
    expect(store.get().enabled).toBe(false);
  });
});

describe("createGithubSettings — dispose", () => {
  it("dispose clears all subscribers; subsequent mutations do not call them", () => {
    const store = createGithubSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.dispose();
    store.setEnabled(true);

    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistence round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("createGithubSettings — persistence round-trip", () => {
  it("new store created with same storage loads persisted settings", () => {
    const storage = memStorage();
    const store1 = createGithubSettings({ storage });
    store1.setEnabled(true);
    store1.setPollInterval(30000);

    const store2 = createGithubSettings({ storage });
    expect(store2.get().enabled).toBe(true);
    expect(store2.get().poll_interval_ms).toBe(30000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageGithubStorage adapter
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageGithubStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };

    const adapter = localStorageGithubStorage();
    const settings: GithubSettings = { enabled: true, poll_interval_ms: 30000 };
    adapter.save(settings);
    expect(adapter.load()).toEqual(settings);

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("default key is 'yui.github'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageGithubStorage();
    adapter.save({ enabled: false, poll_interval_ms: 60000 });
    expect(written[0][0]).toBe("yui.github");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageGithubStorage("yui.github.test");
    adapter.save({ enabled: false, poll_interval_ms: 60000 });
    expect(written[0][0]).toBe("yui.github.test");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("returns null when localStorage is unavailable", () => {
    const adapter = localStorageGithubStorage();
    expect(adapter.load()).toBeNull();
  });
});
