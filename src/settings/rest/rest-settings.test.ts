/** rest-settings.test.ts — the stored Rest record: what one window starts or ends, a sibling reads. */

import { describe, expect, it } from "vitest";
import type { PersistedStorage } from "../persisted-store";
import { createRestSettings, type RestRecord } from "./rest-settings";

function sharedStorage(initial: unknown = null): PersistedStorage<RestRecord> {
  let saved: unknown = initial;
  return {
    load: () => saved as RestRecord | null,
    save: (s) => {
      saved = JSON.parse(JSON.stringify(s));
    },
  };
}

const T0 = 1_800_000_000_000;

describe("createRestSettings", () => {
  it("End now in one window clears Rest in a second window on its reload", () => {
    const storage = sharedStorage();
    const a = createRestSettings({ storage });
    const b = createRestSettings({ storage });
    a.start("morning", T0);
    b.reloadFromStorage();
    const running = b.get(T0);

    a.end();
    b.reloadFromStorage();

    expect([running?.choice, b.get(T0)]).toEqual(["morning", null]);
  });

  it("reads a stored on/off flag as Rest until the user turns it off, or off", () => {
    const read = (stored: unknown) =>
      createRestSettings({ storage: sharedStorage(stored) }).get(T0);

    expect([read({ enabled: true }), read({ enabled: false })]).toEqual([
      { choice: "until_off" },
      null,
    ]);
  });

  it("reads an expired record as null and leaves it stored", () => {
    const storage = sharedStorage();
    const store = createRestSettings({ storage });
    store.start("hour", T0);

    expect([store.get(T0 + 3_599_999)?.choice, store.get(T0 + 3_600_000)]).toEqual(["hour", null]);
    expect(storage.load()).toEqual({ choice: "hour", startedAt: T0, endsAt: T0 + 3_600_000 });
  });
});
