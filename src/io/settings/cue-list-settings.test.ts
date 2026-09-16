/**
 * cue-list-settings.test.ts — the shared cue-list store factory.
 *
 * Pins the behaviour every cue-list store inherits, over a throwaway cue type whose extra field
 * is `minutes`: hydration, deep-clone reads, add/update/remove, setEnabled, storage rejection,
 * reload, subscribe/dispose. Per-store seeds and validators are pinned by the store's own test.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type Cue,
  type CueListSettings,
  type CueStorage,
  createCueListSettings,
} from "./cue-list-settings";

interface TestCue extends Cue {
  minutes: number;
}

type TestSettings = CueListSettings<TestCue>;

function seed(): TestSettings {
  return {
    enabled: true,
    entries: [
      { id: "a", label: "A", context: "ctx a", minutes: 5, enabled: true },
      { id: "b", label: "B", context: "ctx b", minutes: 9, enabled: true },
    ],
  };
}

function fakeStorage(initial?: unknown): CueStorage<TestCue> & { saved: TestSettings[] } {
  const saved: TestSettings[] = [];
  return {
    saved,
    load() {
      return (initial ?? null) as TestSettings | null;
    },
    save(s) {
      saved.push(s);
    },
  };
}

function makeStore(opts?: { storage?: CueStorage<TestCue>; defaults?: TestSettings }) {
  return createCueListSettings<TestCue>({
    storage: opts?.storage,
    defaults: opts?.defaults ?? seed(),
    extras: { minutes: { blank: 3, isValid: (v) => typeof v === "number" && v > 0 } },
  });
}

describe("createCueListSettings — hydration", () => {
  it("falls back to the given defaults when storage is empty", () => {
    const store = makeStore({ storage: fakeStorage(null) });
    expect(store.get()).toEqual(seed());
  });

  it("a stored value wins over the defaults", () => {
    const stored: TestSettings = {
      enabled: false,
      entries: [{ id: "a", label: "edited", context: "edited", minutes: 42, enabled: false }],
    };
    const store = makeStore({ storage: fakeStorage(stored) });
    expect(store.get()).toEqual(stored);
  });

  it("rejects a stored entry whose extra field fails its validator", () => {
    const stored = {
      enabled: true,
      entries: [{ id: "a", label: "A", context: "c", minutes: 0, enabled: true }],
    };
    expect(makeStore({ storage: fakeStorage(stored) }).get()).toEqual(seed());
  });

  it("rejects a stored value missing entries", () => {
    expect(makeStore({ storage: fakeStorage({ enabled: true }) }).get()).toEqual(seed());
  });

  it("rejects a stored entry with a non-string label", () => {
    const stored = {
      enabled: true,
      entries: [{ id: "a", label: 7, context: "c", minutes: 5, enabled: true }],
    };
    expect(makeStore({ storage: fakeStorage(stored) }).get()).toEqual(seed());
  });

  it("works with no storage at all", () => {
    expect(() => makeStore()).not.toThrow();
    expect(makeStore().get()).toEqual(seed());
  });
});

describe("createCueListSettings — get", () => {
  it("returns a deep clone, so mutating it leaves the store untouched", () => {
    const store = makeStore();
    const s = store.get();
    s.enabled = false;
    s.entries[0].label = "hacked";
    s.entries.push({ id: "x", label: "x", context: "x", minutes: 1, enabled: true });

    const again = store.get();
    expect(again.enabled).toBe(true);
    expect(again.entries[0].label).toBe("A");
    expect(again.entries).toHaveLength(2);
  });
});

describe("createCueListSettings — addCue", () => {
  it("appends a blank cue carrying the extra field's blank value, persists, notifies once", () => {
    const storage = fakeStorage(null);
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    const cue = store.addCue();

    expect(cue.label).toBe("");
    expect(cue.context).toBe("");
    expect(cue.enabled).toBe(true);
    expect(cue.minutes).toBe(3);
    expect(cue.id.length).toBeGreaterThan(0);
    expect(store.get().entries).toHaveLength(3);
    expect(store.get().entries[2].id).toBe(cue.id);
    expect(storage.saved).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("returns a copy — mutating it does not reach the store", () => {
    const store = makeStore();
    const cue = store.addCue();
    cue.label = "mutated";
    expect(store.get().entries[2].label).toBe("");
  });
});

describe("createCueListSettings — updateCue", () => {
  it("applies a valid patch, persists, notifies once", () => {
    const storage = fakeStorage(null);
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.updateCue("a", { label: "renamed", context: "new ctx", minutes: 11, enabled: false });

    const a = store.get().entries.find((e) => e.id === "a")!;
    expect(a).toEqual({
      id: "a",
      label: "renamed",
      context: "new ctx",
      minutes: 11,
      enabled: false,
    });
    expect(storage.saved).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("an empty label keeps the prior label", () => {
    const store = makeStore();
    store.updateCue("a", { label: "   " });
    expect(store.get().entries[0].label).toBe("A");
  });

  it("an extra field the validator rejects keeps the prior value", () => {
    const store = makeStore();
    store.updateCue("a", { minutes: 0 });
    expect(store.get().entries[0].minutes).toBe(5);
  });

  it("accepts an empty context", () => {
    const store = makeStore();
    store.updateCue("a", { context: "" });
    expect(store.get().entries[0].context).toBe("");
  });

  it("an unknown id is a no-op — no persist, no notify", () => {
    const storage = fakeStorage(null);
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.updateCue("nope", { label: "x" });
    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it("a patch that changes nothing does not notify", () => {
    const store = makeStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.updateCue("a", { label: "A", minutes: 5 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("leaves the other entries untouched", () => {
    const store = makeStore();
    store.updateCue("a", { label: "renamed" });
    expect(store.get().entries[1]).toEqual(seed().entries[1]);
  });
});

describe("createCueListSettings — removeCue", () => {
  it("removes by id, persists, notifies once", () => {
    const storage = fakeStorage(null);
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.removeCue("a");

    expect(store.get().entries.map((e) => e.id)).toEqual(["b"]);
    expect(storage.saved).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("an unknown id is a no-op", () => {
    const storage = fakeStorage(null);
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.removeCue("nope");
    expect(store.get().entries).toHaveLength(2);
    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createCueListSettings — setEnabled", () => {
  it("a change persists and notifies once", () => {
    const storage = fakeStorage(null);
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setEnabled(false);
    expect(store.get().enabled).toBe(false);
    expect(storage.saved).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("the same value is a no-op", () => {
    const storage = fakeStorage(null);
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setEnabled(true);
    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createCueListSettings — reloadFromStorage", () => {
  it("adopts another window's edit and notifies", () => {
    let value: TestSettings = seed();
    const storage: CueStorage<TestCue> = {
      load: () => value,
      save: (s) => {
        value = s;
      },
    };
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    value = { enabled: false, entries: [] };
    store.reloadFromStorage();

    expect(store.get()).toEqual({ enabled: false, entries: [] });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("ignores a corrupted stored value and keeps the in-memory one", () => {
    let value: unknown = seed();
    const storage = {
      load: () => value as TestSettings,
      save: () => {},
    };
    const store = makeStore({ storage });
    value = "garbage";
    store.reloadFromStorage();
    expect(store.get()).toEqual(seed());
  });
});

describe("createCueListSettings — subscribe / dispose", () => {
  it("the unsubscribe fn stops notifications", () => {
    const store = makeStore();
    const cb = vi.fn();
    const off = store.subscribe(cb);
    store.setEnabled(false);
    off();
    store.setEnabled(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("dispose stops every subscriber", () => {
    const store = makeStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.setEnabled(false);
    expect(cb).not.toHaveBeenCalled();
  });
});
