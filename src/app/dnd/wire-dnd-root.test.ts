// @vitest-environment jsdom
/** wire-dnd-root.test.ts — data-yui-dnd on the window root follows the do-not-disturb store. */

import { describe, expect, it } from "vitest";
import { createFlagSettings } from "../../settings/persisted-store";
import { wireDndRoot } from "./wire-dnd-root";

describe("wireDndRoot", () => {
  it("sets data-yui-dnd while the store starts on, removes it when it turns off, sets it again when it turns on", () => {
    const dnd = createFlagSettings(true);
    const root = document.documentElement;
    wireDndRoot({ dnd, root });
    expect(root.hasAttribute("data-yui-dnd")).toBe(true);

    dnd.setEnabled(false);
    expect(root.hasAttribute("data-yui-dnd")).toBe(false);

    dnd.setEnabled(true);
    expect(root.hasAttribute("data-yui-dnd")).toBe(true);
  });
});
