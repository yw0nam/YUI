// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import {
  clearPetWindowLive,
  createPetWindows,
  isPetWindowLive,
  readOpenPetWindowIds,
  setPetWindowLive,
} from "./pet-windows";

beforeEach(() => localStorage.clear());
it("persists intent, dedupes, rereads before edits and prunes", () => {
  const a = createPetWindows(),
    b = createPetWindows();
  a.open("a");
  b.open("b");
  b.open("b");
  a.reloadFromStorage();
  expect(a.get()).toEqual(["a", "b"]);
  a.close("a");
  a.prune(["b"]);
  expect(readOpenPetWindowIds()).toEqual(["b"]);
  a.prune([]);
  expect(readOpenPetWindowIds()).toEqual([]);
});
it("invalidates subscribers without changing intent", () => {
  const s = createPetWindows();
  const seen: string[][] = [];
  s.subscribe((v) => seen.push(v));
  s.invalidate();
  expect(seen).toEqual([[]]);
});
it.each(["not json", "null", '{"open":12}'])("rejects malformed storage %s", (raw) => {
  localStorage.setItem("yui.windows", raw);
  expect(readOpenPetWindowIds()).toEqual([]);
});
it("keeps independent live keys", () => {
  setPetWindowLive("a");
  setPetWindowLive("b");
  clearPetWindowLive("a");
  expect(isPetWindowLive("a")).toBe(false);
  expect(isPetWindowLive("b")).toBe(true);
});
