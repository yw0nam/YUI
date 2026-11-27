/** Main only: keeps the tray's Do Not Disturb check on a running Rest or Focus, and turns a click into End now or Until I turn it off; a no-op off Tauri. */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { setTrayDnd } from "../../io/window/tray-dnd";
import type { Logger } from "../../logger";
import type { RestSettingsStore } from "../../settings/rest/rest-settings";
import { isTauri } from "../../tauri-env";
import type { WindowActiveHours } from "../active-hours/window-active-hours";

interface TrayWindow {
  listen(event: "tray-dnd", handler: (event: { payload: boolean }) => void): Promise<() => void>;
}

export function wireTrayDnd(deps: {
  rest: Pick<WindowActiveHours, "rest" | "subscribeRest">;
  restSettings: Pick<RestSettingsStore, "start" | "end">;
  log: Logger;
  /** Injectable; defaults to this Tauri window. */
  win?: TrayWindow;
  /** Injectable; defaults to the set_tray_dnd command. */
  setTray?: (on: boolean) => Promise<void>;
}): () => void {
  if (!deps.win && !isTauri()) return () => {};
  const { rest, restSettings, log } = deps;
  const win = deps.win ?? getCurrentWindow();
  const setTray = deps.setTray ?? setTrayDnd;
  // A quiet span holds her too, but the tray item is the Rest switch.
  const running = (): boolean => {
    const kind = rest.rest()?.kind;
    return kind === "rest" || kind === "focus";
  };
  let sent: boolean | undefined;
  /** Sends the check when it changed; a click sends it anyway, since the native item flipped itself. */
  const sync = (force = false): void => {
    const on = running();
    if (on === sent && !force) return;
    sent = on;
    setTray(on).catch((error: unknown) =>
      log.warn("tray_dnd_set_failed", { on, error: String(error) }),
    );
  };
  sync();
  const unsubscribe = rest.subscribeRest(() => sync());
  let disposed = false;
  let unlisten: (() => void) | undefined;
  // The click's own check state is stale once a Rest has ended unseen, so the click reads the state now.
  win
    .listen("tray-dnd", () => {
      const end = running();
      if (end) restSettings.end();
      else restSettings.start("until_off");
      log.info("rest_set", { choice: end ? "end" : "until_off", via: "tray" });
      sync(true);
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
