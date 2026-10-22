import { afterEach, describe, expect, it, vi } from "vitest";
import { createRelationsStore, type Relations, readRelationsOf } from "./relations-store";

/** In-memory storage seeded with a raw stored value. */
function memory(stored: unknown = null) {
  let value = stored;
  return {
    load: () => value as Relations | null,
    save: (s: Relations) => {
      value = s;
    },
  };
}

const t0 = new Date(2026, 9, 22, 9, 0).getTime();
const HOUR = 3_600_000;
const nextDay = new Date(2026, 9, 23, 9, 0).getTime();

describe("createRelationsStore", () => {
  it("rates a fresh target and logs the change", () => {
    const store = createRelationsStore({ storage: memory() });

    expect(store.rate("user", 2, "listened", t0)).toEqual({
      band: "neutral",
      applied: 2,
      clamped: false,
    });
    expect(store.all().user).toEqual({
      value: 2,
      updated_at: t0,
      log: [{ at: t0, delta: 2, why: "listened" }],
    });
  });

  it("holds a target at 4 points of change per local day, counted gross, and resets the next day", () => {
    const store = createRelationsStore({ storage: memory() });

    store.rate("user", 2, "a", t0);
    expect(store.all().user?.value).toBe(2);
    store.rate("user", 2, "b", t0 + HOUR);
    expect(store.all().user?.value).toBe(4);
    expect(store.rate("user", 2, "c", t0 + 2 * HOUR)).toEqual({
      band: "warm",
      applied: 0,
      clamped: true,
    });
    expect(store.all().user?.log).toHaveLength(2);
    expect(store.rate("user", -1, "d", t0 + 3 * HOUR)).toEqual({
      band: "warm",
      applied: 0,
      clamped: true,
    });

    expect(store.rate("user", 2, "e", nextDay)).toEqual({
      band: "warm",
      applied: 2,
      clamped: false,
    });
    expect(store.all().user?.value).toBe(6);
  });

  it("clamps a change at the edge of the range", () => {
    const store = createRelationsStore({
      storage: memory({ user: { value: 19, updated_at: 1, log: [] } }),
    });

    expect(store.rate("user", 2, "x", t0)).toEqual({ band: "close", applied: 1, clamped: true });
    expect(store.all().user?.value).toBe(20);
  });

  it("stores a reason cut to 80 characters", () => {
    const store = createRelationsStore({ storage: memory() });

    store.rate("user", 1, "a".repeat(100), t0);

    expect(store.all().user?.log[0]?.why).toBe("a".repeat(80));
  });

  it.each([
    { name: "a string value", stored: { user: { value: "5" } }, expected: {} },
    {
      name: "a value past 20",
      stored: { user: { value: 25, updated_at: 1, log: [] } },
      expected: {},
    },
    {
      name: "a log entry with delta 3",
      stored: { user: { value: 1, updated_at: 1, log: [{ at: 1, delta: 3, why: "x" }] } },
      expected: { user: { value: 1, updated_at: 1, log: [] } },
    },
  ])("drops $name from storage", ({ stored, expected }) => {
    expect(createRelationsStore({ storage: memory(stored) }).all()).toEqual(expected);
  });

  it("replaces the whole store with a valid body and refuses an invalid one", () => {
    const store = createRelationsStore({ storage: memory() });
    const body = { user: { value: -6, updated_at: 1, log: [] } };

    expect(store.replace(body)).toBe(true);
    expect(store.all()).toEqual(body);
    expect(store.replace("x")).toBe(false);
    expect(store.all()).toEqual(body);
  });
});

describe("readRelationsOf", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { presetId: "bbbb0002", key: "yui.bbbb0002.relations" },
    { presetId: "default", key: "yui.relations" },
  ])("in a window bound to cccc0003 reads $presetId's store from $key", ({ presetId, key }) => {
    const stored = { user: { value: 3, updated_at: 1, log: [] } };
    vi.stubGlobal("location", { search: "?preset=cccc0003" });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === key ? JSON.stringify(stored) : null),
    });

    expect(readRelationsOf(presetId)).toEqual(stored);
  });
});
