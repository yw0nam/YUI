import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parsePresetState,
  presetIdForWindow,
  presetNameFor,
  readPresetName,
  resolvePresetKey,
} from "./active-preset";

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

it.each([
  ["?preset=bbbb0002&edit=cccc0003", "cccc0003"],
  ["?preset=bbbb0002", "bbbb0002"],
  ["", "aaaa0001"],
])("presetIdForWindow of %s is %s", (search, id) => {
  vi.stubGlobal("location", { search });
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify({ active: "aaaa0001", list: [{ id: "aaaa0001", name: "A" }] }),
  });
  expect(presetIdForWindow()).toBe(id);
});

describe("presetNameFor", () => {
  const state = {
    active: "aaaa0001",
    list: [
      { id: "aaaa0001", name: "Alpha" },
      { id: "bbbb0002", name: "Beta" },
    ],
  };

  it.each([
    ["returns the bound entry's name", "bbbb0002", "Beta"],
    ["returns the active entry's name when nothing is bound", null, "Alpha"],
    ["returns the id when the bound id is missing from the list", "cccc0003", "cccc0003"],
  ])("%s", (_name, boundId, expected) => {
    expect(presetNameFor(state, boundId)).toBe(expected);
  });
});

describe("parsePresetState", () => {
  it("keeps a valid crop on an entry with a thumbnail and drops the rest", () => {
    const crop = { x: 0.2, y: 0.05, size: 0.5 };
    expect(
      parsePresetState({
        active: "aaaa0001",
        list: [
          { id: "aaaa0001", name: "Alpha", thumbnail: "asset://x/a.png", crop },
          { id: "bbbb0002", name: "Beta", crop },
          {
            id: "cccc0003",
            name: "Gamma",
            thumbnail: "asset://x/c.png",
            crop: { ...crop, size: 2 },
          },
        ],
      })?.list,
    ).toEqual([
      { id: "default", name: "default" },
      { id: "aaaa0001", name: "Alpha", thumbnail: "asset://x/a.png", crop },
      { id: "bbbb0002", name: "Beta" },
      { id: "cccc0003", name: "Gamma", thumbnail: "asset://x/c.png" },
    ]);
  });

  it("keeps a string thumbnail on the entry and drops any other value", () => {
    expect(
      parsePresetState({
        active: "aaaa0001",
        list: [
          { id: "aaaa0001", name: "Alpha", thumbnail: "asset://x/a.png" },
          { id: "bbbb0002", name: "Beta", thumbnail: 42 },
        ],
      }),
    ).toEqual({
      active: "aaaa0001",
      list: [
        { id: "default", name: "default" },
        { id: "aaaa0001", name: "Alpha", thumbnail: "asset://x/a.png" },
        { id: "bbbb0002", name: "Beta" },
      ],
    });
  });
});

it.each([
  ["a listed id gives its name", "bbbb0002", "Beta"],
  ["an unlisted id gives the id", "cccc0003", "cccc0003"],
])("readPresetName: %s", (_name, id, expected) => {
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        active: "aaaa0001",
        list: [
          { id: "aaaa0001", name: "Alpha" },
          { id: "bbbb0002", name: "Beta" },
        ],
      }),
  });
  expect(readPresetName(id)).toBe(expected);
});
