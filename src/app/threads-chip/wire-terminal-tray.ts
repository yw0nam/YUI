/** Main's tray Terminal item: opens the Threads window on the Terminal tab, with no chip to grow from. */

import type { ThreadsWindowController } from "../../io/window/openers/threads-window";

export function wireTerminalTray(deps: {
  /** The tray's Terminal item. */
  onTerminalOpen(cb: () => void): () => void;
  threadsWindow: Pick<ThreadsWindowController, "open"> | null;
}): () => void {
  const { threadsWindow } = deps;
  if (!threadsWindow) return () => {};
  return deps.onTerminalOpen(() => threadsWindow.open(undefined, "terminal"));
}
