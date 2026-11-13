/**
 * signals_source — grouped `signals` ingress firing source.
 *
 * Two buffered-inbox cores share the presence, busy, enable, and lifecycle skeleton: the
 * batched core holds `batched` groups behind the paced busy predicate, and the urgent core
 * delivers `urgent` groups (handle now) behind the raw busy predicate — a proactive gap never
 * holds them. Each group routes to exactly one core, so urgent and batched groups never share
 * a catch-up turn.
 * This module owns envelope validation, delivery routing, buffer caps, the lazy
 * batched-delivery timer, and the held batched groups that a caller fires or releases.
 * Signal item contents remain opaque.
 */

import type { SignalEnvelope, SignalGroup } from "../../../contract";
import type { SignalsBatch } from "../../../io/bridge/inbox/signals-inbox";
import { onSignalsInbox } from "../../../io/bridge/inbox/signals-inbox";
import type { OsEventListen } from "../../../io/window/tauri-listen";
import { createLogger } from "../../../logger";
import { signalsOf } from "../../backend/context-builder";
import type { BusEnvelope, EventBus } from "../../core/event-bus";
import { createBufferedInboxSource, type InboxFiring } from "./buffered-inbox-source";

const log = createLogger("signals-source");

const BUFFER_CAP = 5;
const LABEL_MAX = 120;
const BATCH_INTERVAL_MS = 5 * 60_000;

interface SignalsSourceDeps {
  bus: Pick<EventBus, "push">;
  present_max_idle_ms: number;
  isEnabled: () => boolean;
  onInbox?: (cb: (p: SignalsBatch) => void, deps?: { listen?: OsEventListen }) => () => void;
  listen?: OsEventListen;
  /** Called with every parsed group before routing, buffered or not. */
  onArrival?: (group: SignalGroup) => void;
  now?: () => number;
  /** Paced busy predicate for batched groups — the proactive gap reads as busy. */
  isPipelineBusy?: () => boolean;
  subscribePipelineBusy?: (cb: (busy: boolean) => void) => () => void;
  /** Raw busy predicate for urgent groups — the proactive gap does not reach them. */
  isUrgentPipelineBusy?: () => boolean;
  subscribeUrgentPipelineBusy?: (cb: (busy: boolean) => void) => () => void;
}

export interface SignalsSource {
  start(): Promise<void>;
  stop(): void;
  drain(): SignalGroup[];
  restore(env: BusEnvelope): void;
  /** Routes a client-built group like an inbox arrival, without `onArrival`. */
  offer(group: SignalGroup): void;
  /** Removes the buffered batched group with this event id and event type. */
  withdraw(eventId: string, eventType: string): void;
  /** Keeps the batched group with this event id out of every delivery until `release` or `fireHeld`. */
  hold(eventId: string): void;
  /** Lifts the hold; the group joins the next catch-up or timer firing. */
  release(eventId: string): void;
  /** Sends every buffered batched group with these event ids as one ungated turn, without lifting the holds; true when pushed. */
  fireHeld(eventIds: readonly string[]): boolean;
}

type RoutedGroup = {
  group: SignalGroup;
  delivery: SignalEnvelope["delivery"];
};

type BufferedGroup = { sequence: number; group: SignalGroup };

function cutLabel(envelope: SignalEnvelope): SignalEnvelope {
  const { label } = envelope;
  return label !== undefined && [...label].length > LABEL_MAX
    ? { ...envelope, label: `${[...label].slice(0, LABEL_MAX - 1).join("")}…` }
    : envelope;
}

function validEnvelope(value: unknown): value is SignalEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return (
    typeof envelope.source === "string" &&
    envelope.source.length > 0 &&
    typeof envelope.event_type === "string" &&
    envelope.event_type.length > 0 &&
    (envelope.delivery === "batched" || envelope.delivery === "urgent") &&
    (envelope.label === undefined || typeof envelope.label === "string") &&
    typeof envelope.event_id === "string" &&
    envelope.event_id.length > 0 &&
    typeof envelope.occurred_at === "number" &&
    Number.isFinite(envelope.occurred_at) &&
    Math.abs(envelope.occurred_at) <= 8.64e15
  );
}

export function createSignalsSource(deps: SignalsSourceDeps): SignalsSource {
  const batchBuffer: BufferedGroup[] = [];
  const urgentBuffer: BufferedGroup[] = [];
  let nextSequence = 0;
  let frontSequence = 0;
  let batchTimer: ReturnType<typeof setTimeout> | undefined;
  const heldIds = new Set<string>();
  const now = deps.now ?? Date.now;

  const isHeld = (entry: BufferedGroup): boolean => heldIds.has(entry.group.envelope.event_id);
  const deliverable = (): SignalGroup[] =>
    batchBuffer.filter((entry) => !isHeld(entry)).map(({ group }) => group);

  function clearBatchTimer(): void {
    if (batchTimer !== undefined) clearTimeout(batchTimer);
    batchTimer = undefined;
  }

  function clearDeliverable(): void {
    batchBuffer.splice(0, batchBuffer.length, ...batchBuffer.filter(isHeld));
    clearBatchTimer();
  }

  function appendCapped(buffer: BufferedGroup[], group: SignalGroup): void {
    const same = buffer.find((entry) => entry.group.envelope.event_id === group.envelope.event_id);
    if (same) {
      same.group = group;
      return;
    }
    buffer.push({ sequence: nextSequence++, group });
    if (buffer.length > BUFFER_CAP) buffer.shift();
  }

  function parse(raw: SignalsBatch): RoutedGroup | undefined {
    if (!Array.isArray((raw as unknown as { signals?: unknown })?.signals)) {
      log.debug("inbox_malformed", { degrade: true });
      return undefined;
    }
    const envelope = raw.envelope;
    if (!validEnvelope(envelope)) {
      log.warn("envelope_invalid", { dropped_items: raw.signals.length });
      return undefined;
    }
    return {
      group: { envelope: cutLabel(envelope), items: raw.signals },
      delivery: envelope.delivery,
    };
  }

  // One inbox subscription feeds both cores: each arrival is parsed once, then routed by
  // delivery class to the one core whose accept matches. The subscription lives while any
  // core holds a sink and is released when the last one lets go (restart re-subscribes).
  type InboxSink = { accept: (item: RoutedGroup) => boolean; sink: (item: RoutedGroup) => void };
  const sinks: InboxSink[] = [];
  let unlistenInbox: (() => void) | undefined;

  function handleArrival(raw: SignalsBatch): void {
    // A disabled source drops arrivals before envelope validation (no warning) — the core's
    // own isEnabled gate only sees valid groups.
    if (!deps.isEnabled()) return;
    const item = parse(raw);
    if (item === undefined) return;
    deps.onArrival?.(item.group);
    route(item);
  }

  function route(item: RoutedGroup): void {
    for (const { accept, sink } of sinks) {
      if (accept(item)) sink(item);
    }
  }

  function offer(group: SignalGroup): void {
    route({
      group: { ...group, envelope: cutLabel(group.envelope) },
      delivery: group.envelope.delivery,
    });
  }

  function inboxFor(accept: (item: RoutedGroup) => boolean) {
    return (cb: (item: RoutedGroup) => void): (() => void) => {
      const entry: InboxSink = { accept, sink: cb };
      sinks.push(entry);
      if (unlistenInbox === undefined) {
        unlistenInbox = (deps.onInbox ?? onSignalsInbox)(handleArrival, { listen: deps.listen });
      }
      return () => {
        const at = sinks.indexOf(entry);
        if (at >= 0) sinks.splice(at, 1);
        if (sinks.length === 0 && unlistenInbox !== undefined) {
          unlistenInbox();
          unlistenInbox = undefined;
        }
      };
    };
  }

  function buildUrgentDelivery(item: RoutedGroup): InboxFiring {
    return { event_name: "signals.urgent", payload: { signals: [item.group] } };
  }

  function armBatchTimer(): void {
    if (batchTimer !== undefined || batchBuffer.length === 0) return;
    batchTimer = setTimeout(() => {
      batchTimer = undefined;
      const signals = deliverable();
      if (signals.length === 0) return;
      const firing: InboxFiring = { event_name: "signals.batch", payload: { signals } };
      if (core.fireIfEligible(firing)) clearDeliverable();
    }, BATCH_INTERVAL_MS);
  }

  function bufferFor(delivery: SignalEnvelope["delivery"]): BufferedGroup[] {
    return delivery === "urgent" ? urgentBuffer : batchBuffer;
  }

  function bufferAdd(item: RoutedGroup): void {
    const wasEmpty = deliverable().length === 0;
    appendCapped(batchBuffer, item.group);
    if (wasEmpty) armBatchTimer();
  }

  function buildCatchup(): InboxFiring {
    return {
      event_name: "signals.catchup",
      payload: { signals: deliverable() },
    };
  }

  function drain(): SignalGroup[] {
    const groups = deliverable();
    clearDeliverable();
    return groups;
  }

  function withdraw(eventId: string, eventType: string): void {
    const at = batchBuffer.findIndex(
      ({ group }) => group.envelope.event_id === eventId && group.envelope.event_type === eventType,
    );
    if (at < 0) return;
    batchBuffer.splice(at, 1);
    if (batchBuffer.length === 0) clearBatchTimer();
  }

  function release(eventId: string): void {
    heldIds.delete(eventId);
    armBatchTimer();
  }

  // Ungated: the reaction that fires it already waited for an idle pipeline.
  function fireHeld(eventIds: readonly string[]): boolean {
    const ids = new Set(eventIds);
    const fired: SignalGroup[] = [];
    const kept: BufferedGroup[] = [];
    for (const entry of batchBuffer) {
      if (ids.has(entry.group.envelope.event_id)) fired.push(entry.group);
      else kept.push(entry);
    }
    if (!deps.isEnabled() || fired.length === 0) return false;
    // os_event_watcher is unpaced, so the proactive gap does not hold it; a drop (its guardrail debounce too) returns the groups through restoreSignals.
    const pushed = deps.bus.push({
      source: "os_event_watcher",
      event_name: "signals.batch",
      ts: now(),
      payload: { signals: fired },
    });
    if (!pushed) return false;
    batchBuffer.splice(0, batchBuffer.length, ...kept);
    if (batchBuffer.length === 0) clearBatchTimer();
    log.info("fire_held", { event_ids: [...ids] });
    return true;
  }

  // Restored groups go ahead of buffered ones; a group already buffered keeps the buffered copy.
  function restore(env: BusEnvelope): void {
    const groups = signalsOf(env);
    if (!groups?.length || !deps.isEnabled()) return;
    const batchWasEmpty = batchBuffer.length === 0;
    frontSequence -= groups.length;
    let sequence = frontSequence;
    for (const group of groups) {
      const buffer = bufferFor(group.envelope.delivery);
      const restoredSequence = sequence++;
      if (buffer.some((entry) => entry.group.envelope.event_id === group.envelope.event_id))
        continue;
      buffer.push({ sequence: restoredSequence, group });
      buffer.sort((left, right) => left.sequence - right.sequence);
      if (buffer.length > BUFFER_CAP) buffer.shift();
    }
    if (batchWasEmpty) armBatchTimer();
  }

  const urgentCore = createBufferedInboxSource<RoutedGroup, RoutedGroup>({
    bus: deps.bus,
    present_max_idle_ms: deps.present_max_idle_ms,
    isEnabled: deps.isEnabled,
    onInbox: inboxFor((item) => item.delivery === "urgent"),
    listen: deps.listen,
    now: deps.now,
    isPipelineBusy: deps.isUrgentPipelineBusy,
    subscribePipelineBusy: deps.subscribeUrgentPipelineBusy,
    log,
    parse: (item) => item,
    buildLive: buildUrgentDelivery,
    busSource: "urgent_signal_source",
    bufferAdd: (item) => appendCapped(urgentBuffer, item.group),
    bufferEmpty: () => urgentBuffer.length === 0,
    bufferClear: () => {
      urgentBuffer.length = 0;
    },
    // appendCapped appends in arrival order — the buffer needs no sort.
    buildCatchup: () => ({
      event_name: "signals.urgent_catchup",
      payload: { signals: urgentBuffer.map(({ group }) => group) },
    }),
  });

  const core = createBufferedInboxSource<RoutedGroup, RoutedGroup>({
    bus: deps.bus,
    present_max_idle_ms: deps.present_max_idle_ms,
    isEnabled: deps.isEnabled,
    onInbox: inboxFor((item) => item.delivery === "batched"),
    listen: deps.listen,
    now: deps.now,
    isPipelineBusy: deps.isPipelineBusy,
    subscribePipelineBusy: deps.subscribePipelineBusy,
    log,
    parse: (item) => item,
    bufferAdd,
    bufferEmpty: () => deliverable().length === 0,
    bufferClear: clearDeliverable,
    buildCatchup,
  });

  async function start(): Promise<void> {
    // Batched first: an urgent turn opens the pacer gap that would drop the paced catch-up.
    await core.start();
    await urgentCore.start();
    armBatchTimer();
  }

  function stop(): void {
    core.stop();
    urgentCore.stop();
    clearBatchTimer();
  }

  return {
    start,
    stop,
    drain,
    restore,
    offer,
    withdraw,
    hold: (eventId) => {
      heldIds.add(eventId);
    },
    release,
    fireHeld,
  };
}
