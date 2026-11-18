/** Main only: keeps the tray's Do Not Disturb check and the do-not-disturb store in step. */

import type { Logger } from "../../logger";
import type { FlagSettingsStore } from "../../settings/persisted-store";

export function wireTrayDnd(deps: {
  dnd: Pick<FlagSettingsStore, "get" | "setEnabled" | "subscribe">;
  win: {
    listen(event: "tray-dnd", handler: (event: { payload: boolean }) => void): Promise<() => void>;
  };
  setTray: (on: boolean) => Promise<void>;
  log: Logger;
}): () => void {
  const { dnd, win, setTray, log } = deps;
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
      log.info("dnd", { enabled: payload, via: "tray" });
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
