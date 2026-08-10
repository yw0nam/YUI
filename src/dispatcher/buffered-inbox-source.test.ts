/**
 * buffered-inbox-source.test.ts — shared presence-gated core (agent-source and
 * signals-source both configure this core; see buffered-inbox-source.ts).
 *
 * Pins two behaviors on the core itself, previously exercised only indirectly
 * through a consumer's test suite (agent-source.test.ts):
 *  1. idle->present edge with no `subscribePipelineBusy` configured: catchup
 *     fires exactly ONCE on the edge, and does NOT re-fire on subsequent present
 *     ticks while the buffer stays empty (edge, not level).
 *  2. catchup flush delivery contract: one catchup contains every buffered item
 *     exactly once, the buffer is empty right after, and an immediately-following
 *     flush trigger with nothing new buffered does not redeliver the prior batch.
 *
 * All deps injected (fakeBus / fakeListen / fakeInbox / fake buffer closures) —
 * no network, no Tauri, no consumer (agent-source/signals-source) in the loop.
 */

import { describe, expect, it, vi } from "vitest";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import type { Logger } from "../logger";
import { createBufferedInboxSource, type InboxFiring } from "./buffered-inbox-source";
import type { BusEnvelope, EventBus } from "./event-bus";

const PRESENT_MAX = 10_000;
const LOW_IDLE = 500; // present
const HIGH_IDLE = PRESENT_MAX + 1; // away

interface FakeItem {
  id: string;
  ts: number;
}

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

function idleTick(os_idle_ms: number | null, ts = 0): OsEventPayload {
  return { event_name: "os_idle_tick", ts, data: { os_idle_ms } };
}

type OnInboxFn = (cb: (p: FakeItem) => void, deps?: { listen?: OsEventListen }) => () => void;

function fakeInbox(): { onInbox: OnInboxFn; emit: (p: FakeItem) => void } {
  let handler: ((p: FakeItem) => void) | undefined;
  const onInbox: OnInboxFn = vi.fn((cb) => {
    handler = cb;
    return vi.fn();
  });
  return { onInbox, emit: (p) => handler?.(p) };
}

function makeLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function item(id: string, ts: number): FakeItem {
  return { id, ts };
}

/** Minimal buffer: a plain array in arrival order, closed over by the config. */
function fakeBuffer(): {
  bufferAdd: (p: FakeItem) => void;
  bufferEmpty: () => boolean;
  bufferClear: () => void;
  buildCatchup: () => InboxFiring;
  snapshot: () => FakeItem[];
} {
  const buffer: FakeItem[] = [];
  return {
    bufferAdd: (p) => buffer.push(p),
    bufferEmpty: () => buffer.length === 0,
    bufferClear: () => {
      buffer.length = 0;
    },
    buildCatchup: () => ({
      event_name: "test.catchup",
      payload: { count: buffer.length, items: buffer.map((p) => ({ id: p.id, ts: p.ts })) },
    }),
    snapshot: () => [...buffer],
  };
}

function buildLive(p: FakeItem): InboxFiring {
  return { event_name: "test.live", payload: { id: p.id, ts: p.ts } };
}

describe("buffered_inbox_source — idle->present edge without subscribePipelineBusy", () => {
  it("buffer fills while away; presence returns -> catchup fires exactly ONCE on the edge, not on later present ticks", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const buf = fakeBuffer();

    const src = createBufferedInboxSource<FakeItem>({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      log: makeLog(),
      parse: (p) => p,
      buildLive,
      bufferAdd: buf.bufferAdd,
      bufferEmpty: buf.bufferEmpty,
      bufferClear: buf.bufferClear,
      buildCatchup: buf.buildCatchup,
      // subscribePipelineBusy intentionally omitted — pins the edge path when no
      // busy->idle flush is wired at all (isPipelineBusy absent = never busy).
    });
    await src.start();

    // Away — arrivals buffer, nothing pushed.
    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(item("a", 1000));
    emitInbox(item("b", 2000));
    expect(pushed).toHaveLength(0);
    expect(buf.snapshot()).toHaveLength(2);

    // idle->present edge: exactly one catchup.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    expect(pushed[0].event_name).toBe("test.catchup");
    expect(buf.snapshot()).toHaveLength(0);

    // Subsequent present ticks (level, not edge) — buffer stays empty, no re-fire.
    emitIdle(idleTick(LOW_IDLE));
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);

    src.stop();
  });

  it("away->present->away->present with nothing new buffered on the second edge fires no second catchup", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const buf = fakeBuffer();

    const src = createBufferedInboxSource<FakeItem>({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      log: makeLog(),
      parse: (p) => p,
      buildLive,
      bufferAdd: buf.bufferAdd,
      bufferEmpty: buf.bufferEmpty,
      bufferClear: buf.bufferClear,
      buildCatchup: buf.buildCatchup,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(item("a", 1000));
    emitIdle(idleTick(LOW_IDLE)); // first edge -> one catchup
    expect(pushed).toHaveLength(1);

    // Leave and return again with nothing new buffered.
    emitIdle(idleTick(HIGH_IDLE));
    emitIdle(idleTick(LOW_IDLE)); // second edge, empty buffer -> no re-fire
    expect(pushed).toHaveLength(1);

    src.stop();
  });
});

describe("buffered_inbox_source — catchup flush delivery contract", () => {
  it("one catchup contains all buffered items exactly once; buffer is empty after the flush", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const buf = fakeBuffer();

    const src = createBufferedInboxSource<FakeItem>({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      log: makeLog(),
      parse: (p) => p,
      buildLive,
      bufferAdd: buf.bufferAdd,
      bufferEmpty: buf.bufferEmpty,
      bufferClear: buf.bufferClear,
      buildCatchup: buf.buildCatchup,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(item("a", 1000));
    emitInbox(item("b", 2000));
    emitInbox(item("c", 3000));
    expect(pushed).toHaveLength(0);

    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const p = pushed[0].payload as { count: number; items: FakeItem[] };
    expect(p.count).toBe(3);
    expect(p.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    // No duplicates.
    expect(new Set(p.items.map((i) => i.id)).size).toBe(3);
    // Buffer emptied by the flush.
    expect(buf.snapshot()).toHaveLength(0);

    src.stop();
  });

  it("an immediately-following flush trigger with an empty buffer does not redeliver the prior batch", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const buf = fakeBuffer();

    const src = createBufferedInboxSource<FakeItem>({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      log: makeLog(),
      parse: (p) => p,
      buildLive,
      bufferAdd: buf.bufferAdd,
      bufferEmpty: buf.bufferEmpty,
      bufferClear: buf.bufferClear,
      buildCatchup: buf.buildCatchup,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(item("a", 1000));
    emitInbox(item("b", 2000));

    emitIdle(idleTick(LOW_IDLE)); // flush #1
    expect(pushed).toHaveLength(1);
    const firstIds = (pushed[0].payload as { items: FakeItem[] }).items.map((i) => i.id);
    expect(firstIds).toEqual(["a", "b"]);

    // Immediately trigger another flush condition (away, then present again)
    // with nothing new buffered — must not redeliver "a"/"b".
    emitIdle(idleTick(HIGH_IDLE));
    emitIdle(idleTick(LOW_IDLE)); // flush #2 attempt

    expect(pushed).toHaveLength(1); // still just the one catchup
    src.stop();
  });
});
