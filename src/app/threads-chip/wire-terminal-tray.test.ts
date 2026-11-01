/** wire-terminal-tray.test.ts — the tray's Terminal item opens the Threads window on the Terminal tab with no chip rect. */

import { expect, it, vi } from "vitest";
import { wireTerminalTray } from "./wire-terminal-tray";

it("opens the Terminal tab with no chip rect on the tray's terminal open", () => {
  const open = vi.fn(() => true);
  let trayOpen = () => {};
  wireTerminalTray({
    onTerminalOpen: (cb) => {
      trayOpen = cb;
      return () => {};
    },
    threadsWindow: { open },
  });

  trayOpen();

  expect(open).toHaveBeenCalledWith(undefined, "terminal");
});
