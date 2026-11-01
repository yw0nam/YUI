/** wire-threads-open-requests.test.ts — the tray's Terminal item and a quick card's ask open main's Threads window on their tab, with no chip rect. */

import { expect, it, vi } from "vitest";
import type { ThreadsTab } from "../../io/bridge/settings-bridge";
import { wireThreadsOpenRequests } from "./wire-threads-open-requests";

it("opens the asked tab with no chip rect from the tray and from a quick card", () => {
  const open = vi.fn(() => true);
  let trayOpen = () => {};
  let ask: (tab: ThreadsTab) => void = () => {};
  wireThreadsOpenRequests({
    onTerminalOpen: (cb) => {
      trayOpen = cb;
      return () => {};
    },
    onThreadsOpenAsk: (cb) => {
      ask = cb;
      return () => {};
    },
    threadsWindow: { open },
  });

  trayOpen();
  ask("threads");
  ask("terminal");

  expect(open.mock.calls).toEqual([
    [undefined, "terminal"],
    [undefined, "threads"],
    [undefined, "terminal"],
  ]);
});
