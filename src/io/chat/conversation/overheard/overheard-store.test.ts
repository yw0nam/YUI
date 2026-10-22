import { describe, expect, it } from "vitest";
import { createOverheardStore } from "./overheard-store";

describe("createOverheardStore", () => {
  it.each([
    { name: "a stored cursor", stored: { p1: { ts: 5, n: 2 } }, expected: { ts: 5, n: 2 } },
    { name: "a malformed stored cursor", stored: { p1: { ts: "5" } }, expected: { ts: 0, n: 0 } },
    { name: "no stored cursor", stored: {}, expected: { ts: 0, n: 0 } },
  ])("get returns $name", ({ stored, expected }) => {
    const store = createOverheardStore({
      storage: { load: () => stored as never, save: () => {} },
    });
    expect(store.get("p1")).toEqual(expected);
  });
});
