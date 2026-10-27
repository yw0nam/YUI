/** Closes the quick card when no YUI window holds focus, and hides its window on every close. */

import { createLogger } from "../../logger";
import type { QuickCard } from "../../ui/quick-card/quick-card";

const log = createLogger("quick-card-close");

/** How often the focus poll looks for a YUI window holding focus. */
const FOCUS_POLL_MS = 300;

export function wireQuickCardClose(deps: {
  card: Pick<QuickCard, "close" | "onClose">;
  hide(): void | Promise<void>;
}): { watch(): void; dispose(): void } {
  let timer: ReturnType<typeof setInterval> | null = null;
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
  return {
    /** Starts the poll once the card's window has taken focus; the card's close stops it. */
    watch() {
      if (timer === null) timer = setInterval(tick, FOCUS_POLL_MS);
    },
    dispose() {
      stop();
      offClose();
    },
  };
}
