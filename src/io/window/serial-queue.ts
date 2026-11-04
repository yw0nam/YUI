/** Window open/close steps run one after another; a failed step is logged and the queue keeps working. */

import { createLogger } from "../../logger";

const log = createLogger("serial-queue");

/** Returns an enqueue: each step starts only after the previous one settles, whatever its outcome. */
export function createSerialQueue(): (step: () => Promise<void>) => void {
  let chain: Promise<void> = Promise.resolve();
  return (step) => {
    chain = chain.then(step, step);
    // A trailing rejection would sit unhandled; log it so the chain stays usable.
    chain.catch((error) => log.warn("serial_queue_step_failed", { error: String(error) }));
  };
}
