/**
 * The Threads window's open and close, one at a time: show and grow, shrink and hide, then tell
 * main. An open while it shows brings it forward, keeping its frame, selection and filters, and
 * switches to the tab it names.
 */

import type { ScreenRect } from "../../contract";
import type { ThreadsTab } from "../../io/bridge/settings-bridge";
import { createSerialQueue } from "../../io/window/serial-queue";
import { createLogger } from "../../logger";

const log = createLogger("threads-presence");

export function createThreadsPresence(deps: {
  view: {
    open(from: ScreenRect | null, tab?: ThreadsTab): Promise<void>;
    close(): Promise<void>;
    select(tab: ThreadsTab): void;
  };
  /** Places and shows the window; resolves where the grow starts (window-local px), or null with no chip. */
  show(chip?: ScreenRect): Promise<ScreenRect | null>;
  /** Brings the shown window to the front where it is. */
  focus(): Promise<void>;
  hide(): Promise<void>;
  emitClosed(): void;
}): { open(chip?: ScreenRect, tab?: ThreadsTab): void; close(): void } {
  let shown = false;
  const queue = createSerialQueue();

  async function hide(): Promise<void> {
    shown = false;
    await deps.hide().catch((error) => log.warn("threads_hide_failed", { error: String(error) }));
    deps.emitClosed();
  }

  return {
    open(chip, tab) {
      queue(async () => {
        if (shown) {
          if (tab) deps.view.select(tab);
          await deps
            .focus()
            .catch((error) => log.warn("threads_focus_failed", { error: String(error) }));
          return;
        }
        try {
          const from = await deps.show(chip);
          shown = true;
          await deps.view.open(from, tab);
        } catch (error) {
          log.error("threads_open_failed", { error: String(error) });
          await hide();
        }
      });
    },
    close() {
      queue(async () => {
        if (!shown) return;
        await deps.view.close();
        await hide();
      });
    },
  };
}
