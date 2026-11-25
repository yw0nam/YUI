/**
 * last-together-settings.test.ts — the `yui.last-together` store.
 *
 * Locks: a stored value that is not `{ at: <number> }` is rejected for the defaults.
 */

import { describe, expect, it } from "vitest";
import { createLastTogetherSettings, type LastTogetherSettings } from "./last-together-settings";

function storageWith(loaded: unknown): {
  load: () => LastTogetherSettings | null;
  save: (s: LastTogetherSettings) => void;
} {
  return { load: () => loaded as LastTogetherSettings | null, save: () => {} };
}

describe("createLastTogetherSettings — parse", () => {
  const cases: Array<[string, unknown]> = [
    ["a string at", { at: "2026-11-25 08:12" }],
    ["an array", ["nope"]],
    ["a bare number", 1_717_000_000_000],
  ];

  it.each(cases)("%s -> the defaults", (_name, loaded) => {
    const store = createLastTogetherSettings({ storage: storageWith(loaded) });
    expect(store.get()).toEqual({ at: null });
  });
});

describe("createLastTogetherSettings — record", () => {
  function spyStorage(): {
    storage: { load: () => null; save: (s: LastTogetherSettings) => void };
    saves: LastTogetherSettings[];
  } {
    const saves: LastTogetherSettings[] = [];
    return { storage: { load: () => null, save: (s) => saves.push(s) }, saves };
  }

  it("writes once inside a minute of the last write", () => {
    const { storage, saves } = spyStorage();
    const store = createLastTogetherSettings({ storage });

    store.record(1_000);
    store.record(31_000);

    expect(saves).toEqual([{ at: 1_000 }]);
  });

  it("writes again past a minute of the last write", () => {
    const { storage, saves } = spyStorage();
    const store = createLastTogetherSettings({ storage });

    store.record(1_000);
    store.record(31_000);
    store.record(61_000);

    expect(saves).toEqual([{ at: 1_000 }, { at: 61_000 }]);
  });
});
