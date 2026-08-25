/**
 * sections-settings.test.ts — Quick Controls collapsed-sections reactive settings store.
 *
 * Pins the contract for src/io/sections-settings.ts:
 *   createSectionsSettings({ storage?, initial? }) store
 *   localStorageSectionsStorage(key?) localStorage adapter
 *
 * Default: { closed: [] } — nothing collapsed, matching today's always-expanded layout.
 */

import { describe, expect, it, vi } from "vitest";
import type { SectionsSettings, SectionsStorage } from "./sections-settings";
import { createSectionsSettings, localStorageSectionsStorage } from "./sections-settings";

function makeMemStorage(): SectionsStorage & { _data: SectionsSettings | null } {
  let data: SectionsSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: SectionsSettings | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(s) {
      data = { closed: [...s.closed] };
    },
  };
}

describe("createSectionsSettings — defaults", () => {
  it("no storage/initial → closed: []", () => {
    const store = createSectionsSettings();
    expect(store.get().closed).toEqual([]);
  });
});

describe("createSectionsSettings — setClosed", () => {
  it("setClosed(id, true) adds the id and notifies", () => {
    const store = createSectionsSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setClosed("filler", true);
    expect(store.get().closed).toEqual(["filler"]);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("setClosed(id, false) removes the id and notifies", () => {
    const store = createSectionsSettings({ initial: { closed: ["filler", "vrm"] } });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setClosed("filler", false);
    expect(store.get().closed).toEqual(["vrm"]);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("idempotent: setClosed(id, true) twice notifies once", () => {
    const store = createSectionsSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setClosed("filler", true);
    store.setClosed("filler", true);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("idempotent: setClosed(id, false) on an already-open id is a no-op, no notify", () => {
    const store = createSectionsSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setClosed("filler", false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("setClosed calls storage.save", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createSectionsSettings({ storage });
    store.setClosed("vrm", true);
    expect(saveSpy).toHaveBeenCalled();
    expect(saveSpy.mock.calls[0][0].closed).toEqual(["vrm"]);
  });

  it("get() closed is a copy — mutation does not affect store", () => {
    const store = createSectionsSettings();
    store.setClosed("vrm", true);
    const s = store.get();
    s.closed.push("mutated");
    expect(store.get().closed).toEqual(["vrm"]);
  });
});

describe("createSectionsSettings — validation", () => {
  it("rejects a non-array closed field, falling back to initial", () => {
    const storage: SectionsStorage = {
      load: () => ({ closed: "vrm" as unknown as string[] }),
      save: vi.fn(),
    };
    const store = createSectionsSettings({ storage, initial: { closed: ["filler"] } });
    expect(store.get().closed).toEqual(["filler"]);
  });

  it("rejects a closed array containing non-string entries, falling back to initial", () => {
    const storage: SectionsStorage = {
      load: () => ({ closed: [1, 2] as unknown as string[] }),
      save: vi.fn(),
    };
    const store = createSectionsSettings({ storage, initial: { closed: ["filler"] } });
    expect(store.get().closed).toEqual(["filler"]);
  });

  it("rejects garbage (null/string/array) at the top level, falling back to defaults", () => {
    const storage: SectionsStorage = {
      load: () => "garbage" as unknown as SectionsSettings,
      save: vi.fn(),
    };
    const store = createSectionsSettings({ storage });
    expect(store.get().closed).toEqual([]);
  });

  it("de-duplicates stored ids on load", () => {
    const storage: SectionsStorage = {
      load: () => ({ closed: ["vrm", "vrm", "filler"] }),
      save: vi.fn(),
    };
    const store = createSectionsSettings({ storage });
    expect(store.get().closed.sort()).toEqual(["filler", "vrm"]);
  });
});

describe("createSectionsSettings — reloadFromStorage", () => {
  it("invalid stored value on reload is ignored (no notify)", () => {
    const storage = makeMemStorage();
    const store = createSectionsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { closed: "bad" as unknown as string[] };
    store.reloadFromStorage();

    expect(cb).not.toHaveBeenCalled();
  });

  it("a valid remote change is picked up and notifies", () => {
    const storage = makeMemStorage();
    const store = createSectionsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { closed: ["vrm"] };
    store.reloadFromStorage();

    expect(store.get().closed).toEqual(["vrm"]);
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("createSectionsSettings — persistence", () => {
  it("a new store created with the same storage loads persisted settings", () => {
    const storage = makeMemStorage();
    const store1 = createSectionsSettings({ storage });
    store1.setClosed("filler", true);
    store1.setClosed("vrm", true);

    const store2 = createSectionsSettings({ storage });
    expect(store2.get().closed.sort()).toEqual(["filler", "vrm"]);
  });
});

describe("localStorageSectionsStorage", () => {
  it("default key is 'yui.sections'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageSectionsStorage();
    adapter.save({ closed: ["vrm"] });
    expect(written[0][0]).toBe("yui.sections");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageSectionsStorage("yui.sections.test");
    adapter.save({ closed: [] });
    expect(written[0][0]).toBe("yui.sections.test");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
