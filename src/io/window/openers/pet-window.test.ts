import { expect, it, vi } from "vitest";
import { openPetWindow } from "./pet-window";

it.each([true, false])("opens in the selected runtime: %s", async (isTauri) => {
  const createTauriWindow = vi.fn(async () => {}),
    openBrowserWindow = vi.fn();
  await openPetWindow({ isTauri, createTauriWindow, openBrowserWindow });
  expect(createTauriWindow).toHaveBeenCalledTimes(isTauri ? 1 : 0);
  expect(openBrowserWindow).toHaveBeenCalledTimes(isTauri ? 0 : 1);
});
