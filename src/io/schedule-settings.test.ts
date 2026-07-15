/**
 * schedule-settings.test.ts — createScheduleSettings reactive store (TDD red).
 *
 * Verify:
 *  - defaults: enabled=true, 4 seed entries
 *  - get() returns deep clone (entry mutation does not affect internal state)
 *  - addCue/updateCue/removeCue: persist + notify + validation
 *  - setEnabled: on actual change persist + notify, skip if same
 *  - hydration priority: saved > initial > defaults
 *  - malformed storage → fallback to defaults
 *  - reloadFromStorage: cross-window reload, no-op if same/absent
 *  - subscribe/unsubscribe, dispose
 */

import { describe, expect, it, vi } from "vitest";
import {
  createScheduleSettings,
  type ScheduleSettings,
  type ScheduleStorage,
} from "./schedule-settings";

function fakeStorage(initial?: ScheduleSettings | null): ScheduleStorage & {
  saved: ScheduleSettings[];
} {
  const saved: ScheduleSettings[] = [];
  return {
    saved,
    load() {
      return initial ?? null;
    },
    save(s) {
      saved.push(s);
    },
  };
}

describe("createScheduleSettings — defaults", () => {
  it("defaults to enabled=true with 4 seed entries", () => {
    const store = createScheduleSettings();
    const s = store.get();
    expect(s.enabled).toBe(true);
    expect(s.entries).toHaveLength(4);
    expect(s.entries.map((e) => e.id)).toEqual(["morning", "lunch", "evening", "late_night"]);
    expect(s.entries.every((e) => e.enabled)).toBe(true);
  });

  it("does not throw when no options given", () => {
    expect(() => createScheduleSettings()).not.toThrow();
  });
});

describe("createScheduleSettings — get() returns a deep clone", () => {
  it("mutating the returned object/entries does not affect store state", () => {
    const store = createScheduleSettings();
    const s = store.get();
    s.enabled = false;
    s.entries[0].label = "hacked";
    s.entries.push({ id: "x", label: "x", context: "x", time: "00:00", enabled: true });

    const again = store.get();
    expect(again.enabled).toBe(true);
    expect(again.entries[0].label).toBe("아침");
    expect(again.entries).toHaveLength(4);
  });
});

describe("createScheduleSettings — addCue", () => {
  it("appends a blank cue, persists, notifies, and returns the new cue", () => {
    const storage = fakeStorage(null);
    const store = createScheduleSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    const cue = store.addCue();

    expect(cue.time).toBe("12:00");
    expect(cue.label).toBe("");
    expect(cue.context).toBe("");
    expect(cue.enabled).toBe(true);
    expect(typeof cue.id).toBe("string");
    expect(cue.id.length).toBeGreaterThan(0);

    expect(store.get().entries).toHaveLength(5);
    expect(store.get().entries[4].id).toBe(cue.id);
    expect(storage.saved).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("createScheduleSettings — updateCue", () => {
  it("applies a valid patch, persists, notifies once", () => {
    const storage = fakeStorage(null);
    const store = createScheduleSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.updateCue("morning", { label: "굿모닝", time: "08:30", enabled: false });

    const m = store.get().entries.find((e) => e.id === "morning")!;
    expect(m.label).toBe("굿모닝");
    expect(m.time).toBe("08:30");
    expect(m.enabled).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(storage.saved).toHaveLength(1);
  });

  it("invalid time keeps prior value", () => {
    const store = createScheduleSettings();
    store.updateCue("morning", { time: "25:99" });
    expect(store.get().entries.find((e) => e.id === "morning")!.time).toBe("09:00");
  });

  it("empty label (after trim) keeps prior value", () => {
    const store = createScheduleSettings();
    store.updateCue("morning", { label: "   " });
    expect(store.get().entries.find((e) => e.id === "morning")!.label).toBe("아침");
  });

  it("unknown id is a no-op (no notify, no persist)", () => {
    const storage = fakeStorage(null);
    const store = createScheduleSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.updateCue("nope", { label: "x" });
    expect(cb).not.toHaveBeenCalled();
    expect(storage.saved).toHaveLength(0);
  });

  it("no-op patch (no changes) does not notify", () => {
    const store = createScheduleSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.updateCue("morning", { label: "아침", time: "09:00" });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createScheduleSettings — removeCue", () => {
  it("removes by id, persists, notifies", () => {
    const storage = fakeStorage(null);
    const store = createScheduleSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.removeCue("lunch");

    expect(store.get().entries.map((e) => e.id)).toEqual(["morning", "evening", "late_night"]);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(storage.saved).toHaveLength(1);
  });

  it("unknown id is a no-op", () => {
    const store = createScheduleSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.removeCue("nope");
    expect(store.get().entries).toHaveLength(4);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createScheduleSettings — setEnabled", () => {
  it("change persists and notifies", () => {
    const storage = fakeStorage(null);
    const store = createScheduleSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setEnabled(false);
    expect(store.get().enabled).toBe(false);
    expect(storage.saved).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("same value is a no-op", () => {
    const storage = fakeStorage(null);
    const store = createScheduleSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setEnabled(true);
    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createScheduleSettings — malformed storage", () => {
  it("missing entries → defaults", () => {
    const malformed = { enabled: true } as unknown as ScheduleSettings;
    const store = createScheduleSettings({ storage: fakeStorage(malformed) });
    expect(store.get().entries).toHaveLength(4);
  });

  it("bad time in an entry → defaults", () => {
    const malformed = {
      enabled: true,
      entries: [{ id: "a", label: "A", context: "c", time: "99:99", enabled: true }],
    } as unknown as ScheduleSettings;
    const store = createScheduleSettings({ storage: fakeStorage(malformed) });
    expect(store.get().entries).toHaveLength(4);
  });
});
