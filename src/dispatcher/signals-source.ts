/**
 * signals_source — opaque `signals` ingress firing source.
 *
 * Configures the shared buffered-inbox core (`buffered-inbox-source.ts`, also used by
 * agent-source) with the signals-specific policy:
 *  - Buffer: a flat array of batches, oldest first (BUFFER_CAP = 5, drop oldest batch
 *    on overflow).
 *  - Catchup: flatten all buffered batches' `signals` items in arrival order (no sort).
 *  - Live firing: signals.push, carrying the batch's `signals` array verbatim.
 *  - `drain()`: layered on top of the shared core (not part of it) — returns the
 *    buffer's items flattened in arrival order and clears it, without pushing to the bus.
 *    Consumed at src/main.ts to pull unseen signals outside the presence-gated flow.
 *
 * firing ≠ judgment: `signals` is opaque — this source never inspects, validates, or
 * reshapes item contents. It only buffers/flattens/forwards the array verbatim;
 * interpretation is Hermes's job. No speak/don't-speak gate and no persona state live here.
 */

import type { SignalItem } from "../contract";
import type { SignalsBatch } from "../io/signals-inbox";
import { onSignalsInbox } from "../io/signals-inbox";
import type { OsEventListen } from "../io/tauri-listen";
import { createLogger } from "../logger";
import { createBufferedInboxSource, type InboxFiring } from "./buffered-inbox-source";
import type { EventBus } from "./event-bus";

const log = createLogger("signals-source");

/** Buffered-batch cap — oldest batch dropped when exceeded. */
const BUFFER_CAP = 5;

interface SignalsSourceDeps {
  bus: Pick<EventBus, "push">;
  /** Present iff cached OS idle ≤ this (same semantics as agent-source). */
  present_max_idle_ms: number;
  /** Read on every inbox arrival — gates firing without stopping the listener. */
  isEnabled: () => boolean;
  /** Injectable inbox subscriber; defaults to the real onSignalsInbox. */
  onInbox?: (cb: (p: SignalsBatch) => void, deps?: { listen?: OsEventListen }) => () => void;
  /** Injectable channel listen; defaults to the resolved Tauri listen. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Whether the dispatcher pipeline is busy (backend call in flight or speech playing). Absent = never busy. */
  isPipelineBusy?: () => boolean;
  /** Subscribe to pipeline-busy transitions; used to flush the buffer on the busy→idle edge. */
  subscribePipelineBusy?: (cb: (busy: boolean) => void) => () => void;
}

export interface SignalsSource {
  start(): Promise<void>;
  stop(): void;
  drain(): SignalItem[];
}

export function createSignalsSource(deps: SignalsSourceDeps): SignalsSource {
  /** Buffered batches (away or busy accumulation), oldest first. */
  const buffer: SignalsBatch[] = [];

  function flattenBuffer(): SignalItem[] {
    return buffer.flatMap((batch) => batch.signals);
  }

  function parse(p: SignalsBatch): SignalsBatch | undefined {
    if (!Array.isArray((p as unknown as { signals?: unknown })?.signals)) {
      log.debug("inbox_malformed", { degrade: true });
      return undefined;
    }
    return p;
  }

  function buildLive(p: SignalsBatch): InboxFiring {
    return { event_name: "signals.push", payload: { signals: p.signals } };
  }

  function bufferAdd(p: SignalsBatch): void {
    buffer.push(p);
    if (buffer.length > BUFFER_CAP) buffer.shift();
  }

  /** Flatten all buffered batches' items in arrival order. */
  function buildCatchup(): InboxFiring {
    return { event_name: "signals.catchup", payload: { signals: flattenBuffer() } };
  }

  /** Layers on the shared core: drains the live buffer without pushing to the bus. */
  function drain(): SignalItem[] {
    const signals = flattenBuffer();
    buffer.length = 0;
    return signals;
  }

  const core = createBufferedInboxSource<SignalsBatch>({
    bus: deps.bus,
    present_max_idle_ms: deps.present_max_idle_ms,
    isEnabled: deps.isEnabled,
    onInbox: deps.onInbox ?? onSignalsInbox,
    listen: deps.listen,
    now: deps.now,
    isPipelineBusy: deps.isPipelineBusy,
    subscribePipelineBusy: deps.subscribePipelineBusy,
    log,
    parse,
    buildLive,
    bufferAdd,
    bufferEmpty: () => buffer.length === 0,
    bufferClear: () => {
      buffer.length = 0;
    },
    buildCatchup,
  });

  return { start: core.start, stop: core.stop, drain };
}
