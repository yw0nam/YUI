import { afterEach, expect, it, vi } from "vitest";
import { resolvePresetKey } from "./active-preset";

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
