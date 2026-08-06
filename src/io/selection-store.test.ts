/**
 * selection-store.test.ts — generic reactive selection store.
 *
 * Exercises the injected seams (coerceUser, synthesize, isDefault) directly against a
 * minimal test option shape, independent of the VRM/speaker domains that wrap this module.
 */

import { describe, expect, it, vi } from "vitest";
import type { SelectionOverrideStorage, UserOptionStorage } from "./selection-store";
import {
  createSelectionStore,
  localStorageOverrideStorage,
  localStorageUserOptionStorage,
} from "./selection-store";

/** Minimal option shape: default-match is by `url`, not `id` (mirrors the VRM domain). */
interface TestOption {
  id: string;
  label?: string;
  source?: "bundled" | "user";
  url: string;
}

const SAMPLE: TestOption[] = [
  { id: "a", label: "A", url: "/a.res", source: "bundled" },
  { id: "b", label: "B", url: "/b.res", source: "bundled" },
];

function synthesize(defaultUrl: string): TestOption {
  return { id: "synth", label: "Synth", url: defaultUrl, source: "bundled" };
}

function coerceUser(v: unknown): TestOption | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(o.id)) return null;
  if (typeof o.url !== "string" || o.url.length === 0) return null;
  const label = typeof o.label === "string" && o.label.length > 0 ? o.label : o.id;
  return { id: o.id, label, url: o.url, source: "user" };
}

function isDefault(o: TestOption, defaultUrl: string): boolean {
  return o.url === defaultUrl;
}

function makeMemStorage(): SelectionOverrideStorage & { _data: string | null } {
  let data: string | null = null;
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
    save(id) {
      data = id;
    },
  };
}

function makeMemUserStorage(): UserOptionStorage<TestOption> & { _data: TestOption[] } {
  let data: TestOption[] = [];
  return {
    get _data() {
      return data;
    },
    set _data(v: TestOption[]) {
      data = v;
    },
    load() {
      return data;
    },
    save(list) {
      data = list;
    },
  };
}

function makeStore(
  overrides: Partial<Parameters<typeof createSelectionStore<TestOption>>[0]> = {},
) {
  return createSelectionStore<TestOption>({
    available: SAMPLE,
    defaultValue: "/a.res",
    synthesize,
    coerceUser,
    isDefault,
    ...overrides,
  });
}

describe("createSelectionStore", () => {
  it("synthesizes a single entry from defaultValue when available is empty", () => {
    const store = createSelectionStore<TestOption>({
      defaultValue: "/only.res",
      synthesize,
      coerceUser,
      isDefault,
    });
    expect(store.list()).toEqual([
      { id: "synth", label: "Synth", url: "/only.res", source: "bundled" },
    ]);
    expect(store.getActiveId()).toBe("synth");
  });

  it("synthesizes when available is present but empty", () => {
    const store = createSelectionStore<TestOption>({
      available: [],
      defaultValue: "/only.res",
      synthesize,
      coerceUser,
      isDefault,
    });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe("synth");
  });

  // ── Genuinely empty: available empty AND fallback empty (nothing to synthesize from) ──

  it("returns a genuinely empty list when available AND the fallback are both empty", () => {
    const store = createSelectionStore<TestOption>({
      defaultValue: "",
      synthesize,
      coerceUser,
      isDefault,
    });
    expect(store.list()).toEqual([]);
    expect(store.getOptions()).toEqual([]);
  });

  it("getActive/getActiveId do not throw on a genuinely empty list", () => {
    const store = createSelectionStore<TestOption>({
      defaultValue: "",
      synthesize,
      coerceUser,
      isDefault,
    });
    expect(() => store.getActive()).not.toThrow();
    expect(() => store.getActiveId()).not.toThrow();
  });

  it("select() on a genuinely empty list is a no-op — no crash, no persist", () => {
    const storage = makeMemStorage();
    const store = createSelectionStore<TestOption>({
      defaultValue: "",
      storage,
      synthesize,
      coerceUser,
      isDefault,
    });
    expect(() => store.select("ghost")).not.toThrow();
    expect(storage._data).toBeNull();
  });

  it("setManifest/reloadFromStorage do not throw transitioning into a genuinely empty list", () => {
    const store = makeStore({ defaultValue: "/a.res" }); // starts non-empty
    expect(() => store.setManifest({ available: [], defaultValue: "" })).not.toThrow();
    expect(store.list()).toEqual([]);
    expect(() => store.reloadFromStorage()).not.toThrow();
  });

  it("unions in a real user option even when there is genuinely nothing to synthesize", () => {
    const userStorage = makeMemUserStorage();
    userStorage._data = [{ id: "mine", url: "/mine.res" } as TestOption];
    const store = createSelectionStore<TestOption>({
      defaultValue: "",
      userStorage,
      synthesize,
      coerceUser,
      isDefault,
    });
    expect(store.list()).toEqual([{ id: "mine", label: "mine", url: "/mine.res", source: "user" }]);
    expect(store.getActiveId()).toBe("mine");
  });

  // A user option wiped from memory by a setManifest bundled-id collision is not lost: the
  // persisted record survives (setManifest never writes userStorage), so once a later manifest
  // no longer collides, reloadFromStorage's mergeUserOptions picks it back up unassisted.
  it("a user option wiped by a bundled-id collision is restored by reloadFromStorage once the collision clears", () => {
    const userStorage = makeMemUserStorage();
    userStorage._data = [{ id: "shared", label: "Mine", url: "asset://mine.res" } as TestOption];
    const store = createSelectionStore<TestOption>({
      defaultValue: "",
      userStorage,
      synthesize,
      coerceUser,
      isDefault,
    });
    expect(store.list()).toEqual([
      { id: "shared", label: "Mine", url: "asset://mine.res", source: "user" },
    ]);

    // A manifest now also lists "shared" as bundled (e.g. it got registered server-side) — the
    // generic store's bundled-wins rule strips the richer user option from memory.
    store.setManifest({
      available: [{ id: "shared", label: "shared", url: "", source: "bundled" }],
      defaultValue: "",
    });
    expect(store.list()).toEqual([{ id: "shared", label: "shared", url: "", source: "bundled" }]);

    // The collision clears (the call site stops including ids already owned by a user option).
    store.setManifest({ available: [], defaultValue: "" });
    expect(store.list()).toEqual([]); // setManifest alone does not restore it — no mergeUserOptions

    // reloadFromStorage merges from the still-intact persisted record.
    store.reloadFromStorage();
    expect(store.list()).toEqual([
      { id: "shared", label: "Mine", url: "asset://mine.res", source: "user" },
    ]);
  });

  it("resolves override > default match > list[0], in priority order", () => {
    const storage = makeMemStorage();
    // No override, no default match with fallback value -> list[0]
    const noMatch = makeStore({ defaultValue: "/nope.res" });
    expect(noMatch.getActiveId()).toBe("a");

    // Default match wins when no override is set.
    const defaultMatch = makeStore({ defaultValue: "/b.res" });
    expect(defaultMatch.getActiveId()).toBe("b");

    // A valid override beats the default match.
    storage.save("a");
    const withOverride = makeStore({ defaultValue: "/b.res", storage });
    expect(withOverride.getActiveId()).toBe("a");
  });

  it("treats a stale/unknown override id as absent, falling back to default match", () => {
    const storage = makeMemStorage();
    storage.save("ghost");
    const store = makeStore({ defaultValue: "/b.res", storage });
    expect(store.getActiveId()).toBe("b");
  });

  it("returns defensive copies from lists, getActive, and notifications", () => {
    const store = makeStore();
    const list = store.list();
    const options = store.getOptions();
    const active = store.getActive();
    list[0].label = "changed";
    options[0].label = "changed";
    active.label = "changed";
    expect(store.getActive().label).toBe("A");

    const cb = vi.fn((option: TestOption) => {
      option.label = "changed";
    });
    store.subscribe(cb);
    store.select("b");
    expect(store.getActive().label).toBe("B");
  });

  it("selects and resets valid ids, persisting and notifying only on actual changes", () => {
    const storage = makeMemStorage();
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.select("ghost");
    store.select("a");
    expect(storage._data).toBeNull();
    expect(cb).not.toHaveBeenCalled();

    store.select("b");
    store.select("b");
    expect(storage._data).toBe("b");
    expect(cb).toHaveBeenCalledTimes(1);

    store.reset();
    store.reset();
    expect(storage._data).toBeNull();
    expect(store.getActiveId()).toBe("a");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("reloads an external reset and preserves state when override storage throws", () => {
    const storage = makeMemStorage();
    storage._data = "b";
    const store = makeStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = null;
    store.reloadFromStorage();
    expect(store.getActiveId()).toBe("a");
    expect(cb).toHaveBeenCalledTimes(1);

    storage.load = () => {
      throw new Error("boom");
    };
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(store.getActiveId()).toBe("a");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("keeps an initially stale override so a later manifest can restore it", () => {
    const storage = makeMemStorage();
    storage._data = "b";
    const store = makeStore({ available: [SAMPLE[0]], storage });
    expect(store.getActiveId()).toBe("a");

    store.setManifest({ available: SAMPLE, defaultValue: "/a.res" });
    expect(store.getActiveId()).toBe("b");

    store.setManifest({ available: [SAMPLE[0]], defaultValue: "/a.res" });
    store.select("b");
    expect(store.getActiveId()).toBe("a");
  });

  it("stops notifications after unsubscribe or dispose", () => {
    const store = makeStore();
    const unsubscribed = vi.fn();
    const disposed = vi.fn();
    const unsubscribe = store.subscribe(unsubscribed);
    store.subscribe(disposed);
    unsubscribe();
    store.select("b");
    expect(unsubscribed).not.toHaveBeenCalled();
    expect(disposed).toHaveBeenCalledTimes(1);

    store.dispose();
    store.select("a");
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it("drops entries coerceUser rejects when merging persisted user options", () => {
    const userStorage = makeMemUserStorage();
    userStorage._data = [
      { id: "good", url: "/good.res" } as TestOption,
      { id: "bad id with spaces", url: "/bad.res" } as TestOption, // fails SAFE_ID
      { id: "no-url" } as TestOption, // fails url check
      null as unknown as TestOption,
    ];
    const store = makeStore({ userStorage });
    const ids = store.list().map((o) => o.id);
    expect(ids).toEqual(["a", "b", "good"]);
  });

  it("drops user options that collide with a bundled id (bundled wins) on merge and on add", () => {
    const userStorage = makeMemUserStorage();
    userStorage._data = [{ id: "a", url: "/user-a.res" } as TestOption];
    const store = makeStore({ userStorage });
    expect(store.list()).toEqual([
      { id: "a", label: "A", url: "/a.res", source: "bundled" },
      { id: "b", label: "B", url: "/b.res", source: "bundled" },
    ]);

    store.addUserOption({ id: "a", label: "Nope", url: "/x.res" });
    expect(store.list().find((o) => o.id === "a")).toEqual({
      id: "a",
      label: "A",
      url: "/a.res",
      source: "bundled",
    });
  });

  it("adds and updates user options in place, forcing source and persisting copies", () => {
    const userStorage = makeMemUserStorage();
    const store = makeStore({ userStorage });
    store.addUserOption({ id: "c", label: "C", url: "/c.res", source: "bundled" });
    store.addUserOption({ id: "c", label: "C2", url: "/c2.res" });

    expect(store.list().filter((option) => option.id === "c")).toEqual([
      { id: "c", label: "C2", url: "/c2.res", source: "user" },
    ]);
    expect(userStorage._data).toEqual([{ id: "c", label: "C2", url: "/c2.res", source: "user" }]);
  });

  it("renameUserOption trims, no-ops on unknown id or empty label, and notifies only when active", () => {
    const userStorage = makeMemUserStorage();
    const store = makeStore({ userStorage, defaultValue: "/nope.res" });
    store.addUserOption({ id: "c", label: "C", url: "/c.res" });

    const cb = vi.fn();
    store.subscribe(cb);

    store.renameUserOption("missing", "New"); // unknown id -> no-op
    store.renameUserOption("c", "   "); // empty after trim -> no-op
    expect(cb).not.toHaveBeenCalled();
    expect(userStorage._data.find((o) => o.id === "c")?.label).toBe("C");

    // Not currently active ("a" resolves first) -> persists but does not notify.
    store.renameUserOption("c", "Charlie");
    expect(userStorage._data.find((o) => o.id === "c")?.label).toBe("Charlie");
    expect(cb).not.toHaveBeenCalled();

    store.select("c");
    cb.mockClear();
    store.renameUserOption("c", "Charlie II");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].label).toBe("Charlie II");
  });

  it("removeUserOption falls back to default resolution and notifies only when the removed option was active", () => {
    const storage = makeMemStorage();
    const userStorage = makeMemUserStorage();
    const store = makeStore({ storage, userStorage, defaultValue: "/b.res" });
    store.addUserOption({ id: "c", label: "C", url: "/c.res" });

    const cbInactive = vi.fn();
    store.subscribe(cbInactive);
    store.removeUserOption("c"); // "c" was never selected -> no notify, no storage write
    expect(cbInactive).not.toHaveBeenCalled();
    expect(storage._data).toBeNull();

    store.addUserOption({ id: "d", label: "D", url: "/d.res" });
    store.select("d");
    const cbActive = vi.fn();
    store.subscribe(cbActive);
    store.removeUserOption("d");
    expect(cbActive).toHaveBeenCalledTimes(1);
    expect(cbActive.mock.calls[0][0].id).toBe("b"); // falls back to default match
    expect(storage._data).toBeNull(); // override cleared
  });

  it("reloadFromStorage merges the persisted user list and override, notifying only on an actual change", () => {
    const storage = makeMemStorage();
    const userStorage = makeMemUserStorage();
    const store = makeStore({ storage, userStorage, defaultValue: "/nope.res" });

    const cb = vi.fn();
    store.subscribe(cb);

    userStorage._data = [{ id: "e", url: "/e.res" } as TestOption];
    storage._data = "e";
    store.reloadFromStorage();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.getActiveId()).toBe("e");

    cb.mockClear();
    store.reloadFromStorage(); // nothing changed -> no notify
    expect(cb).not.toHaveBeenCalled();
  });

  it("union-merges cross-window user additions before the next save", () => {
    const userStorage = makeMemUserStorage();
    const first = makeStore({ userStorage });
    const second = makeStore({ userStorage });

    first.addUserOption({ id: "c", url: "/c.res" });
    second.reloadFromStorage();
    second.addUserOption({ id: "d", url: "/d.res" });

    expect(userStorage._data.map((option) => option.id)).toEqual(["c", "d"]);
    expect(second.list().map((option) => option.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("reloadFromStorage updates existing ids without duplicates and rejects bundled collisions", () => {
    const userStorage = makeMemUserStorage();
    const store = makeStore({ userStorage });
    store.addUserOption({ id: "c", label: "old", url: "/c.res" });
    userStorage._data = [
      { id: "c", label: "new", url: "/new.res" },
      { id: "a", label: "fake", url: "/fake.res" },
    ] as TestOption[];

    store.reloadFromStorage();
    expect(store.list().filter((option) => option.id === "c")).toEqual([
      { id: "c", label: "new", url: "/new.res", source: "user" },
    ]);
    expect(store.list().find((option) => option.id === "a")?.url).toBe("/a.res");
  });

  it("keeps existing user options when user storage reload throws", () => {
    let throws = false;
    const userStorage: UserOptionStorage<TestOption> = {
      load: () => {
        if (throws) throw new Error("boom");
        return [];
      },
      save: vi.fn(),
    };
    const store = makeStore({ userStorage });
    store.addUserOption({ id: "c", url: "/c.res" });
    throws = true;

    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(store.list().map((option) => option.id)).toContain("c");
  });

  it("setManifest replaces bundled options, drops now-colliding user options, and notifies only on change", () => {
    const userStorage = makeMemUserStorage();
    const store = makeStore({ userStorage, defaultValue: "/a.res" });
    store.addUserOption({ id: "z", label: "Z", url: "/z.res" });

    const cb = vi.fn();
    store.subscribe(cb);

    store.setManifest({
      available: [{ id: "z", label: "Z-bundled", url: "/z2.res", source: "bundled" }],
      defaultValue: "/z2.res",
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.getActiveId()).toBe("z");
    expect(store.getActive().source).toBe("bundled"); // bundled "z" replaced the user "z"

    cb.mockClear();
    store.setManifest({
      available: [{ id: "z", label: "Z-bundled", url: "/z2.res", source: "bundled" }],
      defaultValue: "/z2.res",
    });
    expect(cb).not.toHaveBeenCalled(); // same resolution -> no notify
  });
});

describe("localStorageOverrideStorage", () => {
  it("round-trips a saved id and clears it on save(null)", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const adapter = localStorageOverrideStorage("test.key");
    expect(adapter.load()).toBeNull();
    adapter.save("x");
    expect(adapter.load()).toBe("x");
    adapter.save(null);
    expect(adapter.load()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("uses the requested key and tolerates unavailable or throwing storage", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(), setItem, removeItem: vi.fn() });
    localStorageOverrideStorage("custom.override").save("x");
    expect(setItem).toHaveBeenCalledWith("custom.override", "x");

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    const adapter = localStorageOverrideStorage("blocked");
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save("x")).not.toThrow();
    expect(() => adapter.save(null)).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("localStorageUserOptionStorage", () => {
  it("filters malformed entries through coerceUser on load and round-trips valid ones", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const adapter = localStorageUserOptionStorage<TestOption>("test.user", coerceUser);
    expect(adapter.load()).toEqual([]);

    store.set("test.user", JSON.stringify([{ id: "ok", url: "/ok.res" }, { id: "bad" }]));
    expect(adapter.load()).toEqual([{ id: "ok", label: "ok", url: "/ok.res", source: "user" }]);

    adapter.save([{ id: "ok", label: "ok", url: "/ok.res", source: "user" }]);
    expect(JSON.parse(store.get("test.user")!)).toEqual([
      { id: "ok", label: "ok", url: "/ok.res", source: "user" },
    ]);
    vi.unstubAllGlobals();
  });

  it("returns an empty list for malformed JSON, non-arrays, and unavailable storage", () => {
    const getItem = vi.fn().mockReturnValueOnce("{bad json").mockReturnValueOnce("{}");
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn() });
    const adapter = localStorageUserOptionStorage<TestOption>("test.user", coerceUser);
    expect(adapter.load()).toEqual([]);
    expect(adapter.load()).toEqual([]);

    vi.stubGlobal("localStorage", undefined);
    expect(adapter.load()).toEqual([]);
    expect(() => adapter.save([])).not.toThrow();
    vi.unstubAllGlobals();
  });
});
