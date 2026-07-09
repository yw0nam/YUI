/**
 * signals_source — opaque `signals` ingress firing source.
 *
 * Event-driven (inbox push) sibling of agent-source. Listens on two channels:
 *  1. OS idle ticks (OS_EVENT_CHANNEL) — tracks presence; detects idle→present edge.
 *  2. signals-inbox (onSignalsInbox) — receives opaque signal batches from the Rust
 *     /signals ingress.
 *
 * When present: inbox arrival fires signals.push immediately, carrying the batch's
 * `signals` array and `ts` verbatim.
 * When away: batches buffer (BUFFER_CAP = 5, drop oldest batch on overflow).
 * On idle→present edge: if the buffer has content, fires ONE signals.catchup (all
 * buffered batches' items flattened in arrival order), then clears the buffer.
 *
 * firing ≠ judgment: `signals` is opaque — this source never inspects, validates, or
 * reshapes item contents. It only buffers/flattens/forwards the array verbatim;
 * interpretation is Hermes's job. No speak/don't-speak gate and no persona state live here.
 */

import type { SignalsBatch } from "../io/signals-inbox";
import { onSignalsInbox } from "../io/signals-inbox";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { OS_EVENT_CHANNEL, resolveTauriListen } from "../io/tauri-listen";
import { createLogger } from "../logger";
import type { EventBus } from "./event-bus";

const log = createLogger("signals-source");

/** Buffered-batch cap — oldest batch dropped when exceeded. */
const BUFFER_CAP = 5;

export interface SignalsSourceDeps {
  bus: Pick<EventBus, "push">;
  /** Present iff cached OS idle ≤ this (same semantics as github-source/agent-source). */
  present_max_idle_ms: number;
  /** Read on every inbox arrival — gates firing without stopping the listener. */
  isEnabled: () => boolean;
  /** Injectable inbox subscriber; defaults to the real onSignalsInbox. */
  onInbox?: (cb: (p: SignalsBatch) => void, deps?: { listen?: OsEventListen }) => () => void;
  /** Injectable channel listen; defaults to the resolved Tauri listen. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export interface SignalsSource {
  start(): Promise<void>;
  stop(): void;
}

export function createSignalsSource(deps: SignalsSourceDeps): SignalsSource {
  const { bus, present_max_idle_ms, isEnabled } = deps;
  const now = deps.now ?? Date.now;

  let lastIdleMs: number | null = null;
  /** Tracks previous tick's present state for idle→present edge detection. */
  let wasPresent = false;
  let running = false;
  let unlistenIdle: (() => void) | undefined;
  let unlistenInbox: (() => void) | undefined;

  /** Buffered batches (away accumulation), oldest first. */
  const buffer: SignalsBatch[] = [];

  function isPresent(): boolean {
    return lastIdleMs != null && lastIdleMs <= present_max_idle_ms;
  }

  /** Flatten all buffered batches' items in arrival order, emit ONE catchup. */
  function flushCatchup(): void {
    if (buffer.length === 0) return;
    const signals = buffer.flatMap((b) => b.signals);
    bus.push({
      source: "timer_scheduler",
      event_name: "signals.catchup",
      ts: now(),
      hint_tier: 2,
      dnd_override: false,
      payload: { count: signals.length, signals },
    });
    buffer.length = 0;
  }

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    lastIdleMs = payload.data.os_idle_ms ?? null;
    const present = isPresent();
    // A mid-away disable must not let previously-buffered batches survive to a
    // later re-enable — drop the stale buffer now so it can't leak into a future flush.
    if (!isEnabled() && buffer.length > 0) {
      buffer.length = 0;
    }
    // Flush on the idle→present edge only (not on every present tick).
    if (!wasPresent && present && buffer.length > 0 && isEnabled()) {
      flushCatchup();
    }
    wasPresent = present;
  }

  function handleInbox(p: SignalsBatch): void {
    if (!isEnabled()) return;
    // Guard against malformed IPC payloads that slipped through the type cast.
    try {
      if (!Array.isArray((p as unknown as { signals?: unknown })?.signals)) {
        log.debug("inbox_malformed", { degrade: true });
        return;
      }
      const present = isPresent();
      if (present) {
        bus.push({
          source: "timer_scheduler",
          event_name: "signals.push",
          ts: now(),
          hint_tier: 2,
          dnd_override: false,
          payload: { signals: p.signals, ts: p.ts },
        });
      } else {
        buffer.push(p);
        if (buffer.length > BUFFER_CAP) buffer.shift();
      }
    } catch (err) {
      log.debug("inbox_error", { degrade: true, error: String(err) });
    }
  }

  async function start(): Promise<void> {
    if (running) return;
    running = true;

    // Subscribe to OS idle ticks for presence tracking and edge detection.
    let listen: OsEventListen | undefined;
    try {
      listen = deps.listen ?? (await resolveTauriListen());
    } catch (err) {
      log.debug("listen_resolve_failed", { degrade: true, error: String(err) });
    }
    if (listen) {
      try {
        unlistenIdle = await listen(OS_EVENT_CHANNEL, ({ payload }) => onTick(payload));
      } catch (err) {
        log.debug("subscribe_idle_failed", { degrade: true, error: String(err) });
      }
    }

    // Subscribe to signal batches.
    try {
      const inbox = deps.onInbox ?? onSignalsInbox;
      unlistenInbox = inbox(handleInbox, { listen: deps.listen });
    } catch (err) {
      log.debug("subscribe_inbox_failed", { degrade: true, error: String(err) });
    }
  }

  function stop(): void {
    running = false;
    unlistenIdle?.();
    unlistenIdle = undefined;
    unlistenInbox?.();
    unlistenInbox = undefined;
  }

  return { start, stop };
}
