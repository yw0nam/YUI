// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { createSettingsBridge } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import { isPetWindowLive } from "../../settings/preset/pet-windows";
import { createPetWindowRole } from "./pet-window-role";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "yui.presets",
    JSON.stringify({ active: "default", list: [{ id: "a", name: "A" }] }),
  );
});
function bridge() {
  return createSettingsBridge({ emit: () => {}, listen: () => () => {} }, { windowKind: "pet" });
}
it("closes an orphan before constructing window stores", () => {
  const close = vi.fn(),
    bus = bridge();
  const off = vi.spyOn(bus, "dispose");
  expect(
    createPetWindowRole({
      boundId: "missing",
      disposeWindow: () => {},
      bridge: bus,
      close,
      log: createLogger("test"),
    }),
  ).toBeNull();
  expect(close).toHaveBeenCalledTimes(1);
  expect(off).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("yui.pet-window.missing")).toBeNull();
});
it.each([false, true])("disposes lifecycle even if application teardown throws: %s", (throwing) => {
  const bus = bridge(),
    off = vi.spyOn(bus, "dispose"),
    disposeWindow = vi.fn(() => {
      if (throwing) throw Error("dispose failed");
    });
  const role = createPetWindowRole({
    boundId: null,
    disposeWindow,
    bridge: bus,
    opener: { open: async () => {}, existing: async () => [], onDestroyed: async () => () => {} },
    log: createLogger("test"),
  })!;
  if (throwing) expect(() => role.dispose()).toThrow("dispose failed");
  else role.dispose();
  expect(disposeWindow).toHaveBeenCalledTimes(1);
  expect(off).toHaveBeenCalledTimes(1);
});
it("owns bound synchronization until application stores stop", async () => {
  localStorage.setItem("yui.windows", JSON.stringify({ open: ["a"] }));
  const bus = bridge(),
    calls: string[] = [];
  const emit = vi.spyOn(bus, "emitPetWindowsChanged");
  const role = createPetWindowRole({
    boundId: "a",
    disposeWindow: () => {
      expect(isPetWindowLive("a")).toBe(true);
      calls.push("stores");
    },
    bridge: bus,
    close: () => {
      calls.push("close");
    },
    log: createLogger("test"),
  })!;
  role.petWindows.close("a");
  await vi.waitFor(() => expect(calls).toEqual(["stores", "close"]));
  expect(isPetWindowLive("a")).toBe(false);
  expect(emit).toHaveBeenCalled();
});
