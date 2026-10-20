// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { createLogger } from "../../logger";
import {
  createPetWindows,
  isPresetWindowLive,
  setWindowLive,
} from "../../settings/preset/pet-windows";
import { wirePetWindowsReconcile } from "./wire-pet-windows-reconcile";

beforeEach(() => localStorage.clear());
const registry = {
  get: () => ({
    active: "default",
    list: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
  }),
};
it.each([[], null])("prunes intent with known or unknown native windows: %j", async (existing) => {
  const petWindows = createPetWindows();
  petWindows.open("a");
  petWindows.open("orphan");
  setWindowLive("pet-stale");
  const open = vi.fn(async () => {});
  const off = wirePetWindowsReconcile({
    petWindows,
    registry,
    opener: { existing: async () => existing, open, onDestroyed: async () => () => {} },
    log: createLogger("test"),
  });
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith("a"));
  expect(petWindows.get()).toEqual(["a"]);
  expect(isPresetWindowLive("stale")).toBe(existing === null);
  off();
});
it.each(["event", "registration race"])("reopens after destruction: %s", async (mode) => {
  const petWindows = createPetWindows();
  petWindows.open("a");
  let exists = true;
  let destroyed: (() => void) | undefined;
  const open = vi.fn(async () => {});
  const off = wirePetWindowsReconcile({
    petWindows,
    registry,
    opener: {
      existing: async () => (exists ? ["pet-a"] : []),
      open,
      onDestroyed: async (_id, cb) => {
        destroyed = cb;
        if (mode === "registration race") exists = false;
        return () => {};
      },
    },
    log: createLogger("test"),
  });
  if (mode === "event") {
    await vi.waitFor(() => expect(typeof destroyed).toBe("function"));
    exists = false;
    destroyed!();
  }
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith("a"));
  off();
});
it("serializes changes and continues after an opener failure", async () => {
  const petWindows = createPetWindows();
  petWindows.open("a");
  let release!: () => void;
  const calls: string[] = [];
  const open = vi.fn(async (id: string) => {
    calls.push(id);
    if (id === "a") {
      await new Promise<void>((r) => {
        release = r;
      });
      throw Error("open");
    }
  });
  const off = wirePetWindowsReconcile({
    petWindows,
    registry,
    opener: { existing: async () => [], open, onDestroyed: async () => () => {} },
    log: createLogger("test"),
  });
  await vi.waitFor(() => expect(calls).toEqual(["a"]));
  petWindows.close("a");
  petWindows.open("b");
  petWindows.invalidate();
  release();
  await vi.waitFor(() => expect(calls).toEqual(["a", "b"]));
  off();
});
