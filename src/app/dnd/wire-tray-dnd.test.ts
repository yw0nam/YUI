import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../logger";
import { createFlagSettings } from "../../settings/persisted-store";
import { wireTrayDnd } from "./wire-tray-dnd";

function setup(enabled: boolean) {
  const dnd = createFlagSettings(enabled);
  let trayHandler: ((event: { payload: boolean }) => void) | undefined;
  const win = {
    listen: vi.fn(async (_event: "tray-dnd", handler: (event: { payload: boolean }) => void) => {
      trayHandler = handler;
      return () => {};
    }),
  };
  const setTray = vi.fn(async (_on: boolean) => {});
  const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  wireTrayDnd({ dnd, win, setTray, log });
  return { dnd, win, setTray, log, click: (payload: boolean) => trayHandler?.({ payload }) };
}

describe("wireTrayDnd", () => {
  it("sets the tray check to the store on start and on every change", () => {
    const { dnd, setTray } = setup(true);
    dnd.setEnabled(false);

    expect(setTray.mock.calls).toEqual([[true], [false]]);
  });

  it("writes the store from a tray click and logs it as via the tray", async () => {
    const { dnd, win, log, click } = setup(false);
    await Promise.resolve();
    click(true);

    expect(win.listen).toHaveBeenCalledWith("tray-dnd", expect.any(Function));
    expect(dnd.get()).toEqual({ enabled: true });
    expect(log.info).toHaveBeenCalledWith("dnd_toggle", { enabled: true, via: "tray" });
  });
});
