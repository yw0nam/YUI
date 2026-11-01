/** The tray's Terminal item: the app event `terminal-open` the Rust shell emits on its click. */

import { listen } from "@tauri-apps/api/event";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

const log = createLogger("terminal-open-event");

/** Calls `cb` on each tray Terminal click; inert off Tauri. */
export function onTerminalOpen(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  let stop: (() => void) | undefined;
  let disposed = false;
  listen("terminal-open", () => cb()).then(
    (unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    },
    (error) => log.warn("terminal_open.listen_failed", { error: String(error) }),
  );
  return () => {
    disposed = true;
    stop?.();
  };
}
