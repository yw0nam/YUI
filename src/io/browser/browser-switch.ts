import { createLogger } from "../../logger";
import type { FlagSettingsStore } from "../../settings/persisted-store";
import type { BrowserShell } from "./browser-shell";

const log = createLogger("browser");

/** Stops the owned Chrome each time the browser switch turns off. Returns the unsubscribe. */
export function stopBrowserWhenOff(
  settings: Pick<FlagSettingsStore, "get" | "subscribe">,
  shell: Pick<BrowserShell, "stop">,
): () => void {
  let on = settings.get().enabled;
  return settings.subscribe(() => {
    const next = settings.get().enabled;
    if (on && !next) {
      void shell.stop().catch((err) => log.warn("browser_stop_failed", { error: String(err) }));
    }
    on = next;
  });
}
