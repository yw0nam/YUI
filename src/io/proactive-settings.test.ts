/**
 * proactive-settings.test.ts — createProactiveSettings reactive store (idle-gap cue list).
 *
 * 검증:
 *  - 기본값: enabled=true, 3개 seed entry
 *  - get()이 deep clone 반환
 *  - addCue/updateCue(valid+invalid idle_min/label)/removeCue
 *  - setEnabled: 변경 시 persist + notify, 동일값 skip
 *  - hydration 우선순위 + malformed 폴백
 *  - migration: 구버전 { enabled } (no entries) → enabled 유지 + seed entries 채움
 *  - reloadFromStorage, subscribe/unsubscribe, dispose
 */

import { describe, expect, it, vi } from "vitest";
import {
  createProactiveSettings,
  type ProactiveSettings,
  type ProactiveStorage,
} from "./proactive-settings";

function fakeStorage(
  initial?: unknown,
  opts?: { throwOnLoad?: boolean },
): ProactiveStorage & { saved: ProactiveSettings[] } {
  const saved: ProactiveSettings[] = [];
  return {
    saved,
    load() {
      if (opts?.throwOnLoad) throw new Error("storage exploded");
      return (initial ?? null) as ProactiveSettings | null;
    },
    save(s) {
      saved.push(s);
    },
  };
}

function memStorage(): ProactiveStorage & { _data: ProactiveSettings | null } {
  let data: ProactiveSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: ProactiveSettings | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(s) {
      data = structuredClone(s);
    },
  };
}

describe("createProactiveSettings — defaults", () => {
  it("defaults to enabled=true with 3 seed entries", () => {
    const store = createProactiveSettings();
    const s = store.get();
    expect(s.enabled).toBe(true);
    expect(s.entries).toHaveLength(3);
    expect(s.entries.map((e) => e.id)).toEqual(["short_break", "mid_check", "long_focus"]);
    expect(s.entries.every((e) => e.enabled)).toBe(true);
    expect(s.entries.map((e) => e.idle_min)).toEqual([5, 10, 30]);
  });

  it("does not throw when no options given", () => {
    expect(() => createProactiveSettings()).not.toThrow();
  });
});

describe("createProactiveSettings — get() returns a deep clone", () => {
  it("mutating the returned object/entries does not affect store state", () => {
    const store = createProactiveSettings();
    const s = store.get();
    s.enabled = false;
    s.entries[0].label = "hacked";
    s.entries.push({ id: "x", label: "x", context: "x", idle_min: 1, enabled: true });

    const again = store.get();
    expect(again.enabled).toBe(true);
    expect(again.entries[0].label).toBe("잠깐 환기");
    expect(again.entries).toHaveLength(3);
  });
});

describe("createProactiveSettings — addCue", () => {
  it("appends a blank cue with idle_min=10, persists, notifies, returns it", () => {
    const storage = fakeStorage(null);
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    const cue = store.addCue();
    expect(cue.idle_min).toBe(10);
    expect(cue.label).toBe("");
    expect(cue.context).toBe("");
    expect(cue.enabled).toBe(true);
    expect(typeof cue.id).toBe("string");

    expect(store.get().entries).toHaveLength(4);
    expect(storage.saved).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("createProactiveSettings — updateCue", () => {
  it("applies a valid patch, persists, notifies once", () => {
    const storage = fakeStorage(null);
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.updateCue("mid_check", { label: "체크", idle_min: 15, enabled: false });
    const c = store.get().entries.find((e) => e.id === "mid_check")!;
    expect(c.label).toBe("체크");
    expect(c.idle_min).toBe(15);
    expect(c.enabled).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(storage.saved).toHaveLength(1);
  });

  it("invalid idle_min (0) keeps prior value", () => {
    const store = createProactiveSettings();
    store.updateCue("short_break", { idle_min: 0 });
    expect(store.get().entries.find((e) => e.id === "short_break")!.idle_min).toBe(5);
  });

  it("invalid idle_min (non-finite) keeps prior value", () => {
    const store = createProactiveSettings();
    store.updateCue("short_break", { idle_min: Number.POSITIVE_INFINITY });
    expect(store.get().entries.find((e) => e.id === "short_break")!.idle_min).toBe(5);
  });

  it("empty label (after trim) keeps prior value", () => {
    const store = createProactiveSettings();
    store.updateCue("short_break", { label: "  " });
    expect(store.get().entries.find((e) => e.id === "short_break")!.label).toBe("잠깐 환기");
  });

  it("unknown id is a no-op", () => {
    const store = createProactiveSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.updateCue("nope", { label: "x" });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createProactiveSettings — removeCue", () => {
  it("removes by id, persists, notifies", () => {
    const storage = fakeStorage(null);
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.removeCue("mid_check");
    expect(store.get().entries.map((e) => e.id)).toEqual(["short_break", "long_focus"]);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(storage.saved).toHaveLength(1);
  });

  it("unknown id is a no-op", () => {
    const store = createProactiveSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.removeCue("nope");
    expect(store.get().entries).toHaveLength(3);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createProactiveSettings — setEnabled", () => {
  it("setEnabled(false) persists and notifies", () => {
    const storage = fakeStorage(null);
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setEnabled(false);
    expect(store.get().enabled).toBe(false);
    expect(storage.saved).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("same value is a no-op", () => {
    const storage = fakeStorage(null);
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setEnabled(true);
    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createProactiveSettings — hydration precedence", () => {
  it("valid stored value wins over initial", () => {
    const stored: ProactiveSettings = {
      enabled: false,
      entries: [{ id: "a", label: "A", context: "c", idle_min: 7, enabled: true }],
    };
    const initial: ProactiveSettings = { enabled: true, entries: [] };
    const store = createProactiveSettings({ storage: fakeStorage(stored), initial });
    expect(store.get().enabled).toBe(false);
    expect(store.get().entries[0].id).toBe("a");
  });

  it("initial wins over defaults when no stored value", () => {
    const initial: ProactiveSettings = {
      enabled: false,
      entries: [{ id: "b", label: "B", context: "c", idle_min: 3, enabled: true }],
    };
    const store = createProactiveSettings({ storage: fakeStorage(null), initial });
    expect(store.get().entries[0].id).toBe("b");
  });
});

describe("createProactiveSettings — malformed storage", () => {
  it("storage.load() throws → defaults", () => {
    const store = createProactiveSettings({ storage: fakeStorage(null, { throwOnLoad: true }) });
    expect(store.get().entries).toHaveLength(3);
  });

  it("entries with invalid idle_min (0) → falls back to defaults", () => {
    const malformed = {
      enabled: true,
      entries: [{ id: "a", label: "A", context: "c", idle_min: 0, enabled: true }],
    };
    const store = createProactiveSettings({ storage: fakeStorage(malformed) });
    expect(store.get().entries).toHaveLength(3);
  });

  it("entries with non-finite idle_min → falls back to defaults", () => {
    const malformed = {
      enabled: true,
      entries: [{ id: "a", label: "A", context: "c", idle_min: Infinity, enabled: true }],
    };
    const store = createProactiveSettings({ storage: fakeStorage(malformed) });
    expect(store.get().entries).toHaveLength(3);
  });
});

describe("createProactiveSettings — migration from old { enabled } shape", () => {
  it("{ enabled: false } (no entries) → keeps enabled, fills seed entries", () => {
    const storage = memStorage();
    storage._data = { enabled: false } as unknown as ProactiveSettings;
    const store = createProactiveSettings({ storage });
    const s = store.get();
    expect(s.enabled).toBe(false);
    expect(s.entries).toHaveLength(3);
    expect(s.entries.map((e) => e.id)).toEqual(["short_break", "mid_check", "long_focus"]);
  });
});

describe("createProactiveSettings — reloadFromStorage", () => {
  it("applies an externally-changed value and notifies", () => {
    const storage = memStorage();
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    const next: ProactiveSettings = {
      enabled: false,
      entries: [{ id: "z", label: "Z", context: "c", idle_min: 2, enabled: true }],
    };
    storage._data = next;
    store.reloadFromStorage();

    expect(store.get()).toEqual(next);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("identical value is a no-op", () => {
    const storage = memStorage();
    const store = createProactiveSettings({ storage });
    store.setEnabled(false);
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage absent", () => {
    const store = createProactiveSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createProactiveSettings — subscribe/unsubscribe", () => {
  it("unsubscribe stops notifications", () => {
    const store = createProactiveSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.setEnabled(false);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    store.setEnabled(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("createProactiveSettings — dispose", () => {
  it("dispose clears subscribers", () => {
    const store = createProactiveSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.setEnabled(false);
    expect(cb).not.toHaveBeenCalled();
  });
});
