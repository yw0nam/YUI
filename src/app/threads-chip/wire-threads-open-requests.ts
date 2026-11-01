/** Main's other ways into the Threads window: the tray's Terminal item and a quick card's request open it on their tab, with no chip to grow from. */

import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { ThreadsWindowController } from "../../io/window/openers/threads-window";

export function wireThreadsOpenRequests(deps: {
  /** The tray's Terminal item. */
  onTerminalOpen(cb: () => void): () => void;
  onThreadsOpenRequest: SettingsBridge["onThreadsOpenRequest"];
  threadsWindow: Pick<ThreadsWindowController, "open"> | null;
}): () => void {
  const { threadsWindow } = deps;
  if (!threadsWindow) return () => {};
  const offTray = deps.onTerminalOpen(() => threadsWindow.open(undefined, "terminal"));
  const offRequest = deps.onThreadsOpenRequest((tab) => threadsWindow.open(undefined, tab));
  return () => {
    offTray();
    offRequest();
  };
}
