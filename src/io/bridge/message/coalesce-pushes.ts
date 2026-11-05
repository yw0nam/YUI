/**
 * The message bridge with the streamed deltas batched — the pet window's speech reaches the
 * message window and the unified chat window as one `push` op per tick instead of one per delta.
 *
 * Every other op goes out behind the held text, so the op order on the wire stays the same.
 */

import type { MessageBridge } from "./message-bridge";

/**
 * The speech bubble's typing tick — TYPE_MS_PER_CHAR in src/ui/message/typewriter.ts. io may not
 * import ui, so the value stands here.
 */
const COALESCE_MS = 40;

export interface CoalescingBridge extends MessageBridge {
  /** Sends the held deltas now and drops the timer that would have sent them. */
  flush(): void;
}

/** Wraps a bridge so its `push` ops are batched and every other op goes out behind them. */
export function createCoalescingBridge(bridge: MessageBridge): CoalescingBridge {
  let heldDelta = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!heldDelta) return;
    const delta = heldDelta;
    heldDelta = "";
    bridge.emitSurface({ op: "push", delta });
  };

  return {
    emitSurface(op) {
      if (op.op === "push") {
        heldDelta += op.delta;
        timer ??= setTimeout(flush, COALESCE_MS);
        return;
      }
      flush();
      bridge.emitSurface(op);
    },
    onSurface(cb) {
      return bridge.onSurface(cb);
    },
    emitControl(op) {
      bridge.emitControl(op);
    },
    onControl(cb) {
      return bridge.onControl(cb);
    },
    dispose() {
      flush();
      bridge.dispose();
    },
    flush,
  };
}
