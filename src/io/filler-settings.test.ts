/**
 * filler-settings.test.ts — Filler reactive settings store.
 *
 * Pins the contract for src/io/filler-settings.ts:
 *   createFillerSettings({ storage?, initial? }) store
 *   localStorageFillerStorage(key?) localStorage adapter
 *
 * Priority: stored > initial > defaults (enabled:true, language:"ja", customPools:{})
 */

import { describe, expect, it, vi } from "vitest";
import type { FillerSettings, FillerStorage } from "./filler-settings";
import { createFillerSettings, localStorageFillerStorage } from "./filler-settings";

// ─────────────────────────────────────────────────────────────────────────────
// in-memory storage helper
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): FillerStorage & { _data: FillerSettings | null } {
  let data: FillerSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: FillerSettings | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(s) {
      data = { ...s, customPools: { ...s.customPools } };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — defaults", () => {
  it("no storage/initial → enabled:true, language:'ja', customPools:{}", () => {
    const store = createFillerSettings();
    const s = store.get();
    expect(s.enabled).toBe(true);
    expect(s.language).toBe("ja");
    expect(s.customPools).toEqual({});
  });

  it("get() returns a copy, not the internal reference", () => {
    const store = createFillerSettings();
    const a = store.get();
    const b = store.get();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Priority: stored > initial > defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — priority", () => {
  it("initial takes priority over defaults when no storage", () => {
    const store = createFillerSettings({
      initial: { enabled: false, language: "en", customPools: {} },
    });
    expect(store.get().enabled).toBe(false);
    expect(store.get().language).toBe("en");
  });

  it("stored takes priority over initial", () => {
    const storage: FillerStorage = {
      load: () => ({ enabled: false, language: "ko", customPools: {} }),
      save: vi.fn(),
    };
    const store = createFillerSettings({
      storage,
      initial: { enabled: true, language: "en", customPools: {} },
    });
    expect(store.get().enabled).toBe(false);
    expect(store.get().language).toBe("ko");
  });

  it("invalid stored value falls back to initial (bad language)", () => {
    const storage: FillerStorage = {
      load: () => ({ enabled: true, language: "zz" as "ja", customPools: {} }),
      save: vi.fn(),
    };
    const store = createFillerSettings({
      storage,
      initial: { enabled: false, language: "en", customPools: {} },
    });
    expect(store.get().language).toBe("en");
  });

  it("null from storage.load() falls back to defaults", () => {
    const storage: FillerStorage = {
      load: () => null,
      save: vi.fn(),
    };
    const store = createFillerSettings({ storage });
    expect(store.get().enabled).toBe(true);
    expect(store.get().language).toBe("ja");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setEnabled
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — setEnabled", () => {
  it("setEnabled(false) updates enabled and notifies", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setEnabled(false);
    expect(store.get().enabled).toBe(false);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].enabled).toBe(false);
  });

  it("idempotent: setEnabled(true) after default(true) is no-op, no notify", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setEnabled(true);
    expect(cb).not.toHaveBeenCalled();
  });

  it("setEnabled calls storage.save", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createFillerSettings({ storage });
    store.setEnabled(false);
    expect(saveSpy).toHaveBeenCalled();
    expect(saveSpy.mock.calls[0][0].enabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setLanguage
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — setLanguage", () => {
  it("setLanguage('en') updates language and notifies", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setLanguage("en");
    expect(store.get().language).toBe("en");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("idempotent: setLanguage('ja') after default('ja') is no-op, no notify", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setLanguage("ja");
    expect(cb).not.toHaveBeenCalled();
  });

  it("setLanguage calls storage.save", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createFillerSettings({ storage });
    store.setLanguage("ko");
    expect(saveSpy).toHaveBeenCalled();
    expect(saveSpy.mock.calls[0][0].language).toBe("ko");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setCustomPool
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — setCustomPool", () => {
  it("setCustomPool('en', [...]) sets en pool and notifies", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setCustomPool("en", ["Let me think...", "Hmm..."]);
    expect(store.get().customPools.en).toEqual(["Let me think...", "Hmm..."]);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("idempotent: same pool value is no-op (array content compare)", () => {
    const store = createFillerSettings({
      initial: {
        enabled: true,
        language: "ja",
        customPools: { en: ["Hmm..."] },
      },
    });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setCustomPool("en", ["Hmm..."]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("setCustomPool calls storage.save with updated customPools", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createFillerSettings({ storage });
    store.setCustomPool("ko", ["글쎄…"]);
    expect(saveSpy).toHaveBeenCalled();
    expect(saveSpy.mock.calls[0][0].customPools.ko).toEqual(["글쎄…"]);
  });

  it("get() customPools is a copy — mutation does not affect store", () => {
    const store = createFillerSettings();
    store.setCustomPool("ja", ["うーん…"]);
    const s = store.get();
    s.customPools.ja = ["mutated"];
    expect(store.get().customPools.ja).toEqual(["うーん…"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribe / unsubscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.setEnabled(false);
    unsub();
    store.setEnabled(true);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.setEnabled(false);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage (cross-window sync)
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — reloadFromStorage", () => {
  it("applies externally-changed stored value and notifies", () => {
    const storage = makeMemStorage();
    const store = createFillerSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { enabled: false, language: "ko", customPools: { ja: ["うーん…"] } };
    store.reloadFromStorage();

    expect(store.get().enabled).toBe(false);
    expect(store.get().language).toBe("ko");
    expect(store.get().customPools.ja).toEqual(["うーん…"]);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createFillerSettings({ storage });
    store.setEnabled(false);
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { enabled: false, language: "ja", customPools: {} };
    store.reloadFromStorage();

    expect(cb).not.toHaveBeenCalled();
  });

  it("invalid stored value on reload is ignored (no notify)", () => {
    const storage = makeMemStorage();
    const store = createFillerSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { enabled: "yes" as unknown as boolean, language: "ja", customPools: {} };
    store.reloadFromStorage();

    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when no storage configured", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistence: round-trip through storage
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — persistence", () => {
  it("a new store created with same storage loads persisted settings", () => {
    const storage = makeMemStorage();
    const store1 = createFillerSettings({ storage });
    store1.setEnabled(false);
    store1.setLanguage("ko");
    store1.setCustomPool("en", ["Hmm..."]);

    const store2 = createFillerSettings({ storage });
    expect(store2.get().enabled).toBe(false);
    expect(store2.get().language).toBe("ko");
    expect(store2.get().customPools.en).toEqual(["Hmm..."]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageFillerStorage adapter
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageFillerStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };

    const adapter = localStorageFillerStorage();
    const settings: FillerSettings = {
      enabled: false,
      language: "en",
      customPools: { ja: ["うーん…"] },
    };
    adapter.save(settings);
    expect(adapter.load()).toEqual(settings);

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("default key is 'yui.filler'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageFillerStorage();
    adapter.save({ enabled: true, language: "ja", customPools: {} });
    expect(written[0][0]).toBe("yui.filler");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageFillerStorage("yui.filler.test");
    adapter.save({ enabled: true, language: "ja", customPools: {} });
    expect(written[0][0]).toBe("yui.filler.test");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("returns null when localStorage is unavailable", () => {
    const adapter = localStorageFillerStorage();
    expect(adapter.load()).toBeNull();
  });
});
