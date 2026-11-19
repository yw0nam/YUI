/**
 * base-pace-settings.test.ts — the device-wide base pace store.
 *
 * Pins the stored-value recovery: anything but a non-off pace loads as the default.
 */

import { describe, expect, it } from "vitest";
import type { PersistedStorage } from "../persisted-store";
import { type BasePaceSettings, createBasePaceSettings } from "./base-pace-settings";

function inMemoryStorage(
  initial: unknown = null,
): PersistedStorage<BasePaceSettings> & { saved: unknown } {
  const box = {
    saved: initial,
    load: () => box.saved as BasePaceSettings | null,
    save: (s: BasePaceSettings) => {
      box.saved = s;
    },
  };
  return box;
}

describe("createBasePaceSettings", () => {
  it.each([
    ["off"],
    ["nope"],
  ] as const)("an invalid stored pace %s loads as the normal default", (pace) => {
    const store = createBasePaceSettings({ storage: inMemoryStorage({ pace }) });
    expect(store.get()).toEqual({ pace: "normal" });
  });
});
