/** Main only: keeps the tray's Do Not Disturb check and the do-not-disturb store in step; a no-op off Tauri. */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { setTrayDnd } from "../../io/window/tray-dnd";
import type { Logger } from "../../logger";
import type { FlagSettingsStore } from "../../settings/persisted-store";
import { isTauri } from "../../tauri-env";

interface TrayWindow {
  listen(event: "tray-dnd", handler: (event: { payload: boolean }) => void): Promise<() => void>;
}

export function wireTrayDnd(deps: {
  dnd: Pick<FlagSettingsStore, "get" | "setEnabled" | "subscribe">;
  log: Logger;
  /** Injectable; defaults to this Tauri window. */
  win?: TrayWindow;
  /** Injectable; defaults to the set_tray_dnd command. */
  setTray?: (on: boolean) => Promise<void>;
}): () => void {
  if (!deps.win && !isTauri()) return () => {};
  const { dnd, log } = deps;
  const win = deps.win ?? getCurrentWindow();
  const setTray = deps.setTray ?? setTrayDnd;
  const sync = (): void => {
    const on = dnd.get().enabled;
    setTray(on).catch((error: unknown) =>
      log.warn("tray_dnd_set_failed", { on, error: String(error) }),
    );
  };
  sync();
  const unsubscribe = dnd.subscribe(sync);
  let disposed = false;
  let unlisten: (() => void) | undefined;
  win
    .listen("tray-dnd", ({ payload }) => {
      dnd.setEnabled(payload);
      log.info("dnd_toggle", { enabled: payload, via: "tray" });
    })
    .then((off) => {
      if (disposed) off();
      else unlisten = off;
    })
    .catch((error: unknown) => log.warn("tray_dnd_listen_failed", { error: String(error) }));
  return () => {
    disposed = true;
    unsubscribe();
    unlisten?.();
  };
}
