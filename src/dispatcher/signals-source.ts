/**
 * signals_source — grouped `signals` ingress firing source.
 *
 * The shared buffered-inbox core owns presence, busy, enable, and lifecycle edges.
 * This module owns envelope validation, delivery routing, buffer caps, and the lazy
 * batched-delivery timer. Signal item contents remain opaque.
 */

import type { SignalEnvelope, SignalGroup } from "../contract";
import type { SignalsBatch } from "../io/signals-inbox";
import { onSignalsInbox } from "../io/signals-inbox";
import type { OsEventListen } from "../io/tauri-listen";
import { createLogger } from "../logger";
import { createBufferedInboxSource, type InboxFiring } from "./buffered-inbox-source";
import type { EventBus } from "./event-bus";

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
  isPipelineBusy?: () => boolean;
  subscribePipelineBusy?: (cb: (busy: boolean) => void) => () => void;
}

export interface SignalsSource {
  start(): Promise<void>;
  stop(): void;
  drain(): SignalGroup[];
}

type RoutedGroup = {
  group: SignalGroup;
  delivery: SignalEnvelope["delivery"] | "legacy";
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
    (envelope.delivery === "immediate" || envelope.delivery === "batched") &&
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
    if (envelope == null) return { group: { items: raw.signals }, delivery: "legacy" };
    if (!validEnvelope(envelope)) {
      log.warn("envelope_invalid", { degrade: true });
      return { group: { items: raw.signals }, delivery: "legacy" };
    }
    return { group: { envelope, items: raw.signals }, delivery: envelope.delivery };
  }

  function buildLive(item: RoutedGroup): InboxFiring {
    return { event_name: "signals.push", payload: { signals: [item.group] } };
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

  function drain(): SignalGroup[] {
    const groups = groupsInArrivalOrder();
    clearBuffers();
    return groups;
  }

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
    armBatchTimer();
  }

  function stop(): void {
    core.stop();
    clearBatchTimer();
  }

  return { start, stop, drain };
}
