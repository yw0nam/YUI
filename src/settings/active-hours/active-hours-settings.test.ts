/**
 * active-hours-settings.test.ts — the per-character active-hours store.
 *
 * Pins the stored-value recovery, the reset to null, and the copies the store keeps.
 */

import { describe, expect, it } from "vitest";
import type { PersistedStorage } from "../persisted-store";
import { createActiveHoursSettings } from "./active-hours-settings";
import type { Span } from "./spans";

type StoreValue = { spans: Span[] | null };

function inMemoryStorage(
  initial: unknown = null,
): PersistedStorage<StoreValue> & { saved: unknown } {
  const box = {
    saved: initial,
    load: () => box.saved as StoreValue | null,
    save: (s: StoreValue) => {
      box.saved = s;
    },
  };
  return box;
}

const SPANS: Span[] = [{ start: "09:00", end: "10:00", pace: "low" }];

describe("createActiveHoursSettings", () => {
  it("an invalid stored value loads as { spans: null }", () => {
    const store = createActiveHoursSettings({ storage: inMemoryStorage({ spans: "nope" }) });
    expect(store.get()).toEqual({ spans: null });
  });

  it("reset() returns the store to null spans", () => {
    const store = createActiveHoursSettings({ storage: inMemoryStorage() });
    store.setSpans(SPANS);
    store.reset();
    expect(store.get()).toEqual({ spans: null });
  });

  it("shares no span array with its callers", () => {
    const store = createActiveHoursSettings({ storage: inMemoryStorage() });
    const given: Span[] = [{ start: "09:00", end: "10:00", pace: "low" }];
    store.setSpans(given);
    given[0].start = "23:00";
    expect(store.get()).toEqual({ spans: SPANS });
    store.get().spans![0].start = "01:00";
    expect(store.get()).toEqual({ spans: SPANS });
  });
});
