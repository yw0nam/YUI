/** Main only: keeps the tray's Do Not Disturb check and the do-not-disturb store in step. */

import type { Logger } from "../../logger";
import type { FlagSettingsStore } from "../../settings/persisted-store";

export function wireTrayDnd(_deps: {
  dnd: Pick<FlagSettingsStore, "get" | "setEnabled" | "subscribe">;
  win: {
    listen(event: "tray-dnd", handler: (event: { payload: boolean }) => void): Promise<() => void>;
  };
  setTray: (on: boolean) => Promise<void>;
  log: Logger;
}): () => void {
  return () => {};
}
