import { expect, it, vi } from "vitest";
import { wireUnifiedClose } from "./wire-unified-close";

it("turns the Unified chat switch off and tells the other windows when the window closes itself", async () => {
  let requested: () => void = () => {};
  const order: string[] = [];
  const unlisten = vi.fn();
  const dispose = await wireUnifiedClose({
    listenCloseRequested: async (cb) => {
      requested = cb;
      return unlisten;
    },
    switch: { setEnabled: vi.fn((on: boolean) => void order.push(`switch:${on}`)) },
    emitSettingsChanged: () => void order.push("settings-changed"),
  });

  requested();
  dispose();

  expect(order).toEqual(["switch:false", "settings-changed"]);
  expect(unlisten).toHaveBeenCalledOnce();
});
