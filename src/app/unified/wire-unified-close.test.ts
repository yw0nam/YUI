import { expect, it, vi } from "vitest";
import { wireUnifiedClose } from "./wire-unified-close";

it("turns the Unified chat switch off and tells the other windows when the window closes itself", () => {
  let requested: () => void = () => {};
  const order: string[] = [];
  wireUnifiedClose({
    onCloseRequested: (cb) => {
      requested = cb;
    },
    switch: { setEnabled: vi.fn((on: boolean) => void order.push(`switch:${on}`)) },
    emitSettingsChanged: () => void order.push("settings-changed"),
  });

  requested();

  expect(order).toEqual(["switch:false", "settings-changed"]);
});
