/** The Threads window's open and close, one at a time: show and grow, shrink and hide, then tell main. */

import type { ScreenRect } from "../../contract";
import { createLogger } from "../../logger";

const log = createLogger("threads-presence");

export function createThreadsPresence(deps: {
  view: { open(from: ScreenRect): Promise<void>; close(): Promise<void> };
  /** Places and shows the window; resolves where the grow starts, in window-local px. */
  show(chip: ScreenRect): Promise<ScreenRect>;
  hide(): Promise<void>;
  emitClosed(): void;
}): { open(chip: ScreenRect): void; close(): void } {
  let shown = false;
  let chain: Promise<void> = Promise.resolve();
  const queue = (step: () => Promise<void>): void => {
    chain = chain.then(step);
  };

  async function hide(): Promise<void> {
    shown = false;
    await deps.hide().catch((error) => log.warn("threads_hide_failed", { error: String(error) }));
    deps.emitClosed();
  }

  return {
    open(chip) {
      queue(async () => {
        try {
          const from = await deps.show(chip);
          shown = true;
          await deps.view.open(from);
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
