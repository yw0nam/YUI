// @vitest-environment jsdom
/**
 * delegation-chip-settings.test.ts — the chip's per-device fold choice: collapsed chip with only
 * its dot and count badge, persisted so a relaunch keeps the choice.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  createDelegationChipSettings,
  localStorageDelegationChipStorage,
} from "./delegation-chip-settings";

afterEach(() => {
  globalThis.localStorage?.removeItem("yui.test.delegation-chip");
});

describe("createDelegationChipSettings", () => {
  it("starts expanded", () => {
    expect(createDelegationChipSettings().get()).toEqual({ collapsed: false });
  });

  it("commits the collapsed choice and notifies subscribers", () => {
    const seen: boolean[] = [];
    const s = createDelegationChipSettings();
    s.subscribe((v) => seen.push(v.collapsed));

    s.setCollapsed(true);

    expect(s.get()).toEqual({ collapsed: true });
    expect(seen).toEqual([true]);
  });

  it("ignores a stored value that is not a boolean flag", () => {
    globalThis.localStorage?.setItem(
      "yui.test.delegation-chip",
      JSON.stringify({ collapsed: "yes" }),
    );
    expect(
      createDelegationChipSettings({
        storage: localStorageDelegationChipStorage("yui.test.delegation-chip"),
      }).get(),
    ).toEqual({ collapsed: false });
  });

  it("restores the stored choice in a fresh store — the per-device persistence", () => {
    const storage = localStorageDelegationChipStorage("yui.test.delegation-chip");
    createDelegationChipSettings({ storage }).setCollapsed(true);

    expect(createDelegationChipSettings({ storage }).get()).toEqual({ collapsed: true });
  });

  it("reloads a choice another window wrote to the same storage", () => {
    const storage = localStorageDelegationChipStorage("yui.test.delegation-chip");
    const s = createDelegationChipSettings({ storage });

    createDelegationChipSettings({ storage }).setCollapsed(true);
    s.reloadFromStorage();

    expect(s.get()).toEqual({ collapsed: true });
  });
});
