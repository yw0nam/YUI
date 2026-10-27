/**
 * quick-card-close — the quick-card window's close side: the focus poll that closes the card
 * when no YUI window holds focus, and the window hide that follows every close of the card.
 * Escape, the margin click, ×, All settings… and Turn off close through the card itself.
 */

import { createLogger } from "../../logger";
import type { QuickCard } from "../../ui/quick-card/quick-card";

const log = createLogger("quick-card-close");

/** How often the focus poll looks for a YUI window holding focus. */
const FOCUS_POLL_MS = 300;

export function wireQuickCardClose(deps: {
  card: Pick<QuickCard, "close" | "isOpen" | "onClose">;
  hide(): void | Promise<void>;
}): { dispose(): void } {
  const hideWindow = (): void => {
    void Promise.resolve(deps.hide()).catch((error) =>
      log.warn("quick_card_hide_failed", { error: String(error) }),
    );
  };
  const offClose = deps.card.onClose(hideWindow);
  const timer = setInterval(() => {
    void (async () => {
      if (!deps.card.isOpen()) return;
      const { getAllWindows } = await import("@tauri-apps/api/window");
      const windows = await getAllWindows();
      for (const win of windows) {
        if (await win.isFocused()) return;
      }
      // Focus left the app: card → pet window → another app lands here on one tick.
      log.info("quick_card_focus_lost");
      deps.card.close();
    })().catch((error) => log.debug("quick_card_focus_poll_failed", { error: String(error) }));
  }, FOCUS_POLL_MS);
  return {
    dispose() {
      clearInterval(timer);
      offClose();
    },
  };
}
