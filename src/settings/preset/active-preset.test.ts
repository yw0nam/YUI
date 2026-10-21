import { afterEach, describe, expect, it, vi } from "vitest";
import { presetNameFor, resolvePresetKey } from "./active-preset";

afterEach(() => vi.unstubAllGlobals());
it.each([
  ["?preset=bbbb0002", "yui.bbbb0002.endpoints"],
  ["", "yui.aaaa0001.endpoints"],
])("resolves keys in this window %s", (search, key) => {
  vi.stubGlobal("location", { search });
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify({ active: "aaaa0001", list: [{ id: "aaaa0001", name: "A" }] }),
  });
  expect(resolvePresetKey("yui.endpoints")).toBe(key);
});

describe("presetNameFor", () => {
  const state = {
    active: "aaaa0001",
    list: [
      { id: "aaaa0001", name: "Alpha" },
      { id: "bbbb0002", name: "Beta" },
    ],
  };

  it("returns the bound entry's name", () => {
    expect(presetNameFor(state, "bbbb0002")).toBe("Beta");
  });

  it("returns the active entry's name when nothing is bound", () => {
    expect(presetNameFor(state, null)).toBe("Alpha");
  });

  it("returns the id when the bound id is missing from the list", () => {
    expect(presetNameFor(state, "cccc0003")).toBe("cccc0003");
  });
});
