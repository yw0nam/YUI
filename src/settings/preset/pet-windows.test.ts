// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import {
  clearStaleLiveKeys,
  clearWindowLive,
  createPetWindows,
  isPresetWindowLive,
  readOpenPetWindowIds,
  setWindowLive,
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
  setWindowLive("pet-a");
  setWindowLive("pet-b");
  clearWindowLive("pet-a");
  expect(isPresetWindowLive("a")).toBe(false);
  expect(isPresetWindowLive("b")).toBe(true);
});

it("clears only stale live keys while iteration remains stable", () => {
  setWindowLive("pet-gone-a");
  setWindowLive("pet-gone-b");
  setWindowLive("pet-present");
  setWindowLive("settings-present");
  setWindowLive("message-gone");
  localStorage.setItem("yui.windows", JSON.stringify({ open: ["present"] }));
  clearStaleLiveKeys(["pet-present", "settings-present"]);
  expect(isPresetWindowLive("gone-a")).toBe(false);
  expect(isPresetWindowLive("gone-b")).toBe(false);
  expect(isPresetWindowLive("present")).toBe(true);
  expect(localStorage.getItem("yui.live-window.settings-present")).toBe("1");
  expect(localStorage.getItem("yui.live-window.message-gone")).toBeNull();
  expect(readOpenPetWindowIds()).toEqual(["present"]);
});
