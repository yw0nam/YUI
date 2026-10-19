/**
 * signals_source — grouped `signals` ingress firing source.
 *
 * Two buffered-inbox cores share the presence, busy, enable, and lifecycle skeleton: the
 * non-live core delivers `immediate`/`batched` groups behind the paced busy predicate, and
 * the live core delivers `live` groups (an activity the user started and is waiting on)
 * behind the raw busy predicate — a proactive gap never holds them. Each group routes to
 * exactly one core, so live and non-live groups never share a catch-up turn.
 * This module owns envelope validation, delivery routing, buffer caps, and the lazy
 * batched-delivery timer. Signal item contents remain opaque.
 */

import type { SignalEnvelope, SignalGroup } from "../../../contract";
import type { SignalsBatch } from "../../../io/bridge/inbox/signals-inbox";
import { onSignalsInbox } from "../../../io/bridge/inbox/signals-inbox";
import type { OsEventListen } from "../../../io/window/tauri-listen";
import { createLogger } from "../../../logger";
import type { EventBus } from "../../core/event-bus";
import { createBufferedInboxSource, type InboxFiring } from "./buffered-inbox-source";

const log = createLogger("signals-source");

const BUFFER_CAP = 5;
const BATCH_INTERVAL_MS = 5 * 60_000;

interface SignalsSourceDeps {
  bus: Pick<EventBus, "push">;
  present_max_idle_ms: number;
  isEnabled: () => boolean;
  onInbox?: (cb: (p: SignalsBatch) => void, deps?: { listen?: OsEventListen }) => () => void;
  listen?: OsEventListen;
  now?: () => number;
  /** Paced busy predicate for immediate/batched groups — the proactive gap reads as busy. */
  isPipelineBusy?: () => boolean;
  subscribePipelineBusy?: (cb: (busy: boolean) => void) => () => void;
  /** Raw busy predicate for live groups — the proactive gap does not reach them. */
  isLivePipelineBusy?: () => boolean;
  subscribeLivePipelineBusy?: (cb: (busy: boolean) => void) => () => void;
}

export interface SignalsSource {
  start(): Promise<void>;
  stop(): void;
  drain(): SignalGroup[];
}

type RoutedGroup = {
  group: SignalGroup;
  delivery: SignalEnvelope["delivery"];
};

type BufferedGroup = { sequence: number; group: SignalGroup };

function validEnvelope(value: unknown): value is SignalEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return (
    typeof envelope.source === "string" &&
    envelope.source.length > 0 &&
    typeof envelope.event_type === "string" &&
    envelope.event_type.length > 0 &&
    (envelope.delivery === "immediate" ||
      envelope.delivery === "batched" ||
      envelope.delivery === "live") &&
    typeof envelope.event_id === "string" &&
    envelope.event_id.length > 0 &&
    typeof envelope.occurred_at === "number" &&
    Number.isFinite(envelope.occurred_at) &&
    Math.abs(envelope.occurred_at) <= 8.64e15
  );
}

export function createSignalsSource(deps: SignalsSourceDeps): SignalsSource {
  const awayBuffer: BufferedGroup[] = [];
  const batchBuffer: BufferedGroup[] = [];
  const liveBuffer: BufferedGroup[] = [];
  let nextSequence = 0;
  let batchTimer: ReturnType<typeof setTimeout> | undefined;

  function groupsInArrivalOrder(): SignalGroup[] {
    return [...awayBuffer, ...batchBuffer]
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ group }) => group);
  }

  function clearBatchTimer(): void {
    if (batchTimer !== undefined) clearTimeout(batchTimer);
    batchTimer = undefined;
  }

  function clearBuffers(): void {
    awayBuffer.length = 0;
    batchBuffer.length = 0;
    clearBatchTimer();
  }

  function appendCapped(buffer: BufferedGroup[], group: SignalGroup): void {
    buffer.push({ sequence: nextSequence++, group });
    if (buffer.length > BUFFER_CAP) buffer.shift();
  }

  function parse(raw: SignalsBatch): RoutedGroup | undefined {
    if (!Array.isArray((raw as unknown as { signals?: unknown })?.signals)) {
      log.debug("inbox_malformed", { degrade: true });
      return undefined;
    }
    const envelope = (raw as SignalsBatch).envelope;
    if (!validEnvelope(envelope)) {
      log.warn("envelope_invalid", { dropped_items: raw.signals.length });
      return undefined;
    }
    const item = { group: { envelope, items: raw.signals }, delivery: envelope.delivery };
    return item.delivery === "live" ? undefined : item;
  }

  /** Live core's parse — silent, the envelope warnings belong to parse above. */
  function parseLive(raw: SignalsBatch): RoutedGroup | undefined {
    if (!Array.isArray((raw as unknown as { signals?: unknown })?.signals)) return undefined;
    const envelope = (raw as SignalsBatch).envelope;
    if (!validEnvelope(envelope)) return undefined;
    return envelope.delivery === "live"
      ? { group: { envelope, items: raw.signals }, delivery: envelope.delivery }
      : undefined;
  }

  function buildLive(item: RoutedGroup): InboxFiring {
    return { event_name: "signals.push", payload: { signals: [item.group] } };
  }

  function buildLiveDelivery(item: RoutedGroup): InboxFiring {
    return { event_name: "signals.live", payload: { signals: [item.group] } };
  }

  function armBatchTimer(): void {
    if (batchTimer !== undefined || batchBuffer.length === 0) return;
    batchTimer = setTimeout(() => {
      batchTimer = undefined;
      if (batchBuffer.length === 0) return;
      const firing: InboxFiring = {
        event_name: "signals.batch",
        payload: { signals: batchBuffer.map(({ group }) => group) },
      };
      if (core.fireIfEligible(firing)) batchBuffer.length = 0;
    }, BATCH_INTERVAL_MS);
  }

  function bufferAdd(item: RoutedGroup): void {
    if (item.delivery === "batched") {
      const wasEmpty = batchBuffer.length === 0;
      appendCapped(batchBuffer, item.group);
      if (wasEmpty) armBatchTimer();
      return;
    }
    appendCapped(awayBuffer, item.group);
  }

  function buildCatchup(): InboxFiring {
    return { event_name: "signals.catchup", payload: { signals: groupsInArrivalOrder() } };
  }

  function groupsInLiveArrivalOrder(): SignalGroup[] {
    return [...liveBuffer]
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ group }) => group);
  }

  function drain(): SignalGroup[] {
    const groups = groupsInArrivalOrder();
    clearBuffers();
    return groups;
  }

  const liveCore = createBufferedInboxSource<SignalsBatch, RoutedGroup>({
    bus: deps.bus,
    present_max_idle_ms: deps.present_max_idle_ms,
    isEnabled: deps.isEnabled,
    onInbox: deps.onInbox ?? onSignalsInbox,
    listen: deps.listen,
    now: deps.now,
    isPipelineBusy: deps.isLivePipelineBusy,
    subscribePipelineBusy: deps.subscribeLivePipelineBusy,
    log,
    parse: parseLive,
    buildLive: buildLiveDelivery,
    busSource: "live_signal_source",
    bufferAdd: (item) => appendCapped(liveBuffer, item.group),
    bufferEmpty: () => liveBuffer.length === 0,
    bufferClear: () => {
      liveBuffer.length = 0;
    },
    buildCatchup: () => ({
      event_name: "signals.live_catchup",
      payload: { signals: groupsInLiveArrivalOrder() },
    }),
  });

  const core = createBufferedInboxSource<SignalsBatch, RoutedGroup>({
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
    shouldBuffer: (item) => item.delivery === "batched",
    bufferAdd,
    bufferEmpty: () => awayBuffer.length === 0 && batchBuffer.length === 0,
    bufferClear: clearBuffers,
    buildCatchup,
  });

  async function start(): Promise<void> {
    await core.start();
    await liveCore.start();
    armBatchTimer();
  }

  function stop(): void {
    core.stop();
    liveCore.stop();
    clearBatchTimer();
  }

  return { start, stop, drain };
}
