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
import type { FillerPool } from "../config/load";
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

function pool(first: string[], repeat: string[] = []): Partial<FillerPool> {
  return { first, repeat };
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
});

// ─────────────────────────────────────────────────────────────────────────────
// Priority: stored > initial > defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — priority", () => {
  it("stored value with old string-array customPools shape falls back to initial", () => {
    // old shape: customPools.ja is string[] instead of {first,repeat}
    const storage: FillerStorage = {
      load: () =>
        ({
          enabled: true,
          language: "ja",
          customPools: { ja: ["うーん…"] }, // old shape — array not object
        }) as unknown as FillerSettings,
      save: vi.fn(),
    };
    const store = createFillerSettings({
      storage,
      initial: { enabled: false, language: "en", customPools: {} },
    });
    // validation rejects old shape → falls back to initial
    expect(store.get().language).toBe("en");
    expect(store.get().enabled).toBe(false);
  });

  it("stored customPools predating the new tiers (only first/repeat) stays valid, not falling back", () => {
    const storage: FillerStorage = {
      load: () =>
        ({
          enabled: true,
          language: "ja",
          customPools: { ja: { first: ["うーん…"], repeat: ["ええと…"] } }, // no long_wait/tool/timeout/unreachable
        }) as unknown as FillerSettings,
      save: vi.fn(),
    };
    const store = createFillerSettings({
      storage,
      initial: { enabled: false, language: "en", customPools: {} },
    });
    expect(store.get().language).toBe("ja");
    expect(store.get().customPools.ja).toEqual({ first: ["うーん…"], repeat: ["ええと…"] });
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
  it("setCustomPool('en', pool) sets en pool and notifies", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setCustomPool("en", pool(["Let me think...", "Hmm..."], ["Still thinking..."]));
    expect(store.get().customPools.en).toEqual({
      first: ["Let me think...", "Hmm..."],
      repeat: ["Still thinking..."],
    });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("idempotent: same pool value is no-op (deep content compare)", () => {
    const store = createFillerSettings({
      initial: {
        enabled: true,
        language: "ja",
        customPools: { en: pool(["Hmm..."]) },
      },
    });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setCustomPool("en", pool(["Hmm..."]));
    expect(cb).not.toHaveBeenCalled();
  });

  it("setCustomPool calls storage.save with updated customPools", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createFillerSettings({ storage });
    store.setCustomPool("ko", pool(["글쎄…"], ["음…"]));
    expect(saveSpy).toHaveBeenCalled();
    expect(saveSpy.mock.calls[0][0].customPools.ko).toEqual({ first: ["글쎄…"], repeat: ["음…"] });
  });

  it("idempotent: unset → {first:[],repeat:[]} is a no-op (both mean 'use config pool')", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setCustomPool("ja", pool([]));
    store.setCustomPool("ja", pool([], []));
    expect(cb).not.toHaveBeenCalled();
  });

  it("get() customPools is a copy — mutation does not affect store", () => {
    const store = createFillerSettings();
    store.setCustomPool("ja", pool(["うーん…"]));
    const s = store.get();
    s.customPools.ja = pool(["mutated"]);
    expect(store.get().customPools.ja).toEqual({ first: ["うーん…"], repeat: [] });
  });

  it("setting only first list differs from setting only repeat list (per-lang independence)", () => {
    const store = createFillerSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setCustomPool("ja", pool(["ちょっと待って"], []));
    store.setCustomPool("en", pool([], ["Still here..."]));
    expect(cb).toHaveBeenCalledTimes(2);
    expect(store.get().customPools.ja).toEqual({ first: ["ちょっと待って"], repeat: [] });
    expect(store.get().customPools.en).toEqual({ first: [], repeat: ["Still here..."] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribe / unsubscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage (cross-window sync)
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerSettings — reloadFromStorage", () => {
  it("invalid stored value on reload is ignored (no notify)", () => {
    const storage = makeMemStorage();
    const store = createFillerSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { enabled: "yes" as unknown as boolean, language: "ja", customPools: {} };
    store.reloadFromStorage();

    expect(cb).not.toHaveBeenCalled();
  });

  it("invalid customPools shape on reload is ignored (no notify)", () => {
    const storage = makeMemStorage();
    const store = createFillerSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = {
      enabled: true,
      language: "ja",
      customPools: "bad" as unknown as Record<string, never>,
    };
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
    store1.setCustomPool("en", pool(["Hmm..."], ["Still thinking..."]));

    const store2 = createFillerSettings({ storage });
    expect(store2.get().enabled).toBe(false);
    expect(store2.get().language).toBe("ko");
    expect(store2.get().customPools.en).toEqual({
      first: ["Hmm..."],
      repeat: ["Still thinking..."],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageFillerStorage adapter
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageFillerStorage", () => {
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
});
