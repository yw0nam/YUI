// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { createPetWindows } from "../../settings/preset/pet-windows";
import { wirePetWindowsSync } from "./wire-pet-windows-sync";

beforeEach(() => localStorage.clear());
it("broadcasts local edits and invalidates remote live changes without echo", () => {
  const petWindows = createPetWindows();
  let remote = () => {};
  const emit = vi.fn(async () => {});
  const off = wirePetWindowsSync({
    petWindows,
    bridge: {
      emitPetWindowsChanged: emit,
      onPetWindowsChanged: (cb) => {
        remote = cb;
        return () => {};
      },
    },
  });
  petWindows.open("a");
  expect(emit).toHaveBeenCalledTimes(1);
  const changed = vi.fn();
  petWindows.subscribe(changed);
  remote();
  expect(changed).toHaveBeenCalledWith(["a"]);
  expect(emit).toHaveBeenCalledTimes(1);
  localStorage.setItem("yui.windows", JSON.stringify({ open: ["b"] }));
  remote();
  expect(petWindows.get()).toEqual(["b"]);
  expect(emit).toHaveBeenCalledTimes(1);
  off();
});
