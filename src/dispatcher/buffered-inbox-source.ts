/**
 * buffered_inbox_source — shared presence-gated core for inbox-push firing sources.
 *
 * Event-driven (inbox push). Listens on two channels:
 *  1. OS idle ticks (OS_EVENT_CHANNEL) — tracks presence; detects idle→present edge.
 *  2. An injected inbox subscriber — receives source-specific raw events.
 *
 * When present AND the pipeline is idle: an inbox arrival fires immediately via
 * `buildLive`. When present-but-busy (backend call in flight or speech playing) OR
 * away: arrivals buffer, shape and cap-drop policy owned entirely by the caller
 * (`bufferAdd`/`bufferEmpty`/`bufferClear`).
 * On the idle→present edge OR the busy→idle edge: if the buffer has content, fires
 * ONE catchup built by `buildCatchup`, then clears the buffer.
 *
 * firing ≠ judgment: this only fires candidate events — the backend decides whether/what
 * to speak. No speak/don't-speak gate and no persona state live here.
 *
 * Per-source differences (buffer shape, flush ordering, payload reshaping, and any
 * public surface beyond start/stop such as signals-source's `drain()`) are configured
 * by the caller, not absorbed here — this core only owns the shared presence/busy/tick
 * skeleton.
 */

import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { subscribeOsEvent } from "../io/tauri-listen";
import type { Logger } from "../logger";
import type { EventBus } from "./event-bus";

/** { event_name, payload } — the core fills in the shared envelope fields. */
export interface InboxFiring {
  event_name: string;
  payload: Record<string, unknown>;
}

export interface BufferedInboxSourceConfig<TRaw, TItem = TRaw> {
  bus: Pick<EventBus, "push">;
  /** Present iff cached OS idle ≤ this. */
  present_max_idle_ms: number;
  /** Read on every inbox arrival — gates firing without stopping the listener. */
  isEnabled: () => boolean;
  /** Inbox subscriber (default already resolved by the caller). */
  onInbox: (cb: (p: TRaw) => void, deps?: { listen?: OsEventListen }) => () => void;
  /** Injectable channel listen; defaults to the resolved Tauri listen. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Whether the dispatcher pipeline is busy (backend call in flight or speech playing). Absent = never busy. */
  isPipelineBusy?: () => boolean;
  /** Subscribe to pipeline-busy transitions; used to flush the buffer on the busy→idle edge. */
  subscribePipelineBusy?: (cb: (busy: boolean) => void) => () => void;
  log: Logger;
  /** Validate/narrow a raw inbox arrival. Return undefined to drop it as malformed (caller logs). */
  parse: (raw: TRaw) => TItem | undefined;
  /** Build the firing for a present-and-idle arrival. */
  buildLive: (item: TItem) => InboxFiring;
  /** Force selected valid arrivals into the source-owned buffer even while eligible. */
  shouldBuffer?: (item: TItem) => boolean;
  /** Add one arrived item to the buffer — dedup/cap policy owned by the caller. */
  bufferAdd: (item: TItem) => void;
  /** True iff the buffer currently holds anything. */
  bufferEmpty: () => boolean;
  /** Drop everything buffered. */
  bufferClear: () => void;
  /** Build the catchup firing from the buffer's current contents — flatten/sort policy owned by the caller. */
  buildCatchup: () => InboxFiring;
}

export function createBufferedInboxSource<TRaw, TItem = TRaw>(
  config: BufferedInboxSourceConfig<TRaw, TItem>,
): {
  start(): Promise<void>;
  stop(): void;
  fireIfEligible(firing: InboxFiring): boolean;
} {
  const { bus, present_max_idle_ms, isEnabled, log } = config;
  const now = config.now ?? Date.now;

  let lastIdleMs: number | null = null;
  /** Tracks previous tick's present state for idle→present edge detection. */
  let wasPresent = false;
  let running = false;
  let unlistenIdle: (() => void) | undefined;
  let unlistenInbox: (() => void) | undefined;
  let unlistenBusy: (() => void) | undefined;

  function isPresent(): boolean {
    return lastIdleMs != null && lastIdleMs <= present_max_idle_ms;
  }

  function isBusy(): boolean {
    return config.isPipelineBusy?.() ?? false;
  }

  function fire(firing: InboxFiring): void {
    bus.push({
      source: "timer_scheduler",
      event_name: firing.event_name,
      ts: now(),
      hint_tier: 2,
      dnd_override: false,
      payload: firing.payload,
    });
  }

  function fireIfEligible(firing: InboxFiring): boolean {
    if (!isEnabled() || !isPresent() || isBusy()) return false;
    fire(firing);
    return true;
  }

  function flushCatchup(): void {
    if (config.bufferEmpty()) return;
    fire(config.buildCatchup());
    config.bufferClear();
  }

  /** Flush iff enabled, buffer non-empty, present, and the pipeline is idle. */
  function maybeFlush(): void {
    if (!isEnabled() || config.bufferEmpty() || !isPresent() || isBusy()) return;
    flushCatchup();
  }

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    lastIdleMs = payload.data.os_idle_ms ?? null;
    const present = isPresent();
    // A mid-away disable must not let previously-buffered items survive to a
    // later re-enable — drop the stale buffer now so it can't leak into a future flush.
    if (!isEnabled() && !config.bufferEmpty()) {
      config.bufferClear();
    }
    // Flush on the idle→present edge only (not on every present tick).
    // isEnabled() guard mirrors handleInbox — a mid-run toggle must not dispatch
    // a catchup the user has since disabled.
    if (!wasPresent && present) {
      maybeFlush();
    }
    wasPresent = present;
  }

  function handleInbox(raw: TRaw): void {
    if (!isEnabled()) return;
    // Guard against malformed IPC payloads that slipped through the type cast.
    try {
      const item = config.parse(raw);
      if (item === undefined) return;
      if (!config.shouldBuffer?.(item) && isPresent() && !isBusy()) {
        fire(config.buildLive(item));
      } else {
        config.bufferAdd(item);
      }
    } catch (err) {
      log.debug("inbox_error", { degrade: true, error: String(err) });
    }
  }

  async function start(): Promise<void> {
    if (running) return;
    running = true;

    // Subscribe to OS idle ticks for presence tracking and edge detection.
    unlistenIdle = await subscribeOsEvent({
      listen: config.listen,
      onTick,
      log,
      subscribeTag: "subscribe_idle_failed",
    });

    // Subscribe to the inbox channel.
    try {
      unlistenInbox = config.onInbox(handleInbox, { listen: config.listen });
    } catch (err) {
      log.debug("subscribe_inbox_failed", { degrade: true, error: String(err) });
    }

    // Flush on the busy→idle edge (mirrors the idle→present edge above).
    unlistenBusy = config.subscribePipelineBusy?.((busy) => {
      if (!busy) maybeFlush();
    });
  }

  function stop(): void {
    running = false;
    unlistenIdle?.();
    unlistenIdle = undefined;
    unlistenInbox?.();
    unlistenInbox = undefined;
    unlistenBusy?.();
    unlistenBusy = undefined;
  }

  return { start, stop, fireIfEligible };
}
