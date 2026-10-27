/** Closes the quick card when no YUI window holds focus, and hides its window on every close. */

import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";
import type { QuickCard } from "../../ui/quick-card/quick-card";

const log = createLogger("quick-card-close");

/** How often the focus poll looks for a YUI window holding focus. */
const FOCUS_POLL_MS = 300;

/** The poll runs from the card window's first focus after an open until the card closes. */
export function wireQuickCardClose(deps: {
  card: Pick<QuickCard, "close" | "isOpen" | "onClose">;
  hide(): void | Promise<void>;
}): { dispose(): void } {
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let offFocus = (): void => {};
  const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const tick = (): void => {
    void (async () => {
      const { getAllWindows } = await import("@tauri-apps/api/window");
      const windows = await getAllWindows();
      for (const win of windows) {
        if (await win.isFocused()) return;
      }
      // Focus left the app: card → pet window → another app lands here on one tick.
      log.info("quick_card_focus_lost");
      deps.card.close();
    })().catch((error) => log.debug("quick_card_focus_poll_failed", { error: String(error) }));
  };
  const offClose = deps.card.onClose(() => {
    stop();
    void Promise.resolve(deps.hide()).catch((error) =>
      log.warn("quick_card_hide_failed", { error: String(error) }),
    );
  });
  if (isTauri()) {
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const off = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused && timer === null && deps.card.isOpen())
          timer = setInterval(tick, FOCUS_POLL_MS);
      });
      if (disposed) off();
      else offFocus = off;
    })().catch((error) => log.warn("quick_card_focus_listen_failed", { error: String(error) }));
  }
  return {
    dispose() {
      disposed = true;
      stop();
      offClose();
      offFocus();
    },
  };
}
