/**
 * The Threads window's open and close, one at a time: show and grow, shrink and hide, then tell
 * main. An open while it shows brings it forward, keeping its frame, selection and filters, and
 * switches to the tab it names; an open without focus only orders it front.
 */

import type { ScreenRect } from "../../contract";
import type { ThreadsOpen, ThreadsTab } from "../../io/bridge/settings-bridge";
import { createSerialQueue } from "../../io/window/serial-queue";
import { createLogger } from "../../logger";

const log = createLogger("threads-presence");

/** An automatic open's Thread, its `focus: false`, and the request id it reports presented. */
type PresenceOpen = Pick<ThreadsOpen, "thread" | "focus" | "present">;

export function createThreadsPresence(deps: {
  view: {
    open(from: ScreenRect | null, tab?: ThreadsTab, opts?: PresenceOpen): Promise<void>;
    close(): Promise<void>;
    select(tab: ThreadsTab): void;
  };
  /** Places and shows the window; resolves where the grow starts (window-local px), or null with no chip. */
  show(chip?: ScreenRect, opts?: PresenceOpen): Promise<ScreenRect | null>;
  /** Brings the shown window to the front where it is. */
  focus(): Promise<void>;
  /** Orders the shown window front without focus. */
  raise(): Promise<void>;
  hide(): Promise<void>;
  emitClosed(): void;
  emitPresented(present: string): void;
}): { open(chip?: ScreenRect, tab?: ThreadsTab, opts?: PresenceOpen): void; close(): void } {
  let shown = false;
  const queue = createSerialQueue();

  async function hide(): Promise<void> {
    shown = false;
    await deps.hide().catch((error) => log.warn("threads_hide_failed", { error: String(error) }));
    deps.emitClosed();
  }

  return {
    open(chip, tab, opts = {}) {
      queue(async () => {
        if (shown && opts.focus === false) {
          await deps
            .raise()
            .catch((error) => log.warn("threads_raise_failed", { error: String(error) }));
        } else if (shown) {
          if (tab) deps.view.select(tab);
          await deps
            .focus()
            .catch((error) => log.warn("threads_focus_failed", { error: String(error) }));
        } else {
          try {
            const from = await deps.show(chip, opts);
            shown = true;
            await deps.view.open(from, tab, opts);
          } catch (error) {
            log.error("threads_open_failed", { error: String(error) });
            await hide();
            return;
          }
        }
        if (opts.present) deps.emitPresented(opts.present);
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
