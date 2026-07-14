/**
 * signals-source.test.ts — opaque `signals` ingress firing source.
 *
 * Locks the event-driven (inbox) + presence-gated state model:
 *  1. present at inbox arrival → immediate signals.push; payload carries signals + ts verbatim.
 *  2. away at inbox arrival → buffers the batch (nothing pushed).
 *  3. idle→present edge → exactly ONE signals.catchup; flattened signals in arrival order.
 *  4. subsequent present ticks emit nothing further (guard: edge not level).
 *  5. buffer cap: >5 buffered batches drops the oldest batch.
 *  6. !isEnabled() → inbox events are dropped silently (no buffering).
 *  7. malformed or null payload does not crash.
 *  8. start() idempotent; stop() safe off-Tauri (listen: undefined).
 *  9. items are never inspected/validated — opaque passthrough (firing≠judgment).
 *
 * All deps injected (fakeBus / fakeInbox / fakeListen / clock) — no network, no Tauri.
 */

import { describe, expect, it, vi } from "vitest";
import type { SignalsBatch } from "../io/signals-inbox";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import type { BusEnvelope, EventBus } from "./event-bus";
import { createSignalsSource } from "./signals-source";

const PRESENT_MAX = 10_000;
const LOW_IDLE = 500; // present
const HIGH_IDLE = PRESENT_MAX + 1; // away

function fakeBus(): { bus: Pick<EventBus, "push">; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  const bus: Pick<EventBus, "push"> = {
    push: vi.fn((e: BusEnvelope) => {
      pushed.push(e);
      return true;
    }),
  };
  return { bus, pushed };
}

function fakeListen(): { listen: OsEventListen; emit: (p: OsEventPayload) => void } {
  let handler: ((e: { payload: OsEventPayload }) => void) | undefined;
  const listen: OsEventListen = vi.fn(async (_event, h) => {
    handler = h;
    return vi.fn();
  });
  return { listen, emit: (payload) => handler?.({ payload }) };
}

type OnInboxFn = (cb: (p: SignalsBatch) => void, deps?: { listen?: OsEventListen }) => () => void;

function fakeInbox(): { onInbox: OnInboxFn; emit: (p: SignalsBatch) => void } {
  let handler: ((p: SignalsBatch) => void) | undefined;
  const onInbox: OnInboxFn = vi.fn((cb) => {
    handler = cb;
    return vi.fn();
  });
  return { onInbox, emit: (p) => handler?.(p) };
}

function idleTick(os_idle_ms: number | null, ts = 0): OsEventPayload {
  return { event_name: "os_idle_tick", ts, data: { os_idle_ms } };
}

function batch(items: Array<Record<string, unknown>>, ts = 1000): SignalsBatch {
  return { signals: items, ts };
}

describe("signals_source — present: immediate signals.push (spec §1)", () => {
  it("inbox arrival while present → pushes signals.push with signals verbatim", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const now = vi.fn(() => 9000);

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      now,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    emitInbox(batch([{ kind: "reminder", foo: "bar" }], 8500));

    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.source).toBe("timer_scheduler");
    expect(e.event_name).toBe("signals.push");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    expect(e.payload).toEqual({ signals: [{ kind: "reminder", foo: "bar" }] });

    src.stop();
  });

  it("does not inspect or reshape item contents — heterogeneous items pass through as-is (spec §9)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    const weird = [{ a: 1 }, { nested: { b: [1, 2, 3] } }, { c: null }];
    emitInbox(batch(weird, 1));

    expect((pushed[0].payload as { signals: unknown[] }).signals).toEqual(weird);

    src.stop();
  });
});

describe("signals_source — away: buffer + catch-up (spec §2–3)", () => {
  it("away: inbox arrivals are buffered (nothing pushed); present tick → ONE signals.catchup; buffer cleared", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    // Away — two batches.
    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(batch([{ id: 1 }], 1000));
    emitInbox(batch([{ id: 2 }, { id: 3 }], 2000));
    expect(pushed).toHaveLength(0);

    // Present tick → catch-up.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.event_name).toBe("signals.catchup");
    expect(e.source).toBe("timer_scheduler");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    const p = e.payload as { signals: unknown[] };
    // Flattened in arrival order.
    expect(p.signals).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);

    // Buffer cleared — another present tick emits nothing further.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);

    src.stop();
  });

  it("present→present ticks do NOT re-fire an already-cleared buffer (spec §4)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(batch([{ id: 1 }]));
    emitIdle(idleTick(LOW_IDLE)); // flush
    const countAfterFlush = pushed.length;
    emitIdle(idleTick(LOW_IDLE)); // second present tick — nothing buffered
    emitIdle(idleTick(LOW_IDLE)); // third
    expect(pushed).toHaveLength(countAfterFlush);

    src.stop();
  });
});

describe("signals_source — buffer cap 5 batches (spec §5)", () => {
  it("keeps only the last 5 buffered batches (drops oldest)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    // 7 single-item batches, ids 1..7.
    for (let i = 1; i <= 7; i++) {
      emitInbox(batch([{ id: i }], i * 10));
    }
    expect(pushed).toHaveLength(0);

    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const p = pushed[0].payload as { signals: Array<{ id: number }> };
    // Only last 5 batches survive (ids 3..7).
    expect(p.signals.map((s) => s.id)).toEqual([3, 4, 5, 6, 7]);

    src.stop();
  });
});

describe("signals_source — isEnabled gate (spec §6)", () => {
  it("!isEnabled() → inbox arrival is dropped without buffering", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => false,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    emitInbox(batch([{ id: 1 }]));
    expect(pushed).toHaveLength(0);

    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(0);

    src.stop();
  });

  it("mid-away disable drops the stale buffer, so a later re-enable+return only surfaces new items", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    let enabled = true;

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => enabled,
      onInbox,
      listen,
    });
    await src.start();

    // Away — two batches buffered while enabled.
    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(batch([{ id: 1 }], 1000));
    emitInbox(batch([{ id: 2 }], 2000));
    expect(pushed).toHaveLength(0);

    // Disable mid-away.
    enabled = false;
    emitIdle(idleTick(HIGH_IDLE));

    // Re-enable while still away, then a new batch arrives.
    enabled = true;
    emitInbox(batch([{ id: 3 }], 3000));

    // Return to present — exactly ONE catchup, containing only the new item.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const p = pushed[0].payload as { signals: Array<{ id: number }> };
    expect(p.signals[0]).toEqual({ id: 3 });

    src.stop();
  });
});

describe("signals_source — malformed payload (spec §7)", () => {
  it("null or undefined payload does not crash", async () => {
    const { bus } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    expect(() => emitInbox(null as unknown as SignalsBatch)).not.toThrow();
    expect(() => emitInbox(undefined as unknown as SignalsBatch)).not.toThrow();
    expect(() => emitInbox({} as unknown as SignalsBatch)).not.toThrow();

    src.stop();
  });
});

describe("signals_source — lifecycle (spec §8)", () => {
  it("start() is idempotent (calling twice does not double-subscribe)", async () => {
    const { bus } = fakeBus();
    const { listen } = fakeListen();
    const { onInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await expect(src.start()).resolves.toBeUndefined();
    await expect(src.start()).resolves.toBeUndefined();
    expect(vi.mocked(onInbox)).toHaveBeenCalledTimes(1);

    src.stop();
  });

  it("stop() is safe off-Tauri (listen: undefined) and safe to call twice", async () => {
    const { bus } = fakeBus();
    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      listen: undefined,
    });
    await expect(src.start()).resolves.toBeUndefined();
    expect(() => src.stop()).not.toThrow();
    expect(() => src.stop()).not.toThrow();
  });
});
